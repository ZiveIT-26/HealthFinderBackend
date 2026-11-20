import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { LlmConfig } from '../../config/llm.config.js';
import { createChatModel, readLlmSettings } from './llm-model.js';

const MAX_TITLE_LENGTH = 60;

@Injectable()
export class SessionTitleService {
  private readonly logger = new Logger(SessionTitleService.name);
  private readonly model: ChatOpenAI;
  private readonly prompt: string;

  constructor(config: ConfigService) {
    this.model = createChatModel(readLlmSettings(config));
    this.prompt = config.getOrThrow<LlmConfig>('llm').systemPrompts.sessionTitle;
  }

  async generate(firstPrompt: string): Promise<string> {
    try {
      const reply = await this.model.invoke([
        new SystemMessage(this.prompt),
        new HumanMessage(firstPrompt),
      ]);
      const title = cleanTitle(typeof reply.content === 'string' ? reply.content : '');
      if (title) return title;
    } catch (error) {
      this.logger.warn(
        `Title generation failed, using the first message instead: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return fallbackTitle(firstPrompt);
  }
}

// clean output of this service
export function cleanTitle(raw: string): string {
  const firstLine =
    raw
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? '';

  const title = firstLine
    .replace(/^(title|назва)\s*:\s*/i, '')
    .replace(/^["'«“„*]+|["'»”*]+$/g, '')
    .replace(/[.。]+$/, '')
    .trim();

  return truncate(title);
}

export function fallbackTitle(firstPrompt: string): string {
  return truncate(firstPrompt.replace(/\s+/g, ' ').trim());
}

function truncate(text: string): string {
  if (text.length <= MAX_TITLE_LENGTH) return text;
  const cut = text.slice(0, MAX_TITLE_LENGTH);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 20 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
