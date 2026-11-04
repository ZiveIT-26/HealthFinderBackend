import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import llmConfig from './config/llm.config.js';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { ChatController } from './controllers/chat/chat.controller.js';
import { ChatSessionService } from './services/llm/chat-session.service.js';
import { DbService } from './services/db/db.service.js';
import { AgentService } from './services/llm/agent.service.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      load: [llmConfig],
    }),
    HttpModule,
  ],
  controllers: [AppController, ChatController],
  providers: [AppService, ChatSessionService, DbService, AgentService],
})
export class AppModule {}
