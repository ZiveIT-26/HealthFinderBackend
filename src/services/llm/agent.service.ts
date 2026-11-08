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
} from '@langchain/core/messages';
import { z } from 'zod';
import type { LlmConfig } from '../../config/llm.config.js';
// import { createFetchTrustedDoctorPageTool } from './tools/fetch-trusted-doctor-page.tool.js';
import { createWebSearchTool } from './tools/web-search.tool.js';
import { createFindMedicalFacilityTool} from './tools/find-medical-facility.tool.js';
// import { createGetTrustedDoctorSourceInstructionsTool } from './tools/get-trusted-doctor-source-instructions.tool.js';
// import { createListTrustedDoctorSourcesTool } from './tools/list-trusted-doctor-sources.tool.js';
import {
  doctorResponseSchema,
  type DoctorResponse,
} from './doctor-response.js';

const EMERGENCY_CONFIDENCE_THRESHOLD = 0.7;
const agentLogger = new Logger('AgentGraph');

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
});

function createAgentGraph(
  llm: { apiKey: string; baseURL?: string; model: string },
  tavilyApiKey: string,
  httpService: HttpService,
  llmConfig: LlmConfig,
) {
  const tools = [
    createWebSearchTool(tavilyApiKey),
    // createFetchTrustedDoctorPageTool(httpService, llmConfig),
    // createListTrustedDoctorSourcesTool(llmConfig.trustedDoctorSources),
    // createGetTrustedDoctorSourceInstructionsTool(
    //   llmConfig.trustedDoctorSources,
    // ),
    createFindMedicalFacilityTool(),
  ];
  const model = new ChatOpenAI({
    model: llm.model,
    temperature: 0,
    apiKey: llm.apiKey,
    configuration: llm.baseURL ? { baseURL: llm.baseURL } : undefined,
  });
  const assistantModel = model.bindTools(tools);
  const checkEmergencyModel = model.withStructuredOutput(checkEmergencySchema, {
    method: 'jsonSchema',
    strict: true,
  });
  const emergencyModel = model;
  const responseModel = model.withStructuredOutput(doctorResponseSchema, {
    method: 'functionCalling',
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
      const text = response.content.toString();

      return {
        messages: [new AIMessage(text)],
        response: { text, doctors: [] },
      };
    })
    .addNode('agent', async ({ messages }) => ({
      messages: [
        await assistantModel.invoke([
          new SystemMessage(llmConfig.systemPrompts.assistant),
          ...messages,
        ]),
      ],
    }))
    .addNode('tools', async (state) => ({
      ...(await toolNode.invoke(state)),
      toolsUsed: true,
    }))
    .addNode('finalize', async ({ messages }) => {
      const response = await responseModel.invoke([
        new SystemMessage(llmConfig.systemPrompts.responseFormatter),
        ...messages,
      ]);

      return {
        response,
        messages: [new AIMessage(response.text)],
      };
    })
    .addEdge(START, 'checkEmergency')
    .addConditionalEdges('checkEmergency', ({ isEmergency }) =>
      isEmergency ? 'emergency' : 'agent',
    )
    .addEdge('emergency', END)
    .addConditionalEdges('agent', ({ messages, toolsUsed }) => {
      const lastMessage = messages[messages.length - 1];
      return lastMessage instanceof AIMessage &&
        (lastMessage.tool_calls?.length ?? 0) > 0
        ? 'tools'
        : toolsUsed
          ? 'finalize'
          : END;
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
    let llm: { apiKey: string; baseURL?: string; model: string };

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

      llm = { apiKey: 'ollama', baseURL, model };
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
