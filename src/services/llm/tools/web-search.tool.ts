import { tool } from '@langchain/core/tools';
import { TavilySearch } from '@langchain/tavily';
import { z } from 'zod';

type SearchHit = { title: string; url: string; content: string };

export function createWebSearchTool(tavilyApiKey: string) {
  const webSearch = new TavilySearch({ maxResults: 5, tavilyApiKey });

  return tool(
    async ({ query }) => {
      const res = await webSearch.invoke({ query });

      if (typeof res === 'string') return res;

      const { results = [] } = res as { results?: SearchHit[] };
      if (!results.length)
        return `No results found '${query}'`;

      return results
        .map((r) => `${r.title}\n${r.url}\n${r.content}`)
        .join('\n\n');
    },
    {
      name: 'web_search',
      description:
        'Perform a web search',
      schema: z.object({
        query: z
          .string()
          .describe('Query to search'),
      }),
    },
  );
}
