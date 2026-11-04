import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { OpenAI } from 'openai';
import { ChatCompletionMessageParam } from 'openai/resources';
import { DbService } from '../db/db.service.js';
import { SYSTEM_PROMPT } from './system.prompt.js';

@Injectable()
export class LlmService {
  private readonly openai: OpenAI;
  private readonly model: string;

  private sessions = new Map<string, ChatCompletionMessageParam[]>();
  private streamQueue = new Map<
    string,
    { sessionId: string; messages: ChatCompletionMessageParam[] }
  >();

  constructor(private configService: ConfigService, private dbService: DbService,) {
    //const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    //if (!apiKey) throw new Error('OPENAI_API_KEY is required');
    //this.openai = new OpenAI({ apiKey });

    this.model = this.configService.get<string>('LLM_MODEL') ?? 'gpt-4o'
    this.openai = new OpenAI({
      apiKey: this.configService.get<string>('OPENAI_API_KEY') ?? 'ollama',
      baseURL: this.configService.get<string>('LLM_BASE_URL'),
    });
  }

  public async prepareStream(prompt: string, incomingSessionId?: string) {
    const sessionId = incomingSessionId || randomUUID();

    if (incomingSessionId && !this.sessions.has(sessionId)) {
      const dbHistory = await this.dbService.getSessionHistory(sessionId);
      if (!dbHistory) {
        throw new Error("Unable to get session history");
      }

      const formattedHistory: ChatCompletionMessageParam[] = dbHistory.map(
        (row: any) => ({
          role: row.role as 'user' | 'assistant',
          content: row.content,
        }),
      );

      this.sessions.set(sessionId, formattedHistory);
    }

    const history = this.sessions.get(sessionId) || [];

    history.push({ role: 'user', content: prompt });
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

    const stream = await this.openai.chat.completions.create({
      model: this.model, //'gpt-4o',
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],  // mm: system because WE give instructions
      stream: true,
    });

    let completeAssistantResponse = '';

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || '';
      if (content) {
        completeAssistantResponse += content;
        yield content;
      }
    }

    const history = this.sessions.get(sessionId) || messages;
    history.push({ role: 'assistant', content: completeAssistantResponse });
    this.sessions.set(sessionId, history);

    await this.dbService.saveMessage(
      sessionId,
      'assistant',
      completeAssistantResponse,
    );
  }
}
