import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { HumanMessage, AIMessage, BaseMessage } from '@langchain/core/messages';
import { DbService } from '../db/db.service.js';
import { AgentService } from './agent.service.js';
import type { DoctorResponse } from './doctor-response.js';

const DEBUG = true;
export type StreamChunk =
  | string
  | DoctorResponse
  | { type: 'heartbeat'; timestamp: string }
  | { type: 'error'; message: string };

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
      this.logger.error(
        `[stream=${streamId}] Stream session not found or expired`,
      );
      yield {
        type: 'error',
        message:
          'Stream session not found or expired. Create a new message and use its returned streamId.',
      };
      return;
    }

    this.streamQueue.delete(streamId);
    const { sessionId, messages } = queueData;
    this.logger.log(
      `[${sessionId}] Starting stream [stream=${streamId}]`,
    );

    const eventStream = this.agentService.streamEvents(messages);
    let completeAssistantResponse = '';
    let completeDoctorResponse: DoctorResponse | undefined;
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
          if (graphNode === 'emergency' || graphNode === 'finalize') {
            const response = event.data.output?.response as
              | DoctorResponse
              | undefined;
            if (response) {
              completeAssistantResponse = response.text;
              completeDoctorResponse = response;
            }
          }
          break;
        case 'on_chain_error':
          this.logger.error(
            `[${sessionId}] Graph node failed${eventNode}`,
            formatError(event.data.error ?? event.data),
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
            formatError(event.data.error ?? event.data),
          );
          break;
        case 'on_chat_model_stream': {
          // These nodes produce JSON for the code, not text for the user.
          if (
            graphNode === 'checkEmergency' ||
            graphNode === 'planSearch' ||
            graphNode === 'finalize'
          ) {
            break;
          }

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
            formatError(event.data.error ?? event.data),
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

    try {
      const history = this.sessions.get(sessionId) || messages;
      history.push(new AIMessage(completeAssistantResponse));
      this.sessions.set(sessionId, history);

      await this.dbService.saveMessage(
        sessionId,
        'assistant',
        completeAssistantResponse,
      );
    } catch (error) {
      this.logger.error(
        `[${sessionId}] Failed to persist assistant response: ${getErrorMessage(error)}`,
        error instanceof Error ? error.stack : formatError(error),
      );
    }

    if (DEBUG) {
      this.logger.log(
        `[${sessionId}] Assistant response:\n${completeAssistantResponse}`,
      );
    }
    if (completeDoctorResponse) {
      yield completeDoctorResponse;
    }

    this.logger.log(`[${sessionId}] Stream completed [stream=${streamId}]`);
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

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
