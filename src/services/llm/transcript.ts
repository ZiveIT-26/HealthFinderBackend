import { AIMessage, type BaseMessage, HumanMessage } from '@langchain/core/messages';
import type { TranscriptLabels } from '../../config/llm.config.js';


export function messageText(message: BaseMessage): string {
  const { content } = message;
  if (typeof content === 'string') return content;
  return content
    .map((part) => (typeof part === 'string' ? part : 'text' in part ? String(part.text) : ''))
    .join('');
}

export type TranscriptOptions = {
  userOnly?: boolean; // what users sees
  limit?: number; // messages to include
};

// to point on the last user message sent (with previouse as context)
export function conversationTranscript(
  messages: BaseMessage[],
  labels: TranscriptLabels,
  { userOnly = false, limit = 6 }: TranscriptOptions = {},
): string {
  const lines = messages
    .filter(
      (message) =>
        message instanceof HumanMessage ||
        (!userOnly && message instanceof AIMessage && messageText(message).trim() !== ''),
    )
    .slice(-limit);

  const latestIndex = lines.findLastIndex((message) => message instanceof HumanMessage);
  if (latestIndex === -1) return '';

  const earlier = lines
    .slice(0, latestIndex)
    .map((message) => `${message instanceof HumanMessage ? labels.user : labels.assistant}: ${messageText(message)}`);

  return [
    ...(earlier.length > 0 ? [labels.earlier, ...earlier, ''] : []),
    labels.latest,
    messageText(lines[latestIndex]),
  ].join('\n');
}
