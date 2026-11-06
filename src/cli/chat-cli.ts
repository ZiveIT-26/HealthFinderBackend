import { NestFactory } from '@nestjs/core';
import * as readline from 'node:readline';
import { AppModule } from '../app.module.js';
import { ChatSessionService } from '../services/llm/chat-session.service.js';

const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
const chat = app.get(ChatSessionService);

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.on('SIGINT', () => rl.close()); // Ctrl+C

let sessionId: string | undefined;

console.log('HealthFinder CLI. /new — нова розмова, /quit — вихід');
rl.setPrompt('> ');
rl.prompt();

for await (const raw of rl) {
  const line = raw.trim();
  if (!line) { rl.prompt(); continue; }
  if (line === '/quit') break;
  if (line === '/new') {
    sessionId = undefined;
    console.log('(нова розмова)');
    rl.prompt();
    continue;
  }

  const started = Date.now();
  const prep = await chat.prepareStream(line, sessionId);
  sessionId = prep.sessionId;

  for await (const chunk of chat.generateStream(prep.streamId)) {
    if (typeof chunk === 'string') {
      process.stdout.write(chunk);
    } else if ('doctors' in chunk) {
      for (const d of chunk.doctors) {
        console.log(`\n- ${d.name} | ${d.speciality} | ${d.address} | ${d.url}`);
      }
    } else if (chunk.type === 'error') {
      console.log(`\n[error] ${chunk.message}`);
    }
  }

  console.log(`\n(${((Date.now() - started) / 1000).toFixed(1)}s · session ${sessionId})`);
  rl.prompt();
}

await app.close();