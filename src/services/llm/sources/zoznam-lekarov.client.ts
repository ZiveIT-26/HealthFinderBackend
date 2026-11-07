import * as cheerio from 'cheerio';
import { HttpService } from '@nestjs/axios';
import type { LlmConfig } from '../../../config/llm.config.js';
import { requestWhitelistedUrl } from '../tools/fetch-trusted-doctor-page.tool.js';

/**
 * Deterministic client for www.zoznam-lekarov.sk.
 *
 * The site has a fixed structure, so code walks it instead of the LLM:
 *   /                                         -> all specialities  (a.spec-card)
 *   /specializacia/{spec}/kosicky-kraj/       -> towns in the region (a.city-card)
 *   /specializacia/{spec}/kosicky-kraj/{town}/ -> doctors           (.doctor-card)
 *
 * Pages are cached in memory for a few hours (the site itself sends max-age=3600).
 */

export const ZOZNAM_LEKAROV_ORIGIN = 'https://www.zoznam-lekarov.sk';
const REGION_SLUG = 'kosicky-kraj';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export type Speciality = { name: string; slug: string; count: number };
export type Town = { name: string; path: string; count: number };
export type DoctorListing = {
  name: string;
  specialities: string[];
  address: string;
  url: string;
};

export class ZoznamLekarovClient {
  private readonly cache = new Map<string, { html: string; fetchedAt: number }>();

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
        specialities.push({ name, slug, count: parseCount(card.find('p').text()) });
      }
    });

    return specialities;
  }

  /** Towns in Košický kraj that have doctors of this speciality. */
  async getTowns(specialitySlug: string): Promise<Town[]> {
    const html = await this.getHtml(`/specializacia/${specialitySlug}/${REGION_SLUG}/`, {
      notFoundAsEmpty: true,
    });
    const $ = cheerio.load(html);
    const towns: Town[] = [];

    $('a.city-card').each((_, element) => {
      const card = $(element);
      const path = card.attr('href');
      const name = clean(card.find('h3').text());
      if (path && name) {
        towns.push({ name, path, count: parseCount(card.find('p').text()) });
      }
    });

    return towns;
  }

  async getDoctors(townPath: string): Promise<DoctorListing[]> {
    const $ = cheerio.load(await this.getHtml(townPath, { notFoundAsEmpty: true }));
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
        address: clean(card.find('.card-address').text()),
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
    const cached = this.cache.get(url);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      return cached.html;
    }

    const response = await requestWhitelistedUrl(this.httpService, url, this.llmConfig, {
      method: 'GET',
    });
    if (response.status === 404 && options.notFoundAsEmpty) {
      return '';
    }
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`${url} returned HTTP ${response.status}`);
    }

    const html = String(response.data ?? '');
    this.cache.set(url, { html, fetchedAt: Date.now() });
    return html;
  }
}

function clean(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function parseCount(value: string): number {
  return Number(value.replace(/\D/g, '')) || 0;
}
