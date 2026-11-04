import {
  Body,
  Controller,
  Param,
  Post,
  Sse,
  Get,
  BadRequestException,
} from '@nestjs/common';
import { from, map, Observable } from 'rxjs';
import { LlmService } from '../../services/llm/llm.service.js';
import { DbService } from '../../services/db/db.service.js';

@Controller('chat')
export class ChatController {
  constructor(
    private readonly llmService: LlmService,
    private readonly dbService: DbService,
  ) {}

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

  @Get('history/:sessionId')
  async getSessionHistory(@Param('sessionId') sessionId: string) {
    const history = await this.dbService.getSessionHistory(sessionId);
    return { sessionId, history };
  }

}
