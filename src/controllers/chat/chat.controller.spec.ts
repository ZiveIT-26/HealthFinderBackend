import { Test, TestingModule } from '@nestjs/testing';
import { ChatController } from './chat.controller.js';
import { ConfigService } from '@nestjs/config';
import { loadLlmConfig } from '../../config/llm.config.js';
import { ChatSessionService } from '../../services/llm/chat-session.service.js';

describe('ChatController', () => {
  let controller: ChatController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ChatController],
      // The real service needs a database and an LLM; a stub is enough here.
      providers: [
        { provide: ChatSessionService, useValue: {} },
        { provide: ConfigService, useValue: { getOrThrow: () => loadLlmConfig() } },
      ],
    }).compile();

    controller = module.get<ChatController>(ChatController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
