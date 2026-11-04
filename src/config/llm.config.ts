import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { registerAs } from '@nestjs/config';
import { parse } from 'yaml';

export type LlmConfig = {
  allowedApiDomains: string[];
  systemPrompts: {
    assistant: string;
    emergencyCheck: string;
    emergencyResponse: string;
    apiRequest: string;
  };
};

export default registerAs(
  'llm',
  (): LlmConfig =>
    parse(
      readFileSync(join(__dirname, 'llm.config.yaml'), 'utf8'),
    ) as LlmConfig,
);
