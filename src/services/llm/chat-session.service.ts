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

    for await (const event of eventStream) {
      switch (event.event) {
        case 'on_chat_model_stream': {
          const content = event.data.chunk?.content;
          if (!content) break;
          completeAssistantResponse += content;
          if (!DEBUG) yield content;
          break;
        }
        case 'on_tool_start':
          this.logger.log(
            `[${sessionId}] Tool call: ${event.name}(${JSON.stringify(event.data.input)})`,
          );
          break;
        case 'on_tool_end':
          this.logger.log(
            `[${sessionId}] Tool result: ${event.name}\n${event.data.output?.content ?? event.data.output}`,
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
