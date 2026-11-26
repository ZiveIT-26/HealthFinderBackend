import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  BadRequestException,
  HttpCode,
  Logger,
  NotFoundException,
  Res,
  Req,
  UnauthorizedException,
  UseGuards,
  Patch, Delete,
} from '@nestjs/common';
import type { Response } from 'express';
import type { Request } from 'express';
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
import { ChatSessionService } from '../../services/llm/chat-session.service.js';
import type { DoctorResponse } from '../../services/llm/doctor-response.js';
import type { StreamChunk } from '../../services/llm/chat-session.service.js';
import { AccessTokenAuthGuard } from '../../auth/access-token-auth.guard.js';
import type { AuthenticatedRequestUser } from '../../auth/auth.types.js';
import {
  DeviceLocationService,
  parseSharedLocation,
} from '../../services/llm/device-location.service.js';

type LocationAnswerBody = {
  requestId?: unknown;
  source?: unknown; //"current" or "home" with `location`, or "declined"
  location?: unknown;
};

@Controller('chat')
@UseGuards(AccessTokenAuthGuard)
export class ChatController {
  private readonly logger = new Logger(ChatController.name);

  constructor(
    private readonly chatSessionService: ChatSessionService,
    private readonly deviceLocation: DeviceLocationService,
  ) {}

  @Post()
  async sendMessage(
    @Body() body: { prompt: string; sessionId?: string; location?: unknown },
    @Req() request: Request & { user: AuthenticatedRequestUser },
  ) {
    if (!body.prompt) {
      throw new BadRequestException('Message is required');
    }

    return this.chatSessionService.prepareStream(
      body.prompt,
      body.sessionId,
      request.user.id,
      // Invalid coordinates are ignored (see docs/API.md).
      parseSharedLocation(body.location, 'current'),
    );
  }


  @Post('location')
  @HttpCode(204)
  answerLocationRequest(
    @Body() body: LocationAnswerBody,
    @Req() request: Request & { user: AuthenticatedRequestUser },
  ): void {
    const { requestId, source } = body ?? {};
    if (typeof requestId !== 'string' || !requestId) {
      throw new BadRequestException('requestId is required');
    }

    let answer: Parameters<DeviceLocationService['answer']>[2];
    if (source === 'declined') {
      answer = 'declined';
    } else if (source === 'current' || source === 'home') {
      const location = parseSharedLocation(body.location, source);
      if (!location) {
        throw new BadRequestException(
          'location must have lat (-90..90) and lon (-180..180) numbers',
        );
      }
      answer = location;
    } else {
      throw new BadRequestException('source must be "current", "home" or "declined"');
    }

    if (!this.deviceLocation.answer(requestId, request.user.id, answer)) {
      throw new NotFoundException('Location request not found or already answered');
    }
  }

  @Get('stream/:id')
  streamAIResponse(
    @Param('id') id: string,
    @Res() response: Response,
    @Req() request: Request & { user: AuthenticatedRequestUser },
  ): void {
    void this.streamWithAuthentication(id, response, request.user.id);
  }

  private async streamWithAuthentication(
    id: string,
    response: Response,
    userId: string,
  ): Promise<void> {
    try {
      await this.chatSessionService.assertStreamOwner(id, userId);
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        response.status(error.getStatus()).json(error.getResponse());
        return;
      }
      throw error;
    }

    response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    response.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    response.setHeader('Connection', 'keep-alive');
    response.setHeader('X-Accel-Buffering', 'no');
    response.flushHeaders();

    const stream = defer(() => {
      this.logger.log(`[ChatController] Opening stream ${id}`);
      return from(this.chatSessionService.generateStream(id, userId));
    }).pipe(
      (source) => {
        const completed$ = new Subject<void>();
        const heartbeat$ = timer(10_000, 10_000).pipe(
          takeUntil(completed$),
          map(() => {
            const timestamp = new Date().toISOString();
            this.logger.log(
              `[ChatController] SSE heartbeat ${id}: ${timestamp}`,
            );
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
            message: 'The stream could not be completed. Please try again.',
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

  @Patch('sessions/:id')
  async renameSession(
    @Param('id') id: string,
    @Body() body: { title?: string },
    @Req() request: Request & { user: AuthenticatedRequestUser },
  ) {
    const title = body.title?.trim();
    if (!title) throw new BadRequestException('Title is required');
    if (title.length > 100) throw new BadRequestException('Title is too long');

    await this.chatSessionService.renameSession(id, title, request.user.id);
    return { sessionId: id, title };
  }

  @Get('history/:sessionId')
  async getHistory(
    @Param('sessionId') sessionId: string,
    @Req() request: Request & { user: AuthenticatedRequestUser },
  ) {
    await this.chatSessionService.assertSessionOwner(
      sessionId,
      request.user.id,
    );
    return this.chatSessionService.getHistory(sessionId);
  }

  @Get('sessions')
  async getSessions(
    @Req() request: Request & { user: AuthenticatedRequestUser },
  ) {
    return this.chatSessionService.getSessions(request.user.id);
  }

  @Delete('sessions/:id')
  async deleteSession(
    @Param('id') sessionId: string,
    @Req() request: Request & { user: AuthenticatedRequestUser },
  ) {
    await this.chatSessionService.assertSessionOwner(
      sessionId,
      request.user.id,
    );

    return this.chatSessionService.deleteSession(sessionId);
  }

  @Delete('sessions')
  async deleteAllSessions(
    @Req() request: Request & { user: AuthenticatedRequestUser },
  ) {
    return this.chatSessionService.deleteAllSessions(request.user.id);
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
      chunk.type === 'title' ||
      chunk.type === 'location_request' ||
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
