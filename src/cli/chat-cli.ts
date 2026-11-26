import { NestFactory } from '@nestjs/core';
import * as readline from 'node:readline';
import { AppModule } from '../app.module.js';
import { ChatSessionService } from '../services/llm/chat-session.service.js';
import { DbService } from '../services/db/db.service.js';
import { type CliState, DEBUG_SECTIONS, UUID, runCommand } from './commands/index.js';
import { Renderer } from './render/renderer.js';


// use --user <uuid> or /user to act as someone else.
const DEFAULT_CLI_USER_ID = '00000000-0000-0000-0000-000000000001';

const out = new Renderer();
const state: CliState = { userId: DEFAULT_CLI_USER_ID, debug: new Set() };

const argv = process.argv.slice(2);
if (argv.includes('--debug')) DEBUG_SECTIONS.forEach((section) => state.debug.add(section));
const sessionArg = argv.indexOf('--session');
if (sessionArg !== -1 && argv[sessionArg + 1]) state.sessionId = argv[sessionArg + 1];
const userArg = argv.indexOf('--user');
if (userArg !== -1 && argv[userArg + 1]) {
  const userId = argv[userArg + 1];
  if (!UUID.test(userId)) {
    out.error(`--user must be a UUID, got "${userId}"`);
    process.exit(1);
  }
  state.userId = userId;
}

const app = await NestFactory.createApplicationContext(AppModule, {
  logger: ['error', 'warn'],
});
const chat = app.get(ChatSessionService);
const db = app.get(DbService);

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.on('SIGINT', () => rl.close()); // Ctrl+C

out.info('HealthFinder CLI · /help for commands · /quit to exit');
out.info(`user: ${state.userId}${state.userId === DEFAULT_CLI_USER_ID ? ' (default dev user)' : ''}`);
if (state.sessionId) out.info(`(continuing session ${state.sessionId})`);
if (state.debug.size > 0) out.info(`debug: ${[...state.debug].join(', ')}`);
rl.setPrompt('you> ');
rl.prompt();

for await (const raw of rl) {
  const line = raw.trim();
  if (line.startsWith('/')) {
    const result = await runCommand(line, { state, chat, db, out });
    if (result === 'quit') break;
  }
  else if (line) await sendMessage(line);

  rl.prompt();
}

await app.close();

async function sendMessage(text: string): Promise<void> {
  try {
    const prep = await chat.prepareStream(text, state.sessionId, state.userId);
    state.sessionId = prep.sessionId;

    for await (const chunk of chat.generateStream(prep.streamId, state.userId, { debug: true })) {
      if (typeof chunk === 'string') out.answerChunk(chunk);
      else if ('doctors' in chunk) out.doctors(chunk);
      else if (chunk.type === 'error') out.error(chunk.message);
      else if (chunk.type === 'title') out.info(`[title] ${chunk.title}`);

      else if (chunk.type === 'debug') {
        switch (chunk.kind) {
          case 'triage':
            if (state.debug.has('triage')) out.triage(chunk);
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
