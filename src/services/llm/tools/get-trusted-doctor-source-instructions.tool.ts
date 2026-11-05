import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { DoctorSource } from '../../../config/llm.config.js';

export function createGetTrustedDoctorSourceInstructionsTool(
  sources: DoctorSource[],
) {
  return tool(
    async ({ domain }) => {
      const source = sources.find(
        (candidate) => candidate.domain.toLowerCase() === domain.toLowerCase(),
      );

      if (!source) {
        return `No trusted doctor-search source is configured for ${domain}.`;
      }

      return [
        `Trusted source: ${source.domain}`,
        `Description: ${source.description}`,
        `Search instructions: ${source.apiInstructions}`,
      ].join('\n');
    },
    {
      name: 'get_trusted_doctor_source_instructions',
      description:
        'Get detailed API search instructions for one trusted doctor-search source. This does not perform an API request.',
      schema: z.object({
        domain: z
          .string()
          .min(1)
          .describe('The exact trusted website domain to inspect.'),
      }),
    },
  );
}
