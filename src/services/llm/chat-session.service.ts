import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { LlmConfig } from '../../config/llm.config.js';
import { randomUUID } from 'node:crypto';
import { HumanMessage, AIMessage, BaseMessage } from '@langchain/core/messages';
import { DbService } from '../db/db.service.js';
import { AgentService } from './agent.service.js';
import type { DoctorResponse } from './doctor-response.js';
import type { UserLocation } from './user-location.js';
import type { DebugEvent, TokenUsage } from './debug-events.js';
import type { SearchPlan } from './agent.service.js';
import { TRIAGE_LEVEL_NAMES, type TriageResult } from './triage/triage.js';

const DEBUG = false;
export type StreamChunk =
  | string
  | DoctorResponse
  | DebugEvent
  | { type: 'heartbeat'; timestamp: string }
  | { type: 'error'; message: string };

@Injectable()
export class ChatSessionService {
  private readonly logger = new Logger(ChatSessionService.name);
  private sessions = new Map<string, BaseMessage[]>();
  /** Last doctor search per session, so "A kardiológ?" keeps the town. */
  private lastSearch = new Map<string, SearchPlan>();
  private streamQueue = new Map<
    string,
    { sessionId: string; messages: BaseMessage[]; userLocation?: UserLocation }
  >();

  constructor(
    private dbService: DbService,
    private agentService: AgentService,
    private config: ConfigService,
  ) {}

  public async prepareStream(prompt: string, incomingSessionId?: string, userLocation?: UserLocation) {
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
    this.streamQueue.set(streamId, { sessionId, messages: history, userLocation });

    return { streamId, sessionId };
  }


  //
  async *generateStream(
    streamId: string,
    options: { debug?: boolean } = {},
  ): AsyncGenerator<StreamChunk> {
    const queueData = this.streamQueue.get(streamId);

    if (!queueData) {
      this.logger.error(
        `[stream=${streamId}] Stream session not found or expired`,
      );
      yield {
        type: 'error',
        message: this.config.getOrThrow<LlmConfig>('llm').errors.streamNotFound,
      };
      return;
    }

    this.streamQueue.delete(streamId);
    const { sessionId, messages, userLocation } = queueData;
    this.logger.log(
      `[${sessionId}] Starting stream [stream=${streamId}]`,
    );

    const debug = options.debug === true;
    const streamStartedAt = Date.now();
    const runStartedAt = new Map<string, number>();
    let modelCalls = 0;
    let toolCalls = 0;

    if (debug) {
      yield {
        type: 'debug',
        kind: 'context',
        sessionId,
        messages: messages.length,
        chars: messages.reduce((sum, message) => sum + contentLength(message.content), 0),
      };
    }

    const eventStream = this.agentService.streamEvents(messages, {
      userLocation,
      previousSearch: this.lastSearch.get(sessionId),
    });
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
          if (debug && graphNode === 'triage') {
            const triage = event.data.output?.triageResult as TriageResult | undefined;
            if (triage) {
              yield {
                type: 'debug',
                kind: 'triage',
                level: triage.level,
                levelName: TRIAGE_LEVEL_NAMES[triage.level],
                modelLevel: triage.modelLevel,
                hasSymptoms: triage.hasSymptoms,
                redFlags: triage.redFlags,
                reasons: triage.reasons,
              };
            }
          }
          if (graphNode === 'planSearch') {
            const plan = event.data.output?.searchPlan as SearchPlan | undefined;
            if (plan?.wantsDoctor && plan.speciality) this.lastSearch.set(sessionId, plan);
            if (debug && plan) yield { type: 'debug', kind: 'plan', ...plan };
          }
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
          runStartedAt.set(event.run_id, Date.now());
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
          if (
            graphNode === 'triage' ||
            graphNode === 'planSearch' ||
            graphNode === 'finalize'
          ) {
            break;
          }

          const content = event.data.chunk?.content;
          if (!content || typeof content !== 'string') break;
          completeAssistantResponse += content;
          yield content;
          break;
        }
        case 'on_chat_model_end': {
          const usage = getTokenUsage(event.data.output);
          messageTokenUsage = addTokenUsage(messageTokenUsage, usage);
          modelCalls += 1;
          this.logger.log(
            `[${sessionId}] Model call finished${eventNode} ` +
              `tokens: input=${usage.input}, output=${usage.output}, total=${usage.total}`,
          );
          if (debug) {
            yield {
              type: 'debug',
              kind: 'model',
              node: graphNode ?? 'unknown',
              tokens: usage,
              ms: elapsedSince(runStartedAt, event.run_id),
            };
          }
          break;
        }

        case 'on_tool_start':
          runStartedAt.set(event.run_id, Date.now());
          this.logger.log(
            `[${sessionId}] Tool call started: ${event.name}(${JSON.stringify(event.data.input)})`,
          );
          break;
        case 'on_tool_end': {
          toolCalls += 1;
          const output = event.data.output?.content ?? event.data.output;
          const outputText = typeof output === 'string' ? output : JSON.stringify(output ?? '');
          this.logger.log(`[${sessionId}] Tool call finished: ${event.name}\n${outputText}`);
          if (debug) {
            yield {
              type: 'debug',
              kind: 'tool',
              name: event.name,
              args: event.data.input,
              ms: elapsedSince(runStartedAt, event.run_id),
              resultChars: outputText.length,
            };
          }
          break;
        }
        case 'on_tool_error':
          toolCalls += 1;
          this.logger.error(
            `[${sessionId}] Tool error: ${event.name}`,
            formatError(event.data.error ?? event.data),
          );
          if (debug) {
            yield {
              type: 'debug',
              kind: 'tool',
              name: event.name,
              args: event.data.input,
              ms: elapsedSince(runStartedAt, event.run_id),
              error: getErrorMessage(event.data.error ?? event.data),
            };
          }
          break;
        }
      }
    } catch (error) {
      const message = getErrorMessage(error);
      this.logger.error(
        `[${sessionId}] Agent stream failed: ${message}`,
        error instanceof Error ? error.stack : undefined,
      );
      yield this.config.getOrThrow<LlmConfig>('llm').fallbackMessages.answerFailed.trim();
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

    if (debug) {
      yield {
        type: 'debug',
        kind: 'summary',
        ms: Date.now() - streamStartedAt,
        tokens: messageTokenUsage,
        modelCalls,
        toolCalls,
      };
    }

    this.logger.log(`[${sessionId}] Stream completed [stream=${streamId}]`);
  }

  // cli /history
  public async getHistory(sessionId: string): Promise<{ role: string; content: string }[]> {
    return (await this.dbService.getSessionHistory(sessionId)) as {
      role: string;
      content: string;
    }[];
  }
}


function elapsedSince(startedAt: Map<string, number>, runId: string): number {
  const start = startedAt.get(runId);
  startedAt.delete(runId);
  return start === undefined ? 0 : Date.now() - start;
}

function contentLength(content: BaseMessage['content']): number {
  return typeof content === 'string' ? content.length : JSON.stringify(content).length;
}

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
