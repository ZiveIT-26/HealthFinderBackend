import { createHash } from 'node:crypto';

/**
 * In-memory page cache with a TTL and change detection.
 *
 *  - younger than TTL                -> served from cache, no request   ("fresh")
 *  - older than TTL                  -> conditional request with ETag / Last-Modified:
 *      server answers 304            -> keep cached page, restart TTL  ("not-modified")
 *      server sends the page again   -> compare content hash:
 *          same hash                 -> keep, restart TTL               ("unchanged")
 *          different hash            -> replace                         ("changed")
 *  - never seen before               -> fetch and store                 ("new")
 *
 * It is shared by all users of this backend process (the pages are public data).
 */

export type CacheOutcome = 'fresh' | 'not-modified' | 'unchanged' | 'changed' | 'new';

export type FetchedPage = {
  status: number;
  body: string;
  etag?: string;
  lastModified?: string;
};

export type PageFetcher = (conditionalHeaders: Record<string, string>) => Promise<FetchedPage>;

type Entry = {
  body: string;
  hash: string;
  etag?: string;
  lastModified?: string;
  fetchedAt: number;
};

export class PageCache {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  async get(url: string, fetcher: PageFetcher): Promise<{ body: string; outcome: CacheOutcome }> {
    const cached = this.entries.get(url);
    if (cached && this.now() - cached.fetchedAt < this.ttlMs) {
      return { body: cached.body, outcome: 'fresh' };
    }

    const conditionalHeaders: Record<string, string> = {};
    if (cached?.etag) conditionalHeaders['If-None-Match'] = cached.etag;
    if (cached?.lastModified) conditionalHeaders['If-Modified-Since'] = cached.lastModified;

    const page = await fetcher(conditionalHeaders);

    if (page.status === 304 && cached) {
      cached.fetchedAt = this.now();
      return { body: cached.body, outcome: 'not-modified' };
    }

    const hash = sha256(page.body);
    const outcome: CacheOutcome = !cached ? 'new' : cached.hash === hash ? 'unchanged' : 'changed';

    this.entries.set(url, {
      body: page.body,
      hash,
      etag: page.etag,
      lastModified: page.lastModified,
      fetchedAt: this.now(),
    });
    return { body: page.body, outcome };
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
