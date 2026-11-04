import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { HumanMessage, AIMessage, BaseMessage } from '@langchain/core/messages';
import { DbService } from '../db/db.service.js';
import { AgentService } from './agent.service.js';

const DEBUG = true;

@Injectable()
export class ChatSessionService {
  private readonly logger = new Logger(ChatSessionService.name);
  private sessions = new Map<string, BaseMessage[]>();
  private streamQueue = new Map<
    string,
    { sessionId: string; messages: BaseMessage[] }
  >();

  constructor(
    private dbService: DbService,
    private agentService: AgentService,
  ) {}

  public async prepareStream(prompt: string, incomingSessionId?: string) {
    const sessionId = incomingSessionId || randomUUID();

    if (incomingSessionId && !this.sessions.has(sessionId)) {
      const dbHistory = await this.dbService.getSessionHistory(sessionId);
      if (!dbHistory) {
        throw new Error('Unable to get session history');
      }

      const formattedHistory = dbHistory.map((row: any) =>
        row.role === 'user'
          ? new HumanMessage(row.content)
          : new AIMessage(row.content),
      );

      this.sessions.set(sessionId, formattedHistory);
    }

    const history = this.sessions.get(sessionId) || [];

    history.push(new HumanMessage(prompt));
    this.sessions.set(sessionId, history);
    await this.dbService.saveMessage(sessionId, 'user', prompt);

    const streamId = randomUUID();
    this.streamQueue.set(streamId, { sessionId, messages: history });

    return { streamId, sessionId };
  }

  async *generateStream(streamId: string) {
    const queueData = this.streamQueue.get(streamId);

    if (!queueData) {
      throw new NotFoundException('Stream session not found or expired');
    }

    this.streamQueue.delete(streamId);
    const { sessionId, messages } = queueData;

    const eventStream = this.agentService.streamEvents(messages);
    let completeAssistantResponse = '';
    let messageTokenUsage = {
      input: 0,
      output: 0,
      total: 0,
    };

    try {
      for await (const event of eventStream) {
        const graphNode = event.metadata?.langgraph_node;
        const eventNode = graphNode ? ` [node=${graphNode}]` : '';
        const isGraphNodeLifecycle =
          Boolean(graphNode) && event.name === graphNode;

        switch (event.event) {
        case 'on_chain_start':
          if (!isGraphNodeLifecycle) break;
          this.logger.log(
            `[${sessionId}] Graph node started${eventNode}`,
          );
          break;
        case 'on_chain_end':
          if (!isGraphNodeLifecycle) break;
          this.logger.log(`[${sessionId}] Graph node finished${eventNode}`);
          break;
        case 'on_chain_error':
          if (!isGraphNodeLifecycle) break;
          this.logger.error(
            `[${sessionId}] Graph node failed${eventNode}`,
            event.data.error,
          );
          break;
        case 'on_chat_model_start':
          this.logger.log(
            `[${sessionId}] Model call started${eventNode}`,
          );
          break;
        case 'on_chat_model_error':
          this.logger.error(
            `[${sessionId}] Model call failed${eventNode}`,
            getErrorMessage(event.data.error),
          );
          break;
        case 'on_chat_model_stream': {
          if (graphNode === 'checkEmergency') break;

          const content = event.data.chunk?.content;
          if (!content) break;
          completeAssistantResponse += content;
          yield content;
          break;
        }
        case 'on_chat_model_end': {
          const usage = getTokenUsage(event.data.output);
          messageTokenUsage = addTokenUsage(messageTokenUsage, usage);
          this.logger.log(
            `[${sessionId}] Model call finished${eventNode} ` +
              `tokens: input=${usage.input}, output=${usage.output}, total=${usage.total}`,
          );
          break;
        }
        case 'on_tool_start':
          this.logger.log(
            `[${sessionId}] Tool call started: ${event.name}(${JSON.stringify(event.data.input)})`,
          );
          break;
        case 'on_tool_end':
          this.logger.log(
            `[${sessionId}] Tool call finished: ${event.name}\n${event.data.output?.content ?? event.data.output}`,
          );
          break;
        case 'on_tool_error':
          this.logger.error(
            `[${sessionId}] Tool error: ${event.name}`,
            event.data.error,
          );
          break;
        }
      }
    } catch (error) {
      const message = getErrorMessage(error);
      this.logger.error(
        `[${sessionId}] Agent stream failed: ${message}`,
        error instanceof Error ? error.stack : undefined,
      );
      yield 'The assistant could not complete this response. Please try again.';
    }

    this.logger.log(
      `[${sessionId}] Message token usage: ` +
        `input=${messageTokenUsage.input}, output=${messageTokenUsage.output}, ` +
        `total=${messageTokenUsage.total}`,
    );

    const history = this.sessions.get(sessionId) || messages;
    history.push(new AIMessage(completeAssistantResponse));
    this.sessions.set(sessionId, history);

    await this.dbService.saveMessage(
      sessionId,
      'assistant',
      completeAssistantResponse,
    );

    if (DEBUG) {
      this.logger.log(
        `[${sessionId}] Assistant response:\n${completeAssistantResponse}`,
      );
      yield completeAssistantResponse;
    }
  }

}

type TokenUsage = {
  input: number;
  output: number;
  total: number;
};

function getTokenUsage(output: any): TokenUsage {
  const usage = output?.usage_metadata ?? output?.response_metadata?.token_usage;
  const input = usage?.input_tokens ?? usage?.prompt_tokens ?? 0;
  const outputTokens = usage?.output_tokens ?? usage?.completion_tokens ?? 0;
  const total = usage?.total_tokens ?? input + outputTokens;

  return {
    input,
    output: outputTokens,
    total,
  };
}

function addTokenUsage(total: TokenUsage, usage: TokenUsage): TokenUsage {
  return {
    input: total.input + usage.input,
    output: total.output + usage.output,
    total: total.total + usage.total,
  };
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
