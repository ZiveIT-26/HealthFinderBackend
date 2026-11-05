import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerAs } from '@nestjs/config';
import { parse } from 'yaml';

export type LlmConfig = {
  allowedApiDomains: string[];
  trustedDoctorSources: DoctorSource[];
  systemPrompts: {
    assistant: string;
    emergencyCheck: string;
    emergencyResponse: string;
    responseFormatter: string;
    apiRequest: string;
  };
};

export type DoctorSource = {
  domain: string;
  description: string;
  apiInstructions: string;
};

export default registerAs(
  'llm',
  (): LlmConfig =>
    parse(
      readFileSync(
        join(fileURLToPath(new URL('.', import.meta.url)), 'llm.config.yaml'),
        'utf8',
      ),
    ) as LlmConfig,
);
