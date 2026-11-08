import { NestFactory } from '@nestjs/core';
import * as readline from 'node:readline';
import { AppModule } from '../app.module.js';
import { ChatSessionService } from '../services/llm/chat-session.service.js';
import { type CliState, DEBUG_SECTIONS, runCommand } from './commands/index.js';
import { Renderer } from './render/renderer.js';


const out = new Renderer();
const state: CliState = { debug: new Set() };

const argv = process.argv.slice(2);
if (argv.includes('--debug')) DEBUG_SECTIONS.forEach((section) => state.debug.add(section));
const sessionArg = argv.indexOf('--session');
if (sessionArg !== -1 && argv[sessionArg + 1]) state.sessionId = argv[sessionArg + 1];

const app = await NestFactory.createApplicationContext(AppModule, {
  logger: ['error', 'warn'],
});
const chat = app.get(ChatSessionService);

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.on('SIGINT', () => rl.close()); // Ctrl+C

out.info('HealthFinder CLI · /help for commands · /quit to exit');
if (state.sessionId) out.info(`(continuing session ${state.sessionId})`);
if (state.debug.size > 0) out.info(`debug: ${[...state.debug].join(', ')}`);
rl.setPrompt('you> ');
rl.prompt();

for await (const raw of rl) {
  const line = raw.trim();
  if (line.startsWith('/')) {
    const result = await runCommand(line, { state, chat, out });
    if (result === 'quit') break;
  }
  else if (line) await sendMessage(line);

  rl.prompt();
}

await app.close();

async function sendMessage(text: string): Promise<void> {
  try {
    const prep = await chat.prepareStream(text, state.sessionId);
    state.sessionId = prep.sessionId;

    for await (const chunk of chat.generateStream(prep.streamId, { debug: true })) {
      if (typeof chunk === 'string') out.answerChunk(chunk);
      else if ('doctors' in chunk) out.doctors(chunk);
      else if (chunk.type === 'error') out.error(chunk.message);

      else if (chunk.type === 'debug') {
        switch (chunk.kind) {
          case 'triage':
            if (state.debug.has('triage')) out.triage(chunk);
            break;
          case 'plan':
            if (state.debug.has('triage')) out.plan(chunk);
            break;
          case 'tool':
            if (state.debug.has('tools')) out.tool(chunk);
            break;
          case 'model':
            if (state.debug.has('tokens')) out.model(chunk);
            break;
          case 'context':
            if (state.debug.has('context')) out.context(chunk);
            break;
          case 'summary':
            out.summary(chunk);
            break;
        }
      }
    }
  } catch (error) {
    out.error(describeError(error));
  }
}

function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const code = (error as { code?: string }).code;
  const inner = error instanceof AggregateError ? error.errors.map(describeError) : [];
  const text = error.message || inner[0] || code || error.name;
  return code === 'ECONNREFUSED' || /ECONNREFUSED/.test(text)
    ? `${text} — is the database running? (docker / port 65432)`
    : text;
}
