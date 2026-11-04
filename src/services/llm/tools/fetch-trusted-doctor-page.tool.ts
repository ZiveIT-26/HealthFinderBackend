import { tool } from '@langchain/core/tools';
import { HttpService } from '@nestjs/axios';
import { z } from 'zod';
import type { LlmConfig } from '../../../config/llm.config.js';
import { AxiosResponse } from 'axios';
import { firstValueFrom } from 'rxjs';

const MAX_PAGE_CHARS = 100_000_000;
const MAX_REDIRECTS = 3;

export function createFetchTrustedDoctorPageTool(
  httpService: HttpService,
  llmConfig: LlmConfig,
) {
  return tool(
    async ({ url }) => {
      const response = await requestWhitelistedUrl(
        httpService,
        url,
        llmConfig,
        {
          method: 'GET',
        },
      );
      const html = await readResponseBody(response);

      if (response.status < 200 || response.status >= 300) {
        throw new Error(
          `Trusted doctor page request failed with HTTP ${response.status}: ${html.slice(0, 500)}`,
        );
      }

      const contentType = response.headers['content-type'];
      return `URL: ${url}\nContent-Type: ${String(contentType ?? 'unknown')}\n\n${html.slice(0, MAX_PAGE_CHARS)}`;
    },
    {
      name: 'fetch_trusted_doctor_page',
      description:
        'Fetch and inspect an HTML page from a configured trusted doctor website. Use this for plain websites without an API. Start with the trusted source domain, follow links found in the returned HTML, and never invent URLs.',
      schema: z.object({
        url: z
          .string()
          .min(1)
          .describe('A full HTTPS URL on a configured trusted doctor domain.'),
      }),
    },
  );
}

export async function requestWhitelistedUrl(
  httpService: HttpService,
  inputUrl: string,
  llmConfig: LlmConfig,
  init: {
    method: string;
    headers?: Record<string, string>;
    body?: string;
  },
): Promise<AxiosResponse<string>> {
  let url = validateUrl(inputUrl, llmConfig);

  for (
    let redirectCount = 0;
    redirectCount <= MAX_REDIRECTS;
    redirectCount += 1
  ) {
    const response = await firstValueFrom(
      httpService.request({
        url,
        method: init.method,
        headers: init.headers,
        data: init.body,
        timeout: 10_000,
        maxContentLength: MAX_PAGE_CHARS,
        maxBodyLength: MAX_PAGE_CHARS,
        maxRedirects: 0,
        responseType: 'text',
      }),
    );

    if (![301, 302, 303, 307, 308].includes(response.status)) {
      return response;
    }

    const location = response.headers.location;
    if (!location) {
      throw new Error('Whitelisted API returned a redirect without a location');
    }
    if (redirectCount === MAX_REDIRECTS) {
      throw new Error('Whitelisted API exceeded the redirect limit');
    }

    url = validateUrl(new URL(location, url).toString(), llmConfig);
  }

  throw new Error('Whitelisted API request could not be completed');
}

function validateUrl(inputUrl: string, llmConfig: LlmConfig): string {
  const url = new URL(inputUrl);

  if (url.protocol !== 'https:') {
    throw new Error('Only HTTPS API requests are allowed');
  }
  if (!llmConfig.allowedApiDomains.includes(url.hostname.toLowerCase())) {
    throw new Error(`API domain is not Whitelisted: ${url.hostname}`);
  }
  if (url.username || url.password) {
    throw new Error('Credentials in API URLs are not allowed');
  }

  return url.toString();
}

export async function readResponseBody(
  response: AxiosResponse<string>,
): Promise<string> {
  return response.data;
}