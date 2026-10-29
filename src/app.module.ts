import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { ChatController } from './controllers/chat/chat.controller.js';
import { ChatSessionService } from './services/llm/chat-session.service.js';
import { DbService } from './services/db/db.service.js';
import { AgentService } from './services/llm/agent.service.js';

@Module({
  imports: [ConfigModule.forRoot()],
  controllers: [AppController, ChatController],
  providers: [AppService, ChatSessionService, DbService, AgentService],
})
export class AppModule {}
