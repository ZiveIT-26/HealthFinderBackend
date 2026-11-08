import { AIMessage, HumanMessage } from '@langchain/core/messages';
import { loadLlmConfig } from '../../config/llm.config.js';
import { conversationTranscript } from './transcript.js';

const labels = loadLlmConfig().transcript;

describe('conversationTranscript', () => {
  const messages = [
    new HumanMessage('hi'),
    new AIMessage('Hello! How can I help?'),
    new HumanMessage('my hand itches'),
  ];

  it('marks the latest user message', () => {
    expect(conversationTranscript(messages, labels)).toBe(
      [
        'Earlier messages (context only):',
        'User: hi',
        'Assistant: Hello! How can I help?',
        '',
        'LATEST user message:',
        'my hand itches',
      ].join('\n'),
    );
  });

  it('can leave out the assistant', () => {
    expect(conversationTranscript(messages, labels, { userOnly: true })).not.toContain('Assistant');
  });

  it('has no "earlier" block for the first message', () => {
    expect(conversationTranscript([new HumanMessage('hi')], labels)).toBe('LATEST user message:\nhi');
  });
});
