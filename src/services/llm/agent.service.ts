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
import { InMemoryStore } from '@langchain/core/stores';
import {
  AIMessage,
  BaseMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from '@langchain/core/messages';
import type { LlmConfig } from '../../config/llm.config.js';
import { resolveTrustedUrl } from './tools/fetch-trusted-doctor-page.tool.js';
import {
  createFindDoctorsTool,
  FIND_DOCTORS_TOOL,
  type FindDoctorsArtifact,
} from './tools/find-doctors.tool.js';
import { createDoctorSources } from './sources/index.js';
import { createFindMedicalFacilityTool } from './tools/find-medical-facility.tool.js';
import { createWebSearchTool } from './tools/web-search.tool.js';
import { createFacilityToolForModel, FIND_MEDICAL_FACILITY_TOOL } from './tools/facility-result.js';
import { fillTemplate } from '../../config/template.js';
import type { TriageResult } from './triage/triage.js';
import { createTriageStep } from './triage/triage-step.js';
import { messageText } from './transcript.js';
import { createChatModel, readLlmSettings, readTriageLlmSettings } from './llm-model.js';
import { withoutSameDoctors } from './same-doctor.js';
import { createMemoryTools } from './tools/memory.tool.js';
import { DbService } from '../db/db.service.js';
import {
  doctorResponseSchemaForModel,
  type DoctorResponse,
} from './doctor-response.js';


const MAX_TOOL_ROUNDS = 10;
const MAX_EMERGENCY_TOOL_ROUNDS = 5;
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

const MAX_DOCTORS_IN_ANSWER = 20;
const DOCTOR_TOOLS = [FIND_MEDICAL_FACILITY_TOOL, FIND_DOCTORS_TOOL];

function foundDoctors(messages: BaseMessage[]): FindDoctorsArtifact | undefined {
  const sinceLastQuestion = messages.slice(
    messages.findLastIndex((message) => message instanceof HumanMessage) + 1,
  );
  const artifacts = DOCTOR_TOOLS.flatMap((name) =>
    sinceLastQuestion
      .filter((m): m is ToolMessage => m instanceof ToolMessage && m.name === name && Boolean(m.artifact))
      .map((m) => m.artifact as FindDoctorsArtifact),
  );
  if (artifacts.length === 0) return undefined;

  // The register and zoznam-lekarov.sk often list the same doctor; keep the register's.
  const doctors = withoutSameDoctors(artifacts.flatMap((artifact) => artifact.doctors)).slice(
    0,
    MAX_DOCTORS_IN_ANSWER,
  );
  return { doctors, sourceUrls: artifacts.flatMap((artifact) => artifact.sourceUrls) };
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



const AgentState = Annotation.Root({
  ...MessagesAnnotation.spec,
  triageResult: Annotation<TriageResult | undefined>({
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
  dbService: DbService,
  memoryStore: InMemoryStore<{ id: string; content: string }[]>,
  sessionId: string,
) {
  const doctorSources = createDoctorSources(httpService, llmConfig);
  const findDoctorsTool = createFindDoctorsTool(doctorSources, llmConfig);
  const findMedicalFacilityTool = createFindMedicalFacilityTool();
  const facilityToolForModel = createFacilityToolForModel(findMedicalFacilityTool, llmConfig);
  const memoryTools = createMemoryTools(memoryStore, dbService, sessionId);

  const webSearchEnabled = tavilyApiKey.trim() !== '';
  if (webSearchEnabled && !tavilyApiKey.trim().startsWith('tvly-')) {
    agentLogger.warn('TAVILY_API_KEY does not look like a Tavily key (tvly-...); web_search will fail');
  }

  const tools = [
    facilityToolForModel,
    findDoctorsTool,
    ...memoryTools,
    ...(webSearchEnabled ? [createWebSearchTool(tavilyApiKey)] : []),
  ];
  const assistantPrompt = webSearchEnabled
    ? `${llmConfig.systemPrompts.assistant}\n${llmConfig.systemPrompts.webSearchNote}`
    : llmConfig.systemPrompts.assistant;
  const assistantModel = model.bindTools(tools);
  const triage = createTriageStep(triageModel, llmConfig);
  const emergencyModel = model.bindTools(memoryTools);

  const responseModel = model.withStructuredOutput(doctorResponseSchemaForModel(llmConfig.doctorResponse), {
    method: 'jsonSchema',
    strict: true,
  });
  const toolNode = new ToolNode(tools);
  const emergencyToolNode = new ToolNode(memoryTools);

  return new StateGraph(AgentState)
    .addNode('triage', async ({ messages }) => ({ triageResult: await triage(messages) }))
    .addNode('emergency', async ({ messages, toolRounds }) => {
      try {
        if (toolRounds >= MAX_EMERGENCY_TOOL_ROUNDS) {
          const text = llmConfig.fallbackMessages.emergency.trim();
          return {
            messages: [new AIMessage(text)],
            response: { text, doctors: [] },
          };
        }

        const latestMessageIndex = messages.findLastIndex(
          (message) => message instanceof HumanMessage,
        );
        const response = await emergencyModel.invoke([
          new SystemMessage(
            `${llmConfig.systemPrompts.emergencyResponse}\n${llmConfig.systemPrompts.emergencyMemory}`,
          ),
          ...messages.slice(latestMessageIndex),
        ]);
        if (response instanceof AIMessage && response.tool_calls?.length) {
          return { messages: [response] };
        }

        const text = messageText(response).trim() || llmConfig.fallbackMessages.emergency.trim();
        return {
          messages: [new AIMessage(text)],
          response: { text, doctors: [] },
        };
      } catch (error) {
        agentLogger.error(`emergency: model call failed, using fixed text: ${String(error)}`);
        const text = llmConfig.fallbackMessages.emergency.trim();
        return {
          messages: [new AIMessage(text)],
          response: { text, doctors: [] },
        };
      }
    })
    .addNode('emergencyTools', async (state) => ({
      ...(await emergencyToolNode.invoke(state)),
      toolRounds: state.toolRounds + 1,
    }))
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

      const found = foundDoctors(history);
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
      triageResult && triageResult.level >= 3 ? 'emergency' : 'agent',
    )
    .addConditionalEdges('emergency', ({ messages }) => {
      const lastMessage = messages[messages.length - 1];
      return lastMessage instanceof AIMessage && (lastMessage.tool_calls?.length ?? 0) > 0
        ? 'emergencyTools'
        : END;
    })
    .addEdge('emergencyTools', 'emergency')
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
  private readonly model: ChatOpenAI;
  private readonly triageModel: ChatOpenAI;
  private readonly tavilyApiKey: string;
  private readonly llmConfig: LlmConfig;
  private readonly memoryStore = new InMemoryStore<{ id: string; content: string }[]>();

  constructor(
    config: ConfigService,
    private readonly httpService: HttpService,
    private readonly dbService: DbService,
  ) {
    const main = readLlmSettings(config);
    const triage = readTriageLlmSettings(config);
    agentLogger.log(`models: ${main.model}, triage: ${triage.model}`);

    this.model = createChatModel(main);
    this.triageModel = createChatModel(triage);
    this.tavilyApiKey = config.getOrThrow<string>('TAVILY_API_KEY');
    this.llmConfig = config.getOrThrow<LlmConfig>('llm');
  }

  streamEvents(
    messages: BaseMessage[],
    sessionId: string,
  ) {
    const graph = createAgentGraph(
      this.model,
      this.triageModel,
      this.tavilyApiKey,
      this.httpService,
      this.llmConfig,
      this.dbService,
      this.memoryStore,
      sessionId,
    );
    return graph.streamEvents(
      { messages },
      { version: 'v2' },
    );
  }
}
