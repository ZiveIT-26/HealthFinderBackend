/**
 * Extra events that `ChatSessionService.generateStream(id, { debug: true })` yields
 * besides the normal text chunks. Used by the CLI (`npm run chat`, /debug) and can
 * !!! later be sent to the frontend over SSE (e.g. `?debug=1`) !!!
 */

export type TokenUsage = {
  input: number;
  output: number;
  total: number;
};

export type DebugEvent =
  | {
      type: 'debug';
      kind: 'context';
      sessionId: string;
      messages: number;
      chars: number;
    }
  | {
      type: 'debug';
      kind: 'triage';
      level: number;
      levelName: string;
      modelLevel: number | null;
      hasSymptoms: boolean | null;
      redFlags: string[];
      reasons: string[];
    }
  | {
      type: 'debug';
      kind: 'model';
      node: string;
      tokens: TokenUsage;
      ms: number
    }
  | {
      type: 'debug';
      kind: 'tool';
      name: string;
      args: unknown;
      ms: number;
      resultChars?: number;
      error?: string;
    }
  | {
      type: 'debug';
      kind: 'summary';
      ms: number;
      tokens: TokenUsage;
      modelCalls: number;
      toolCalls: number;
    };
