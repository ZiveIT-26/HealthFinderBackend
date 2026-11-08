import { Logger } from '@nestjs/common';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { type BaseMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { LlmConfig } from '../../../config/llm.config.js';
import { conversationTranscript, messageText } from '../transcript.js';
import { combineTriage, type TriageModelResult, triageModelSchema, type TriageResult } from './triage.js';

const logger = new Logger('Triage');

export function createTriageStep(model: BaseChatModel, llmConfig: LlmConfig) {
  const triageModel = model.withStructuredOutput(triageModelSchema, {
    method: 'jsonSchema',
    strict: true,
  });

  return async function triage(messages: BaseMessage[]): Promise<TriageResult> {
    const latestMessage = messages.findLast(
      (message): message is HumanMessage => message instanceof HumanMessage,
    );
    if (!latestMessage) return combineTriage('', null);

    // The model sees the recent user messages (not the bot's replies), with the latest one marked
    // so "and my left arm is numb too" is judged together with "my chest hurts" from before
    let modelResult: TriageModelResult | null = null;
    try {
      modelResult = await triageModel.invoke([
        new SystemMessage(llmConfig.systemPrompts.triage),
        new HumanMessage(conversationTranscript(messages, llmConfig.transcript, { userOnly: true })),
      ]);
    } catch (error) {
      logger.warn(`model call failed, using red flags only: ${String(error)}`);
    }

    const result = combineTriage(messageText(latestMessage), modelResult);
    logger.log(`result: ${JSON.stringify(result)}`);
    return result;
  };
}
