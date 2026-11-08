import { PageCache, type FetchedPage } from './page-cache.js';
import { cleanAddress } from './adapters/zoznam-lekarov.client.js';

describe('PageCache', () => {
  const TTL = 1000;
  let now = 0;
  const cache = () => new PageCache(TTL, () => now);

  beforeEach(() => {
    now = 0;
  });

  it('fetches once, then serves from cache while fresh', async () => {
    const pages = cache();
    const fetcher = vi.fn(async (): Promise<FetchedPage> => ({ status: 200, body: 'A', etag: '"1"' }));

    expect((await pages.get('u', fetcher)).outcome).toBe('new');
    now = 500;
    expect(await pages.get('u', fetcher)).toEqual({ body: 'A', outcome: 'fresh' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('after TTL sends the ETag and keeps the page on 304', async () => {
    const pages = cache();
    await pages.get('u', async () => ({ status: 200, body: 'A', etag: '"1"' }));

    now = 2000;
    const fetcher = vi.fn(async (): Promise<FetchedPage> => ({ status: 304, body: '' }));
    expect(await pages.get('u', fetcher)).toEqual({ body: 'A', outcome: 'not-modified' });
    expect(fetcher).toHaveBeenCalledWith({ 'If-None-Match': '"1"' });

    // TTL restarted: no request right after
    now = 2500;
    expect((await pages.get('u', fetcher)).outcome).toBe('fresh');
  });

  it('compares content hash when the server sends the page again', async () => {
    const pages = cache();
    await pages.get('u', async () => ({ status: 200, body: 'A' }));

    now = 2000;
    expect((await pages.get('u', async () => ({ status: 200, body: 'A' }))).outcome).toBe('unchanged');
    now = 4000;
    expect(await pages.get('u', async () => ({ status: 200, body: 'B' }))).toEqual({
      body: 'B',
      outcome: 'changed',
    });
  });

  it('serves the old copy when the site fails after TTL, and retries next time', async () => {
    const pages = cache();
    await pages.get('u', async () => ({ status: 200, body: 'A' }));

    now = 2000;
    const down = vi.fn(async (): Promise<FetchedPage> => {
      throw new Error('site down');
    });
    expect(await pages.get('u', down)).toEqual({ body: 'A', outcome: 'stale' });
    expect(await pages.get('u', down)).toEqual({ body: 'A', outcome: 'stale' });
    expect(down).toHaveBeenCalledTimes(2);
  });

  it('throws when the site fails and there is no old copy', async () => {
    await expect(
      cache().get('u', async () => {
        throw new Error('site down');
      }),
    ).rejects.toThrow('site down');
  });
});

describe('cleanAddress', () => {
  it('drops a "null" street', () => {
    expect(cleanAddress('null, Košice I, 040 15')).toBe('Košice I, 040 15');
  });

  it('keeps normal addresses', () => {
    expect(cleanAddress(' Werferova 3,  Košice I, 040 11 ')).toBe('Werferova 3, Košice I, 040 11');
  });
});
