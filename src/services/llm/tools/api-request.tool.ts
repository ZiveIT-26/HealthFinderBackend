import { tool } from '@langchain/core/tools';
import { HttpService } from '@nestjs/axios';
import { AxiosResponse } from 'axios';
import { z } from 'zod';
import { firstValueFrom } from 'rxjs';
import type { LlmConfig } from '../../../config/llm.config.js';

const MAX_RESPONSE_BYTES = 100_000;
const MAX_REDIRECTS = 3;

const apiRequestSchema = z.object({
  url: z.url().describe('The HTTPS URL of the whitelisted API endpoint.'),
  method: z
    .enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
    .default('GET')
    .describe('The HTTP method to use.'),
  headers: z
    .record(z.string(), z.string())
    .optional()
    .describe('Optional request headers. Do not include credentials or secrets.'),
  body: z
    .string()
    .optional()
    .describe('Optional request body, usually JSON for POST, PUT, or PATCH.'),
});

export function createApiRequestTool(
  httpService: HttpService,
  llmConfig: LlmConfig,
) {
  return tool(
    async ({ url, method, headers, body }) => {
      const response = await requestWhitelistedUrl(httpService, url, llmConfig, {
        method,
        headers,
        body,
      });
      const responseBody = await readResponseBody(response);

      if (response.status < 200 || response.status >= 300) {
        throw new Error(
          `Whitelisted API request failed with HTTP ${response.status}: ${responseBody.slice(0, 500)}`,
        );
      }

      return `HTTP ${response.status} ${response.statusText}\n${responseBody}`;
    },
    {
      name: 'request_whitelisted_api',
      description:
        'Make an HTTPS API request only to the explicitly whitelisted domain.',
      schema: apiRequestSchema,
    },
  );
}

async function requestWhitelistedUrl(
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
        maxContentLength: MAX_RESPONSE_BYTES,
        maxBodyLength: MAX_RESPONSE_BYTES,
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

async function readResponseBody(
  response: AxiosResponse<string>,
): Promise<string> {
  return response.data;
}
