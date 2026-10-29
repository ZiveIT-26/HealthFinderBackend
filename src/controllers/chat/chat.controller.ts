import {
  Body,
  Controller,
  Param,
  Post,
  Sse,
  BadRequestException,
} from '@nestjs/common';
import { from, map, Observable } from 'rxjs';
import { ChatSessionService } from '../../services/llm/chat-session.service.js';

@Controller('chat')
export class ChatController {
  constructor(private readonly chatSessionService: ChatSessionService) {}

  @Post()
  async sendMessage(@Body() body: { prompt: string; sessionId?: string }) {
    if (!body.prompt) {
      throw new BadRequestException('Message is required');
    }

    return this.chatSessionService.prepareStream(body.prompt, body.sessionId);
  }

  @Sse('stream/:id')
  streamAIResponse(@Param('id') id: string): Observable<MessageEvent> {
    return from(this.chatSessionService.generateStream(id)).pipe(
      map((chunk) => ({ data: { text: chunk } }) as MessageEvent),
    );
  }
}
