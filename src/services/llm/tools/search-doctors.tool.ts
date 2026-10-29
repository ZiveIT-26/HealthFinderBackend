import { tool } from '@langchain/core/tools';
import { TavilySearch } from '@langchain/tavily';
import { z } from 'zod';

type SearchHit = { title: string; url: string; content: string };

export function createSearchDoctorsTool(tavilyApiKey: string) {
  const webSearch = new TavilySearch({ maxResults: 5, tavilyApiKey });

  return tool(
    async ({ specialty }) => {
      const res = await webSearch.invoke({
        query: `${specialty} doctor Košice region Slovakia address phone`,
      });

      if (typeof res === 'string') return res;

      const { results = [] } = res as { results?: SearchHit[] };
      if (!results.length)
        return `No results found for ${specialty} in Košice region.`;

      return results
        .map((r) => `${r.title}\n${r.url}\n${r.content}`)
        .join('\n\n');
    },
    {
      name: 'search_doctors',
      description:
        'Search the web for doctors in the Košice region by specialty.',
      schema: z.object({
        specialty: z
          .string()
          .describe('The medical specialty (e.g., cardiologist)'),
      }),
    },
  );
}
