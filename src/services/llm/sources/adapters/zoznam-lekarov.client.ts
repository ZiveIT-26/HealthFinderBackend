import * as cheerio from 'cheerio';
import { Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import type { LlmConfig } from '../../../../config/llm.config.js';
import { requestWhitelistedUrl } from '../../tools/fetch-trusted-doctor-page.tool.js';
import type { DoctorListing, DoctorSource, Speciality, Town } from '../doctor-source.js';
import { PageCache } from '../page-cache.js';

export const ZOZNAM_LEKAROV_ORIGIN = 'https://www.zoznam-lekarov.sk';
const REGION_SLUG = 'kosicky-kraj';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * Adapter (DoctorSource) for www.zoznam-lekarov.sk:
 *   /                                          -> specialities (a.spec-card)
 *   /specializacia/{spec}/kosicky-kraj/        -> towns        (a.city-card)
 *   /specializacia/{spec}/kosicky-kraj/{town}/ -> doctors      (.doctor-card)
 */
export class ZoznamLekarovClient implements DoctorSource {
  readonly name = 'zoznam-lekarov.sk';
  private readonly cache = new PageCache(CACHE_TTL_MS);
  private readonly logger = new Logger('ZoznamLekarov');

  constructor(
    private readonly httpService: HttpService,
    private readonly llmConfig: LlmConfig,
  ) {}

  async getSpecialities(): Promise<Speciality[]> {
    const $ = cheerio.load(await this.getHtml('/'));
    const specialities: Speciality[] = [];

    $('a.spec-card').each((_, element) => {
      const card = $(element);
      const slug = card.attr('href')?.match(/^\/specializacia\/([^/]+)\/$/)?.[1];
      const name = clean(card.find('h3').text());
      if (slug && name) {
        specialities.push({ name, id: slug, count: parseCount(card.find('p').text()) });
      }
    });

    return specialities;
  }

  async getTowns(speciality: Speciality): Promise<Town[]> {
    const html = await this.getHtml(`/specializacia/${speciality.id}/${REGION_SLUG}/`, {
      notFoundAsEmpty: true,
    });
    const $ = cheerio.load(html);
    const towns: Town[] = [];

    $('a.city-card').each((_, element) => {
      const card = $(element);
      const path = card.attr('href');
      const name = clean(card.find('h3').text());
      if (path && name) {
        towns.push({
          name,
          id: path,
          url: new URL(path, ZOZNAM_LEKAROV_ORIGIN).toString(),
          count: parseCount(card.find('p').text()),
        });
      }
    });

    return towns;
  }

  async getDoctors(_speciality: Speciality, town: Town): Promise<DoctorListing[]> {
    const $ = cheerio.load(await this.getHtml(town.id, { notFoundAsEmpty: true }));
    const doctors: DoctorListing[] = [];

    $('.doctor-card').each((_, element) => {
      const card = $(element);
      const link = card.find('h3 a').first();
      const name = clean(link.text());
      const href = link.attr('href');
      if (!name || !href) return;

      doctors.push({
        name,
        specialities: card
          .find('.card-spec')
          .map((__, spec) => clean($(spec).text()))
          .get()
          .filter(Boolean),
        address: cleanAddress(card.find('.card-address').text()),
        url: new URL(href, ZOZNAM_LEKAROV_ORIGIN).toString(),
      });
    });

    return doctors;
  }

  private async getHtml(
    path: string,
    options: { notFoundAsEmpty?: boolean } = {},
  ): Promise<string> {
    const url = new URL(path, ZOZNAM_LEKAROV_ORIGIN).toString();

    const { body, outcome } = await this.cache.get(url, async (conditionalHeaders) => {
      const response = await requestWhitelistedUrl(this.httpService, url, this.llmConfig, {
        method: 'GET',
        headers: conditionalHeaders,
      });
      if (response.status === 304) {
        return { status: 304, body: '' };
      }
      if (response.status === 404 && options.notFoundAsEmpty) {
        return { status: 404, body: '' };
      }
      if (response.status < 200 || response.status >= 300) {
        throw new Error(`${url} returned HTTP ${response.status}`);
      }
      return {
        status: response.status,
        body: String(response.data ?? ''),
        etag: headerValue(response.headers.etag),
        lastModified: headerValue(response.headers['last-modified']),
      };
    });

    if (outcome === 'stale') {
      this.logger.warn(`site did not answer, using the old copy: ${url}`);
    } else if (outcome !== 'fresh') {
      this.logger.log(`page ${outcome}: ${url}`);
    }
    return body;
  }
}

function headerValue(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function clean(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

// the site sometimes prints a missing street as "null": "null, Košice I, 040 15"
export function cleanAddress(value: string): string {
  return clean(value)
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part && part.toLowerCase() !== 'null')
    .join(', ');
}

function parseCount(value: string): number {
  return Number(value.replace(/\D/g, '')) || 0;
}
