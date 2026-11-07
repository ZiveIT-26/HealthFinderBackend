import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';
import {
  Annotation,
  StateGraph,
  MessagesAnnotation,
  START,
  END,
} from '@langchain/langgraph';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import {
  AIMessage,
  BaseMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from '@langchain/core/messages';
import { z } from 'zod';
import type { LlmConfig } from '../../config/llm.config.js';
import { resolveTrustedUrl } from './tools/fetch-trusted-doctor-page.tool.js';
// Previous approach: the model walked the website page by page with these tools.
// Small local models got lost or looped, so find_doctors walks the site in code instead.
// import { createFetchTrustedDoctorPageTool } from './tools/fetch-trusted-doctor-page.tool.js';
// import { createSearchDoctorsTool } from './tools/search-doctors.tool.js';
// import { createGetTrustedDoctorSourceInstructionsTool } from './tools/get-trusted-doctor-source-instructions.tool.js';
// import { createListTrustedDoctorSourcesTool } from './tools/list-trusted-doctor-sources.tool.js';
import {
  createFindDoctorsTool,
  FIND_DOCTORS_TOOL,
  type FindDoctorsArtifact,
} from './tools/find-doctors.tool.js';
import { ZoznamLekarovClient } from './sources/zoznam-lekarov.client.js';
import {
  doctorResponseSchema,
  type DoctorResponse,
} from './doctor-response.js';

const EMERGENCY_CONFIDENCE_THRESHOLD = 0.7;
/** Loop guard: after this many tool rounds the graph goes to `finalize`. */
const MAX_TOOL_ROUNDS = 4;
const agentLogger = new Logger('AgentGraph');

/** Message content can be a string or an array of parts; join the text parts. */
function messageText(message: BaseMessage): string {
  const { content } = message;
  if (typeof content === 'string') return content;
  return content
    .map((part) => (typeof part === 'string' ? part : 'text' in part ? String(part.text) : ''))
    .join('');
}

const FETCH_PAGE_TOOL = 'fetch_trusted_doctor_page';

/**
 * Every fetched page stays in the message history, so each next model call
 * would re-send all of them. Keep only the latest page in full and replace
 * older ones with their first line ("URL: ..."). Saves most of the context.
 */
function compactOldPages(messages: BaseMessage[]): BaseMessage[] {
  const isPage = (message: BaseMessage): message is ToolMessage =>
    message instanceof ToolMessage && message.name === FETCH_PAGE_TOOL;

  const lastPageIndex = messages.findLastIndex(isPage);

  return messages.map((message, index) => {
    if (!isPage(message) || index === lastPageIndex) return message;
    const firstLine = messageText(message).split('\n', 1)[0];
    return new ToolMessage({
      content: `${firstLine}\n(page already read; content omitted)`,
      tool_call_id: message.tool_call_id,
      name: message.name,
    });
  });
}

/** Doctors returned by the last successful find_doctors call, if any. */
function lastFoundDoctors(messages: BaseMessage[]): FindDoctorsArtifact | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message instanceof ToolMessage && message.name === FIND_DOCTORS_TOOL && message.artifact) {
      return message.artifact as FindDoctorsArtifact;
    }
  }
  return undefined;
}

/** Last assistant message that has actual text (not just a tool call). */
function lastAssistantText(messages: BaseMessage[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message instanceof AIMessage) {
      const text = messageText(message).trim();
      if (text) return text;
    }
  }
  return undefined;
}

/**
 * When the loop guard stops the agent, its last message still asks for tool calls
 * that were never executed. OpenAI-compatible APIs reject such a history, so drop it.
 */
function withoutDanglingToolCalls(messages: BaseMessage[]): BaseMessage[] {
  const last = messages[messages.length - 1];
  return last instanceof AIMessage && (last.tool_calls?.length ?? 0) > 0
    ? messages.slice(0, -1)
    : messages;
}

function safeResolveTrustedUrl(value: string, llmConfig: LlmConfig): string {
  try {
    return resolveTrustedUrl(value, llmConfig);
  } catch {
    return value;
  }
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Small models often say "I am searching..." without actually calling the tool.
 * So a structured-output step (reliable, like checkEmergency) decides whether to
 * search, and code runs find_doctors before the agent writes the answer.
 */
const searchPlanSchema = z.object({
  wantsDoctor: z.boolean(),
  speciality: z.string().nullable(),
  town: z.string().nullable(),
});

/** Last few user/assistant text messages as plain text for the planner. */
function conversationTranscript(messages: BaseMessage[]): string {
  return messages
    .filter(
      (message) =>
        message instanceof HumanMessage ||
        (message instanceof AIMessage && messageText(message).trim() !== ''),
    )
    .slice(-6)
    .map((message) =>
      `${message instanceof HumanMessage ? 'User' : 'Assistant'}: ${messageText(message)}`,
    )
    .join('\n');
}

const checkEmergencySchema = z.object({
  isEmergency: z.boolean(),
  confidence: z.number().min(0).max(1),
});

const AgentState = Annotation.Root({
  ...MessagesAnnotation.spec,
  isEmergency: Annotation<boolean>({
    reducer: (_, update) => update,
    default: () => false,
  }),
  response: Annotation<DoctorResponse | undefined>({
    reducer: (_, update) => update,
    default: () => undefined,
  }),
  toolsUsed: Annotation<boolean>({
    reducer: (_, update) => update,
    default: () => false,
  }),
  toolRounds: Annotation<number>({
    reducer: (_, update) => update,
    default: () => 0,
  }),
});

type LlmSettings = {
  apiKey: string;
  baseURL?: string;
  model: string;
  /** e.g. "none" turns off thinking for Ollama thinking models (bonsai, qwen3.5). */
  reasoningEffort?: string;
};

function createAgentGraph(
  llm: LlmSettings,
  tavilyApiKey: string,
  httpService: HttpService,
  llmConfig: LlmConfig,
) {
  const findDoctorsTool = createFindDoctorsTool(
    new ZoznamLekarovClient(httpService, llmConfig),
  );
  const tools = [
    findDoctorsTool,
    // createSearchDoctorsTool(tavilyApiKey),
    // createFetchTrustedDoctorPageTool(httpService, llmConfig),
    // createListTrustedDoctorSourcesTool(llmConfig.trustedDoctorSources),
    // createGetTrustedDoctorSourceInstructionsTool(llmConfig.trustedDoctorSources),
  ];
  const model = new ChatOpenAI({
    model: llm.model,
    temperature: 0,
    apiKey: llm.apiKey,
    configuration: llm.baseURL ? { baseURL: llm.baseURL } : undefined,
    modelKwargs: llm.reasoningEffort
      ? { reasoning_effort: llm.reasoningEffort }
      : undefined,
  });
  const assistantModel = model.bindTools(tools);
  const checkEmergencyModel = model.withStructuredOutput(checkEmergencySchema, {
    method: 'jsonSchema',
    strict: true,
  });
  const emergencyModel = model;
  // jsonSchema: Ollama constrains generation to valid JSON (same as checkEmergency).
  // functionCalling was unreliable with small local models.
  const responseModel = model.withStructuredOutput(doctorResponseSchema, {
    method: 'jsonSchema',
    strict: true,
  });
  const planModel = model.withStructuredOutput(searchPlanSchema, {
    method: 'jsonSchema',
    strict: true,
  });
  const toolNode = new ToolNode(tools);

  return new StateGraph(AgentState)
    .addNode('checkEmergency', async ({ messages }) => {
      const latestMessage = [...messages]
        .reverse()
        .find(
          (message): message is HumanMessage => message instanceof HumanMessage,
        );

      if (!latestMessage) {
        return { isEmergency: false };
      }

      const result = await checkEmergencyModel.invoke([
        new SystemMessage(llmConfig.systemPrompts.emergencyCheck),
        latestMessage,
      ]);
      const routedToEmergency =
        result.isEmergency &&
        result.confidence >= EMERGENCY_CONFIDENCE_THRESHOLD;

      agentLogger.log(
        `checkEmergency result: ${JSON.stringify({
          isEmergency: result.isEmergency,
          confidence: result.confidence,
          threshold: EMERGENCY_CONFIDENCE_THRESHOLD,
          routedToEmergency,
        })}`,
      );

      return {
        isEmergency: routedToEmergency,
      };
    })
    .addNode('emergency', async ({ messages }) => {
      const latestMessage = [...messages]
        .reverse()
        .find(
          (message): message is HumanMessage => message instanceof HumanMessage,
        );

      if (!latestMessage) {
        return {
          messages: [
            new AIMessage(
              'This may be a medical emergency. Call an ambulance now: 112 or 155 in Slovakia.',
            ),
          ],
        };
      }

      const response = await emergencyModel.invoke([
        new SystemMessage(llmConfig.systemPrompts.emergencyResponse),
        latestMessage,
      ]);
      const text = messageText(response);

      return {
        messages: [new AIMessage(text)],
        response: { text, doctors: [] },
      };
    })
    .addNode('planSearch', async ({ messages }) => {
      let plan: z.infer<typeof searchPlanSchema>;
      try {
        plan = await planModel.invoke([
          new SystemMessage(llmConfig.systemPrompts.searchPlanner),
          new HumanMessage(conversationTranscript(messages)),
        ]);
      } catch (error) {
        agentLogger.warn(`planSearch failed, agent decides alone: ${String(error)}`);
        return {};
      }
      agentLogger.log(`planSearch result: ${JSON.stringify(plan)}`);

      if (!plan.wantsDoctor || !plan.speciality) return {};

      // Same shape as if the model had called the tool itself, so the agent
      // sees a normal tool call + result in the history.
      const toolCall = {
        id: `plan_${randomUUID()}`,
        name: FIND_DOCTORS_TOOL,
        args: { speciality: plan.speciality, ...(plan.town ? { town: plan.town } : {}) },
        type: 'tool_call' as const,
      };
      try {
        const toolMessage = (await findDoctorsTool.invoke(toolCall)) as ToolMessage;
        return {
          messages: [new AIMessage({ content: '', tool_calls: [toolCall] }), toolMessage],
          toolsUsed: true,
          toolRounds: 1,
        };
      } catch (error) {
        agentLogger.warn(`planSearch: find_doctors failed: ${String(error)}`);
        return {};
      }
    })
    .addNode('agent', async ({ messages }) => ({
      messages: [
        await assistantModel.invoke([
          new SystemMessage(llmConfig.systemPrompts.assistant),
          ...compactOldPages(messages),
        ]),
      ],
    }))
    .addNode('tools', async (state) => ({
      ...(await toolNode.invoke(state)),
      toolsUsed: true,
      toolRounds: state.toolRounds + 1,
    }))
    .addNode('finalize', async ({ messages }) => {
      const history = withoutDanglingToolCalls(messages);
      let response: DoctorResponse | undefined;

      // Doctors found by find_doctors come straight from the website parser:
      // no extra LLM call, nothing the model could invent or alter.
      const found = lastFoundDoctors(history);
      if (found) {
        response = {
          text: lastAssistantText(history) ?? `Found ${found.doctors.length} doctors.`,
          doctors: found.doctors,
        };
      } else {
        try {
          response = await responseModel.invoke([
            new SystemMessage(llmConfig.systemPrompts.responseFormatter),
            ...compactOldPages(history),
          ]);
        } catch (error) {
          agentLogger.warn(`finalize: structured output failed: ${String(error)}`);
        }
      }

      if (!response) {
        const text = lastAssistantText(history) || 'Failed to load the answer.';
        agentLogger.warn('finalize: no structured output, using last agent message');
        response = { text, doctors: [] };
      }

      // Pages show same-site links as "/path": turn them back into full URLs,
      // then drop doctors without a real https source URL instead of failing the whole answer.
      const validDoctors = response.doctors
        .map((doctor) => ({ ...doctor, url: safeResolveTrustedUrl(doctor.url, llmConfig) }))
        .filter((doctor) => isHttpsUrl(doctor.url));
      if (validDoctors.length !== response.doctors.length) {
        agentLogger.warn(
          `finalize: dropped ${response.doctors.length - validDoctors.length} doctor(s) without a valid https URL`,
        );
        response = { ...response, doctors: validDoctors };
      }

      return {
        response,
        messages: [new AIMessage(response.text)],
      };
    })
    .addEdge(START, 'checkEmergency')
    .addConditionalEdges('checkEmergency', ({ isEmergency }) =>
      isEmergency ? 'emergency' : 'planSearch',
    )
    .addEdge('emergency', END)
    .addEdge('planSearch', 'agent')
    .addConditionalEdges('agent', ({ messages, toolsUsed, toolRounds }) => {
      const lastMessage = messages[messages.length - 1];
      const wantsTools =
        lastMessage instanceof AIMessage && (lastMessage.tool_calls?.length ?? 0) > 0;

      if (wantsTools && toolRounds >= MAX_TOOL_ROUNDS) {
        agentLogger.warn(`agent: stopped after ${toolRounds} tool rounds (loop guard)`);
        return 'finalize';
      }
      if (wantsTools) return 'tools';
      return toolsUsed ? 'finalize' : END;
    })
    .addEdge('tools', 'agent')
    .addEdge('finalize', END)
    .compile();
}

@Injectable()
export class AgentService {
  private readonly graph: ReturnType<typeof createAgentGraph>;

  constructor(
    config: ConfigService,
    private readonly httpService: HttpService,
  ) {
    const openAiApiKey = config.get<string>('OPENAI_API_KEY')?.trim();
    let llm: LlmSettings;

    if (openAiApiKey) {
      llm = {
        apiKey: openAiApiKey,
        model: 'gpt-4o',
      };
    } else {
      const baseURL = config.get<string>('LLM_BASE_URL')?.trim();
      const model = config.get<string>('LLM_MODEL')?.trim();

      if (!model || !baseURL) {
        throw new Error(
          'LLM_MODEL and LLM_BASE_URL must be set when OPENAI_API_KEY is not configured',
        );
      }

      const reasoningEffort =
        config.get<string>('LLM_REASONING_EFFORT')?.trim() || undefined;

      llm = { apiKey: 'ollama', baseURL, model, reasoningEffort };
    }

    this.graph = createAgentGraph(
      llm,
      config.getOrThrow<string>('TAVILY_API_KEY'),
      this.httpService,
      config.getOrThrow<LlmConfig>('llm'),
    );
  }

  streamEvents(messages: BaseMessage[]) {
    return this.graph.streamEvents({ messages }, { version: 'v2' });
  }
}
