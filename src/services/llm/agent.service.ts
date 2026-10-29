import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';
import { StateGraph, MessagesAnnotation, START } from '@langchain/langgraph';
import { ToolNode, toolsCondition } from '@langchain/langgraph/prebuilt';
import { BaseMessage, SystemMessage } from '@langchain/core/messages';
import {
  createSearchDoctorsTool
} from './tools/search-doctors.tool.js';

const SYSTEM_PROMPT = `You are a medical assistant that helps users find doctors in Kosice region.
Your task is to determine the specialist user requires and then offer variants.
Use the search_doctors tool when the user asks for a specialist.
Answer concisely.`;


function createAgentGraph(apiKey: string, tavilyApiKey: string) {
  const tools = [createSearchDoctorsTool(tavilyApiKey)];
  const model = new ChatOpenAI({
    model: 'gpt-4o',
    temperature: 0,
    apiKey,
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
    this.graph = createAgentGraph(
      config.getOrThrow<string>('OPENAI_API_KEY'),
      config.getOrThrow<string>('TAVILY_API_KEY'),
    );
  }

  streamEvents(messages: BaseMessage[]) {
    return this.graph.streamEvents({ messages }, { version: 'v2' });
  }
}
