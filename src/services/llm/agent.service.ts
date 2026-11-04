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
import { ToolNode, toolsCondition } from '@langchain/langgraph/prebuilt';
import {
  AIMessage,
  BaseMessage,
  HumanMessage,
  SystemMessage,
} from '@langchain/core/messages';
import { z } from 'zod';
import type { LlmConfig } from '../../config/llm.config.js';
import { createApiRequestTool } from './tools/api-request.tool.js';
// import { createSearchDoctorsTool } from './tools/search-doctors.tool.js';
import { createGetTrustedDoctorSourceInstructionsTool } from './tools/get-trusted-doctor-source-instructions.tool.js';
import { createListTrustedDoctorSourcesTool } from './tools/list-trusted-doctor-sources.tool.js';

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
});

function createAgentGraph(
  llm: { apiKey: string; baseURL?: string; model: string },
  tavilyApiKey: string,
  httpService: HttpService,
  llmConfig: LlmConfig,
) {
  const tools = [
    // createSearchDoctorsTool(tavilyApiKey),
    createApiRequestTool(httpService, llmConfig),
    createListTrustedDoctorSourcesTool(llmConfig.trustedDoctorSources),
    createGetTrustedDoctorSourceInstructionsTool(
      llmConfig.trustedDoctorSources,
    ),
  ];
  const model = new ChatOpenAI({
    model: llm.model,
    temperature: 0,
    apiKey: llm.apiKey,
    configuration: llm.baseURL ? { baseURL: llm.baseURL } : undefined,
  });
  const assistantModel = model.bindTools(tools);
  const checkEmergencyModel = model.withStructuredOutput(checkEmergencySchema);
  const emergencyModel = model;

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

      return {
        messages: [
          await emergencyModel.invoke([
            new SystemMessage(llmConfig.systemPrompts.emergencyResponse),
            latestMessage,
          ]),
        ],
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
    .addNode('tools', new ToolNode(tools))
    .addEdge(START, 'checkEmergency')
    .addConditionalEdges('checkEmergency', ({ isEmergency }) =>
      isEmergency ? 'emergency' : 'agent',
    )
    .addEdge('emergency', END)
    .addConditionalEdges('agent', toolsCondition)
    .addEdge('tools', 'agent')
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
