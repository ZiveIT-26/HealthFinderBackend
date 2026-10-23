import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { ChatController } from './controllers/chat/chat.controller.js';
import { LlmService } from './services/llm/llm.service.js';
import { DbService } from './services/db/db.service.js';

@Module({
  imports: [ConfigModule.forRoot()],
  controllers: [AppController, ChatController],
  providers: [AppService, LlmService, DbService],
})
export class AppModule {}
