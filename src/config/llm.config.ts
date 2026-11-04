import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { registerAs } from '@nestjs/config';
import { parse } from 'yaml';

export type LlmConfig = {
  allowedApiDomains: string[];
  trustedDoctorSources: DoctorSource[];
  systemPrompts: {
    assistant: string;
    emergencyCheck: string;
    emergencyResponse: string;
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
      readFileSync(join(__dirname, 'llm.config.yaml'), 'utf8'),
    ) as LlmConfig,
);
