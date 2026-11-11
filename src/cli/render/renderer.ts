import { styleText } from 'node:util';
import type { DebugEvent } from '../../services/llm/debug-events.js';
import type { DoctorResponse } from '../../services/llm/doctor-response.js';


type Color = Parameters<typeof styleText>[0];
const useColor = process.stdout.isTTY === true && !process.env.NO_COLOR;

function paint(color: Color, text: string): string {
  return useColor ? styleText(color, text) : text;
}

const TRIAGE_COLORS: Color[] = ['green', 'blue', 'yellow', 'red'];

export class Renderer {
  private midLine = false;

  info(text: string): void {
    this.line(paint('gray', text));
  }

  error(text: string): void {
    this.line(paint(['red', 'bold'], `[error] ${text}`));
  }

  answerChunk(text: string): void {
    if (!this.midLine) process.stdout.write(paint('cyan', 'ai> '));
    process.stdout.write(text);
    this.midLine = !text.endsWith('\n');
  }

  doctors(response: DoctorResponse): void {
    if (response.doctors.length === 0) return;
    this.line(paint('magenta', `[doctors] ${response.doctors.length}`));
    for (const doctor of response.doctors) {
      this.line(`  - ${doctor.name} | ${doctor.address} | ${paint('gray', doctor.url)}`);
    }
  }

  triage(event: Extract<DebugEvent, { kind: 'triage' }>): void {
    const color = TRIAGE_COLORS[event.level] ?? 'white';
    const flags = event.redFlags.length > 0 ? event.redFlags.join(', ') : '-';
    this.line(
      paint(color, `[triage L${event.level} ${event.levelName}]`) +
        paint(
          'gray',
          ` model=${event.modelLevel ?? 'failed'} symptoms=${event.hasSymptoms ?? '-'} redFlags=${flags}`,
        ),
    );
    for (const reason of event.reasons) {
      this.line(paint('gray', `    · ${reason}`));
    }
  }

  tool(event: Extract<DebugEvent, { kind: 'tool' }>): void {
    const result = event.error
      ? paint('red', `error: ${event.error}`)
      : `${event.resultChars ?? 0} chars`;
    this.line(
      paint('magenta', `[tool] ${event.name}`) +
        ` ${JSON.stringify(event.args)} → ${result} ${paint('gray', seconds(event.ms))}`,
    );
  }

  model(event: Extract<DebugEvent, { kind: 'model' }>): void {
    this.line(
      paint('gray', `[model ${event.node}] in=${event.tokens.input} out=${event.tokens.output} · ${seconds(event.ms)}`),
    );
  }

  context(event: Extract<DebugEvent, { kind: 'context' }>): void {
    this.line(
      paint('gray', `[context] session ${event.sessionId} · ${event.messages} messages · ${event.chars} chars`),
    );
  }

  summary(event: Extract<DebugEvent, { kind: 'summary' }>): void {
    this.line(
      paint(
        'gray',
        `⏱ ${seconds(event.ms)} · tokens in=${event.tokens.input} out=${event.tokens.output}` +
          ` · ${event.modelCalls} model calls · ${event.toolCalls} tool calls`,
      ),
    );
  }

  history(rows: { role: string; content: string }[]): void {
    if (rows.length === 0) {
      this.info('(no saved messages)');
      return;
    }
    for (const row of rows) {
      const prefix = row.role === 'user' ? paint('blue', 'you>') : paint('cyan', 'ai> ');
      this.line(`${prefix} ${row.content}`);
    }
  }

  line(text: string): void {
    if (this.midLine) {
      process.stdout.write('\n');
      this.midLine = false;
    }
    process.stdout.write(`${text}\n`);
  }
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}
