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
import { AuthController } from './controllers/auth/auth.controller.js';
import { AuthService } from './services/auth/auth.service.js';
import { AccessTokenAuthGuard } from './auth/access-token-auth.guard.js';
import { SessionTitleService } from './services/llm/session-title.service.js';
import { SharedMemoryController } from './controllers/memory/shared-memory.controller.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      load: [llmConfig],
    }),
    HttpModule,
  ],
  controllers: [
    AppController,
    ChatController,
    AuthController,
    SharedMemoryController,
  ],
  providers: [
    AppService,
    ChatSessionService,
    DbService,
    AgentService,
    AuthService,
    AccessTokenAuthGuard,
    SessionTitleService,
  ],
})
export class AppModule {}
