import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import type { ChatOpenAI } from '@langchain/openai';
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
import {
  createFindDoctorsTool,
  FIND_DOCTORS_TOOL,
  type FindDoctorsArtifact,
  findSpecialities,
  findTowns,
  matchTown,
} from './tools/find-doctors.tool.js';
import { createDoctorSources } from './sources/index.js';
import { createWebSearchTool } from './tools/web-search.tool.js';
import { fillTemplate } from '../../config/template.js';
import type { TriageResult } from './triage/triage.js';
import { createTriageStep } from './triage/triage-step.js';
import { conversationTranscript, messageText } from './transcript.js';
import { createChatModel, readLlmSettings, readTriageLlmSettings } from './llm-model.js';
import {
  doctorResponseSchemaForModel,
  type DoctorResponse,
} from './doctor-response.js';


const MAX_TOOL_ROUNDS = 4;
const agentLogger = new Logger('AgentGraph');

const FETCH_PAGE_TOOL = 'fetch_trusted_doctor_page';

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

function lastFoundDoctors(messages: BaseMessage[]): FindDoctorsArtifact | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message instanceof ToolMessage && message.name === FIND_DOCTORS_TOOL && message.artifact) {
      return message.artifact as FindDoctorsArtifact;
    }
  }
  return undefined;
}

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



export type SearchPlan = {
  wantsDoctor: boolean;
  speciality: string | null;
  town: string | null;
};

function searchPlanSchema(specialityNames: string[]) {
  return z.object({
    wantsDoctor: z.boolean(),
    speciality: z.enum(specialityNames as [string, ...string[]]).nullable(),
    town: z.string().nullable(),
  });
}

function townPickSchema(townNames: string[]) {
  return z.object({
    town: z.enum(townNames as [string, ...string[]]).nullable(),
  });
}

const AgentState = Annotation.Root({
  ...MessagesAnnotation.spec,
  triageResult: Annotation<TriageResult | undefined>({
    reducer: (_, update) => update,
    default: () => undefined,
  }),
  searchPlan: Annotation<SearchPlan | undefined>({
    reducer: (_, update) => update,
    default: () => undefined,
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

function createAgentGraph(
  model: ChatOpenAI,
  triageModel: ChatOpenAI,
  tavilyApiKey: string,
  httpService: HttpService,
  llmConfig: LlmConfig,
) {
  const doctorSources = createDoctorSources(httpService, llmConfig);
  const findDoctorsTool = createFindDoctorsTool(doctorSources, llmConfig);
  // web_search (Tavily) only when TAVILY_API_KEY is set; the agent may use it
  // for details about one facility (web page, phone), not to find doctors.
  const webSearchEnabled = tavilyApiKey.trim() !== '';
  const tools = [
    findDoctorsTool, // all doctor sources (see sources/index.ts)
    ...(webSearchEnabled ? [createWebSearchTool(tavilyApiKey)] : []),
  ];
  const assistantPrompt = webSearchEnabled
    ? `${llmConfig.systemPrompts.assistant}
${llmConfig.systemPrompts.webSearchNote}`
    : llmConfig.systemPrompts.assistant;
  const assistantModel = model.bindTools(tools);
  const triage = createTriageStep(triageModel, llmConfig);
  const emergencyModel = model;

  const responseModel = model.withStructuredOutput(doctorResponseSchemaForModel(llmConfig.doctorResponse), {
    method: 'jsonSchema',
    strict: true,
  });
  const toolNode = new ToolNode(tools);


  // exact town name from the website
  async function pickTown(specialityName: string, userTown: string): Promise<string> {
    const towns = await findTowns(doctorSources, specialityName); // cached, find_doctors reuses it
    if (towns.length === 0) return userTown;
    const direct = matchTown(userTown, towns);
    if (direct) return direct.name;

    const names = towns.map((town) => town.name);
    const { town } = await model
      .withStructuredOutput(townPickSchema(names), { method: 'jsonSchema', strict: true })
      .invoke([
        new SystemMessage(llmConfig.systemPrompts.townPicker),
        new HumanMessage(fillTemplate(llmConfig.townPickerInput, { towns: names.join(', '), userTown })),
      ]);
    agentLogger.log(`pickTown: "${userTown}" -> ${town ?? 'none'}`);
    return town ?? userTown;
  }

  return new StateGraph(AgentState)
    .addNode('triage', async ({ messages }) => ({ triageResult: await triage(messages) }))
    .addNode('emergency', async ({ messages }) => {
      const latestMessage = [...messages]
        .reverse()
        .find(
          (message): message is HumanMessage => message instanceof HumanMessage,
        );

      let text = '';
      if (latestMessage) {
        try {
          const response = await emergencyModel.invoke([
            new SystemMessage(llmConfig.systemPrompts.emergencyResponse),
            latestMessage,
          ]);
          text = messageText(response).trim();
        } catch (error) {
          agentLogger.error(`emergency: model call failed, using fixed text: ${String(error)}`);
        }
      }
      if (!text) text = llmConfig.fallbackMessages.emergency.trim();

      return {
        messages: [new AIMessage(text)],
        response: { text, doctors: [] },
      };
    })
    .addNode('planSearch', async ({ messages }) => {
      // speciality names from all doctor sites (cached), if sites down - skip
      const specialityNames = await findSpecialities(doctorSources);
      if (specialityNames.length === 0) {
        agentLogger.warn('planSearch: no specialities from any doctor source, agent decides alone');
        return {};
      }

      let plan: SearchPlan;
      try {
        plan = await model
          .withStructuredOutput(searchPlanSchema(specialityNames), {
            method: 'jsonSchema',
            strict: true,
          })
          .invoke([
            new SystemMessage(llmConfig.systemPrompts.searchPlanner),
            new HumanMessage(conversationTranscript(messages, llmConfig.transcript)),
          ]);

        if (plan.wantsDoctor && plan.speciality && plan.town) {
          plan = { ...plan, town: await pickTown(plan.speciality, plan.town) };
        }
      } catch (error) {
        agentLogger.warn(`planSearch failed, agent decides alone: ${String(error)}`);
        return {};
      }
      agentLogger.log(`planSearch result: ${JSON.stringify(plan)}`);

      if (!plan.wantsDoctor || !plan.speciality) return { searchPlan: plan };

      const toolCall = {
        id: `plan_${randomUUID()}`,
        name: FIND_DOCTORS_TOOL,
        args: { speciality: plan.speciality, ...(plan.town ? { town: plan.town } : {}) },
        type: 'tool_call' as const,
      };
      try {
        const toolMessage = (await findDoctorsTool.invoke(toolCall)) as ToolMessage;
        return {
          searchPlan: plan,
          messages: [new AIMessage({ content: '', tool_calls: [toolCall] }), toolMessage],
          toolsUsed: true,
          toolRounds: 1,
        };
      } catch (error) {
        agentLogger.warn(`planSearch: find_doctors failed: ${String(error)}`);
        return { searchPlan: plan };
      }
    })
    .addNode('agent', async ({ messages, triageResult }) => ({
      messages: [
        await assistantModel.invoke([
          new SystemMessage(assistantPrompt),
          ...compactOldPages(messages),
          ...(triageResult?.level === 2 ? [new SystemMessage(llmConfig.systemPrompts.urgentNote)] : []),
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

      const found = lastFoundDoctors(history);
      if (found) {
        response = {
          text:
            lastAssistantText(history) ??
            fillTemplate(llmConfig.fallbackMessages.doctorsFound, { count: found.doctors.length }),
          doctors: found.doctors,
        };
      }
      else {
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
        const text = lastAssistantText(history) || llmConfig.fallbackMessages.answerFailed.trim();
        agentLogger.warn('finalize: no structured output, using last agent message');
        response = { text, doctors: [] };
      }

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

    .addEdge(START, 'triage')
    .addConditionalEdges('triage', ({ triageResult }) =>
      triageResult && triageResult.level >= 3 ? 'emergency' : 'planSearch',
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

  // possible outcomes:
  // default    // START -> triage -> planSearch -> agent -> tools (-> agent -> ...) -> finalize -> END
  // emergency  // START -> triage -> emergency -> END
}

@Injectable()
export class AgentService {
  private readonly graph: ReturnType<typeof createAgentGraph>;

  constructor(
    config: ConfigService,
    private readonly httpService: HttpService,
  ) {
    const main = readLlmSettings(config);
    const triage = readTriageLlmSettings(config);
    agentLogger.log(`models: ${main.model}, triage: ${triage.model}`);

    this.graph = createAgentGraph(
      createChatModel(main),
      createChatModel(triage),
      config.getOrThrow<string>('TAVILY_API_KEY'),
      this.httpService,
      config.getOrThrow<LlmConfig>('llm'),
    );
  }

  streamEvents(messages: BaseMessage[]) {
    return this.graph.streamEvents({ messages }, { version: 'v2' });
  }
}
