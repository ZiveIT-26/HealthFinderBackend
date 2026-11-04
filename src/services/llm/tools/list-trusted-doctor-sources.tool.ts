import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { DoctorSource } from '../../../config/llm.config.js';

export function createListTrustedDoctorSourcesTool(sources: DoctorSource[]) {
  return tool(
    async () =>
      sources
        .map((source) => `${source.domain} — ${source.description}`)
        .join('\n'),
    {
      name: 'list_trusted_doctor_sources',
      description:
        'List all configured trusted doctor-search sources. Returns only each website domain and a short description, never API details.',
      schema: z.object({}),
    },
  );
}
