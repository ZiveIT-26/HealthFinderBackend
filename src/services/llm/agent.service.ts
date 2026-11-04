import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';
import { StateGraph, MessagesAnnotation, START } from '@langchain/langgraph';
import { ToolNode, toolsCondition } from '@langchain/langgraph/prebuilt';
import { BaseMessage, SystemMessage } from '@langchain/core/messages';
import { createSearchDoctorsTool } from './tools/search-doctors.tool.js';

const SYSTEM_PROMPT = `You are a medical assistant that helps users find doctors in Kosice region.
Your task is to determine the specialist user requires and then offer variants.
Use the search_doctors tool when the user asks for a specialist.
Answer concisely.`;

function createAgentGraph(
  llm: { apiKey: string; baseURL?: string; model: string },
  tavilyApiKey: string,
) {
  const tools = [createSearchDoctorsTool(tavilyApiKey)];
  const model = new ChatOpenAI({
    model: llm.model,
    temperature: 0,
    apiKey: llm.apiKey,
    configuration: llm.baseURL ? { baseURL: llm.baseURL } : undefined,
  }).bindTools(tools);

  return new StateGraph(MessagesAnnotation)
    .addNode('agent', async ({ messages }) => ({
      messages: [
        await model.invoke([new SystemMessage(SYSTEM_PROMPT), ...messages]),
      ],
    }))
    .addNode('tools', new ToolNode(tools))
    .addEdge(START, 'agent')
    .addConditionalEdges('agent', toolsCondition)
    .addEdge('tools', 'agent')
    .compile();
}

@Injectable()
export class AgentService {
  private readonly graph: ReturnType<typeof createAgentGraph>;

  constructor(config: ConfigService) {
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
    );
  }

  streamEvents(messages: BaseMessage[]) {
    return this.graph.streamEvents({ messages }, { version: 'v2' });
  }
}
