import { loadLlmConfig } from '../../../../config/llm.config.js';
import { facilityName, KskGeoportalAdapter, townOf } from './ksk-geoportal.adapter.js';

const facility = (properties: Record<string, string | number | null>) => ({
  properties,
  geometry: { type: 'Point', coordinates: [21.2452, 48.7055] as [number, number] },
});

describe('townOf', () => {
  it('turns a Košice city part into its district', () => {
    expect(townOf(facility({ municipality: 'Košice - mestská časť Juh', county: 'Košice IV' }))).toBe('Košice IV');
  });

  it('keeps other municipalities', () => {
    expect(townOf(facility({ municipality: 'Michalovce', county: 'Michalovce' }))).toBe('Michalovce');
  });
});

describe('facilityName', () => {
  it('uses the doctor and the provider', () => {
    expect(
      facilityName({
        nazov_zariadenia: 'Neurologická ambulancia, MUDr. Vladimír Šafčák, Košice-Juh, (1. Neurologická, a.s.)',
        odborni_zastupcovia: 'MUDr. Vladimír Šafčák, MPH ako lekár',
      }),
    ).toBe('MUDr. Vladimír Šafčák, MPH (1. Neurologická, a.s.)');
  });

  it('drops any role ("ako zubný lekár")', () => {
    expect(
      facilityName({
        nazov_zariadenia: 'Ambulancia, (DUTY - DENT, spol. s r. o.)',
        odborni_zastupcovia: 'MUDr. MDDr. Beáta Bolerázska, PhD. ako zubný lekár',
      }),
    ).toBe('MUDr. MDDr. Beáta Bolerázska, PhD. (DUTY - DENT, spol. s r. o.)');
  });

  it('falls back to the facility name', () => {
    expect(facilityName({ nazov_zariadenia: 'Poliklinika X', odborni_zastupcovia: null })).toBe('Poliklinika X');
  });
});

describe('KskGeoportalAdapter', () => {
  // The WFS server answers with a count (XML) and then pages of GeoJSON.
  const features = [
    facility({
      druh_zariadenia: 'ambulancia všeobecnej ambulantnej zdravotnej starostlivosti',
      typ_zariadenia_complex_code: '0101Vvs_dospeli',
      nazov_zariadenia: 'Všeobecná ambulancia pre dospelých, MUDr. A, (A s.r.o.)',
      odborni_zastupcovia: 'MUDr. A ako lekár',
      addressline: 'Hlavná 1, 04001 Košice, Slovenská republika',
      municipality: 'Košice - mestská časť Staré Mesto',
      county: 'Košice I',
      pondelok: '7:00 - 15:00',
      vszp: 'áno',
      dovera: 'nie',
      union: 'áno',
    }),
    facility({
      druh_zariadenia: 'ambulancia všeobecnej ambulantnej zdravotnej starostlivosti',
      typ_zariadenia_complex_code: '0101Vvs_deti_a_dorast',
      nazov_zariadenia: 'Všeobecná ambulancia pre deti a dorast, MUDr. B, (B s.r.o.)',
      odborni_zastupcovia: 'MUDr. B ako lekár',
      addressline: 'Hlavná 2, 04001 Košice, Slovenská republika',
      municipality: 'Košice - mestská časť Staré Mesto',
      county: 'Košice I',
    }),
  ];

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.includes('resultType=hits')
          ? new Response(`<wfs:FeatureCollection numberMatched="${features.length}"/>`)
          : new Response(JSON.stringify({ features })),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('separates adults from children and adds hours and insurers', async () => {
    const adapter = new KskGeoportalAdapter(loadLlmConfig());
    const [adults] = (await adapter.getSpecialities()).filter((s) => s.name === 'Všeobecný lekár');

    const towns = await adapter.getTowns(adults);
    expect(towns.map((t) => [t.name, t.count])).toEqual([['Košice I', 1]]);

    const [doctor, ...rest] = await adapter.getDoctors(adults, towns[0]);
    expect(rest).toEqual([]);
    expect(doctor).toEqual({
      name: 'MUDr. A (A s.r.o.)',
      specialities: [],
      address: 'Hlavná 1, 04001 Košice',
      url: 'https://www.google.com/maps/search/?api=1&query=48.7055,21.2452',
      details: 'Ordinačné hodiny: Po 7:00 - 15:00 · Poisťovne: VšZP, Union',
    });
  });
});
