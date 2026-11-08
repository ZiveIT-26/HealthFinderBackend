import type { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';


export type LlmSettings = {
  apiKey: string;
  baseURL?: string;
  model: string;
  reasoningEffort?: string; // "none", "low", "medium", "high" - ollama only
};

export function readLlmSettings(config: ConfigService): LlmSettings {
  const openAiApiKey = config.get<string>('OPENAI_API_KEY')?.trim();
  if (openAiApiKey) {
    return { apiKey: openAiApiKey, model: 'gpt-4o' };
  }

  const baseURL = config.get<string>('LLM_BASE_URL')?.trim();
  const model = config.get<string>('LLM_MODEL')?.trim();
  if (!model || !baseURL) {
    throw new Error('LLM_MODEL and LLM_BASE_URL must be set when OPENAI_API_KEY is not configured');
  }

  const reasoningEffort = config.get<string>('LLM_REASONING_EFFORT')?.trim() || undefined;
  return { apiKey: 'ollama', baseURL, model, reasoningEffort };
}


// specialy made to try second model in triage step
export function readTriageLlmSettings(config: ConfigService): LlmSettings {
  const main = readLlmSettings(config);
  const triageModel = config.get<string>('LLM_TRIAGE_MODEL')?.trim();
  return triageModel ? { ...main, model: triageModel } : main;
}

export function createChatModel(llm: LlmSettings): ChatOpenAI {
  return new ChatOpenAI({
    model: llm.model,
    temperature: 0,
    apiKey: llm.apiKey,
    configuration: llm.baseURL ? { baseURL: llm.baseURL } : undefined,
    modelKwargs: llm.reasoningEffort ? { reasoning_effort: llm.reasoningEffort } : undefined,
  });
}
