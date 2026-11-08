import {
  Body,
  Controller,
  Param,
  Post,
  Sse,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import {
  catchError,
  defer,
  finalize,
  from,
  map,
  merge,
  Observable,
  of,
  Subject,
  takeUntil,
  timer,
} from 'rxjs';
import { ConfigService } from '@nestjs/config';
import type { LlmConfig } from '../../config/llm.config.js';
import { ChatSessionService } from '../../services/llm/chat-session.service.js';
import type { DoctorResponse } from '../../services/llm/doctor-response.js';
import type { StreamChunk } from '../../services/llm/chat-session.service.js';

@Controller('chat')
export class ChatController {
  private readonly logger = new Logger(ChatController.name);
  private readonly errors: LlmConfig['errors'];

  constructor(
    private readonly chatSessionService: ChatSessionService,
    config: ConfigService,
  ) {
    this.errors = config.getOrThrow<LlmConfig>('llm').errors;
  }

  @Post()
  async sendMessage(@Body() body: { prompt: string; sessionId?: string }) {
    if (!body.prompt) {
      throw new BadRequestException(this.errors.messageRequired);
    }

    return this.chatSessionService.prepareStream(body.prompt, body.sessionId);
  }

  @Sse('stream/:id')
  streamAIResponse(@Param('id') id: string): Observable<MessageEvent> {
    return defer(() => {
      this.logger.log(`[ChatController] Opening stream ${id}`);
      return from(this.chatSessionService.generateStream(id));
    }).pipe(
      (source) => {
        const completed$ = new Subject<void>();
        const heartbeat$ = timer(10_000, 10_000).pipe(
          takeUntil(completed$),
          map(() => {
            const timestamp = new Date().toISOString();
            this.logger.log(`[ChatController] SSE heartbeat ${id}: ${timestamp}`);
            return {
              type: 'heartbeat',
              timestamp,
            } satisfies StreamChunk;
          }),
        );

        return merge(
          source.pipe(finalize(() => completed$.next())),
          heartbeat$,
        ).pipe(
          finalize(() => {
            completed$.next();
            completed$.complete();
          }),
        );
      },
      map(
        (chunk) =>
          ({
            data: toSseData(chunk),
          }) as MessageEvent,
      ),
      catchError((error: unknown) => {
        this.logger.error(
          `[ChatController] Stream failed ${id}`,
          error instanceof Error ? error.stack : String(error),
        );
        return of({
          data: {
            type: 'error',
            message: this.errors.streamFailed,
          },
        } as MessageEvent);
      }),
    );
  }
}

function toSseData(chunk: StreamChunk): Record<string, unknown> {
  if (typeof chunk === 'string') {
    return { text: chunk };
  }

  if (
    'type' in chunk &&
    (chunk.type === 'heartbeat' || chunk.type === 'error' || chunk.type === 'debug')
  ) {
    return chunk;
  }

  return chunk as DoctorResponse;
}
