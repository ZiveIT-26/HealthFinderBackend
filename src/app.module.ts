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
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './controllers/auth/auth.controller.js';
import { AuthService } from './services/auth/auth.service.js';
import { JwtAuthGuard } from './auth/jwt-auth.guard.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      load: [llmConfig],
    }),
    HttpModule,
    JwtModule.register({}),
  ],
  controllers: [AppController, ChatController, AuthController],
  providers: [
    AppService,
    ChatSessionService,
    DbService,
    AgentService,
    AuthService,
    JwtAuthGuard,
  ],
})
export class AppModule {}
