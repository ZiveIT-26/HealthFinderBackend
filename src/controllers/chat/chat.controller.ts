import {
  Body,
  Controller,
  Param,
  Post,
  Sse,
  BadRequestException,
} from '@nestjs/common';
import { from, map, Observable } from 'rxjs';
import { LlmService } from '../../services/llm/llm.service.js';

@Controller('chat')
export class ChatController {
  constructor(private readonly llmService: LlmService) {}

  @Post()
  async sendMessage(@Body() body: { prompt: string; sessionId?: string }) {
    if (!body.prompt) {
      throw new BadRequestException('Message is required');
    }

    return this.llmService.prepareStream(body.prompt, body.sessionId);
  }

  @Sse('stream/:id')
  streamAIResponse(@Param('id') id: string): Observable<MessageEvent> {
    return from(this.llmService.generateStream(id)).pipe(
      map((chunk) => ({ data: { text: chunk } }) as MessageEvent),
    );
  }
}
