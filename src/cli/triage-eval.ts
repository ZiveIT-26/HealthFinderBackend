import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { HumanMessage } from '@langchain/core/messages';
import { parse } from 'yaml';
import { AppModule } from '../app.module.js';
import type { LlmConfig } from '../config/llm.config.js';
import { createChatModel, readTriageLlmSettings } from '../services/llm/llm-model.js';
import { createTriageStep } from '../services/llm/triage/triage-step.js';
import { TRIAGE_LEVEL_NAMES, type TriageLevel } from '../services/llm/triage/triage.js';

// runs the cases in test/triage-cases.yaml
/**
 * Runs the triage step (model + red flags) on the cases in test/triage-cases.yaml
 * and prints how many got the expected level.
 *
 *   npm run eval:triage                 all cases
 *   npm run eval:triage -- fainting     only cases whose message contains "fainting"
 *
 * Needs Ollama, not the database.
 */

type Case = {
  message: string;
  history?: string[];
  expected: TriageLevel | [TriageLevel, TriageLevel];
};

const CASES_FILE = join(process.cwd(), 'test', 'triage-cases.yaml');

const filter = process.argv[2]?.toLowerCase();
const cases = (parse(readFileSync(CASES_FILE, 'utf8')) as Case[]).filter(
  (c) => !filter || c.message.toLowerCase().includes(filter),
);

const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
const config = app.get(ConfigService);
const llmConfig = config.getOrThrow<LlmConfig>('llm');
const settings = readTriageLlmSettings(config); // LLM_TRIAGE_MODEL if set, otherwise LLM_MODEL
const triage = createTriageStep(createChatModel(settings), llmConfig);

console.log(`model: ${settings.model} · ${cases.length} cases from ${CASES_FILE}\n`);

let passed = 0;
let tooLow = 0; // dangerous: an emergency judged as less serious
let tooHigh = 0; // annoying: false alarms
const startedAt = Date.now();

for (const testCase of cases) {
  const [min, max] = Array.isArray(testCase.expected)
    ? testCase.expected
    : [testCase.expected, testCase.expected];
  const messages = [...(testCase.history ?? []), testCase.message].map((text) => new HumanMessage(text));

  const result = await triage(messages);
  const ok = result.level >= min && result.level <= max;
  if (ok) passed += 1;
  else if (result.level < min) tooLow += 1;
  else tooHigh += 1;

  const mark = ok ? 'ok  ' : result.level < min ? 'LOW ' : 'HIGH';
  const expected = min === max ? `${min}` : `${min}-${max}`;
  const details =
    `model=${result.modelLevel ?? 'failed'} symptoms=${result.hasSymptoms ?? '-'}` +
    (result.redFlags.length > 0 ? ` flags=${result.redFlags.join(',')}` : '');
  const context = testCase.history ? ` (after: ${testCase.history.join(' | ')})` : '';
  console.log(
    `${mark} got L${result.level} ${TRIAGE_LEVEL_NAMES[result.level].padEnd(9)} want ${expected.padEnd(3)} ` +
      `${details.padEnd(40)} ${testCase.message}${context}`,
  );
  if (!ok) console.log(`       reasons: ${result.reasons.join('; ')}`);
}

const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
console.log(
  `\n${passed}/${cases.length} correct · ${tooLow} too low (dangerous) · ${tooHigh} too high · ${seconds}s`,
);

await app.close();
process.exitCode = tooLow > 0 ? 1 : 0;
