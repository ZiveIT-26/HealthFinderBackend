import { tool } from '@langchain/core/tools';
import { HttpService } from '@nestjs/axios';
import { z } from 'zod';
import type { LlmConfig } from '../../../config/llm.config.js';
import { AxiosResponse } from 'axios';
import { firstValueFrom } from 'rxjs';
import { cleanHtmlPage } from '../page-cleaner.js';

/** Max size of a downloaded page (raw HTML), not of what the model sees. */
const MAX_DOWNLOAD_BYTES = 5_000_000;
const MAX_REDIRECTS = 3;

export function createFetchTrustedDoctorPageTool(
  httpService: HttpService,
  llmConfig: LlmConfig,
) {
  return tool(
    async ({ url: requestedUrl }) => {
      const url = resolveTrustedUrl(requestedUrl, llmConfig);
      const response = await requestWhitelistedUrl(httpService, url, llmConfig, {
        method: 'GET',
      });
      const body = String(response.data ?? '');

      if (response.status < 200 || response.status >= 300) {
        throw new Error(
          `Trusted doctor page request failed with HTTP ${response.status}`,
        );
      }

      const contentType = String(response.headers['content-type'] ?? '');
      if (!contentType.includes('html')) {
        return `URL: ${url}\nContent-Type: ${contentType}\n\n${body.slice(0, 4_000)}`;
      }

      const page = cleanHtmlPage(body, url);
      return [
        `URL: ${url}`,
        `TITLE: ${page.title}`,
        '',
        page.text,
      ].join('\n');
    },
    {
      name: 'fetch_trusted_doctor_page',
      description:
        'Fetch a page from a configured trusted doctor website and return its readable text. Links are shown as [text](/path). Pass such a /path (or a full https URL) to fetch the next page. Follow only links that appear in fetched pages; never invent them.',
      schema: z.object({
        url: z
          .string()
          .min(1)
          .describe('A /path from a fetched page, or a full HTTPS URL on a trusted doctor domain.'),
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
      httpService.request<string>({
        url,
        method: init.method,
        headers: init.headers,
        data: init.body,
        timeout: 10_000,
        maxContentLength: MAX_DOWNLOAD_BYTES,
        maxBodyLength: MAX_DOWNLOAD_BYTES,
        maxRedirects: 0,
        responseType: 'text',
        // Without this, axios throws on every non-2xx status, so redirects
        // (3xx) and HTTP errors would never reach the handling below.
        validateStatus: () => true,
      }),
    );

    if (![301, 302, 303, 307, 308].includes(response.status)) {
      return response;
    }

    const location = response.headers.location;
    if (!location) {
      throw new Error('Trusted site returned a redirect without a location');
    }
    if (redirectCount === MAX_REDIRECTS) {
      throw new Error('Trusted site exceeded the redirect limit');
    }

    // Every redirect target is checked against the whitelist again.
    url = validateUrl(new URL(String(location), url).toString(), llmConfig);
  }

  throw new Error('Trusted site request could not be completed');
}

/**
 * Turns "/path" (as shown in cleaned pages) into a full URL on the trusted site.
 * Only possible while exactly one domain is whitelisted; full URLs pass through.
 */
export function resolveTrustedUrl(input: string, llmConfig: LlmConfig): string {
  const value = input.trim();
  if (!value.startsWith('/')) return value;

  const domains = llmConfig.allowedApiDomains;
  if (domains.length !== 1) {
    throw new Error('Use a full https URL: more than one trusted domain is configured');
  }
  return new URL(value, `https://${domains[0]}`).toString();
}

function validateUrl(inputUrl: string, llmConfig: LlmConfig): string {
  const url = new URL(inputUrl);

  if (url.protocol !== 'https:') {
    throw new Error('Only HTTPS requests are allowed');
  }
  if (!llmConfig.allowedApiDomains.includes(url.hostname.toLowerCase())) {
    throw new Error(`Domain is not whitelisted: ${url.hostname}`);
  }
  if (url.username || url.password) {
    throw new Error('Credentials in URLs are not allowed');
  }

  return url.toString();
}
