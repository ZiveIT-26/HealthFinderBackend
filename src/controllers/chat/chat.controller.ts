import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  BadRequestException,
  Logger,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  catchError,
  defer,
  finalize,
  from,
  map,
  merge,
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
  async sendMessage(
    @Body() body: { prompt: string; sessionId?: string },
  ) {
    if (!body.prompt) {
      throw new BadRequestException(this.errors.messageRequired);
    }

    return this.chatSessionService.prepareStream(
      body.prompt,
      body.sessionId,
    );
  }

  @Get('stream/:id')
  streamAIResponse(
    @Param('id') id: string,
    @Res() response: Response,
  ): void {
    response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    response.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    response.setHeader('Connection', 'keep-alive');
    response.setHeader('X-Accel-Buffering', 'no');
    response.flushHeaders();

    const stream = defer(() => {
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

    const subscription = stream.subscribe({
    next: (event) => {
      response.write(`data: ${JSON.stringify(event.data)}\n\n`);
    },
    error: (error: unknown) => {
      this.logger.error(
        `[ChatController] Stream failed ${id}`,
        error instanceof Error ? error.stack : String(error),
      );
      response.end();
    },
    complete: () => response.end(),
    });

    response.on('close', () => subscription.unsubscribe());
  }
}

function toSseData(chunk: StreamChunk): Record<string, unknown> {
  if (typeof chunk === 'string') {
    return { type: 'token', text: chunk };
  }

  if (
    'type' in chunk &&
    (chunk.type === 'heartbeat' ||
      chunk.type === 'error' ||
      chunk.type === 'debug')
  ) {
    return chunk;
  }

  const doctorResponse = chunk as DoctorResponse;
  return {
    type: 'doctors_list',
    doctors: doctorResponse.doctors,
  };
}
