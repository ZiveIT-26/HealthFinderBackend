import { loadLlmConfig } from '../../../config/llm.config.js';
import type { DoctorSource } from '../sources/index.js';
import {
  findSpecialities,
  matchSpeciality,
  matchTown,
  normalize,
  searchSources,
  withoutDuplicates,
} from './find-doctors.tool.js';

const specialities = [
  { name: 'Zubár (stomatológ)', id: 'zubar-stomatolog', count: 2919 },
  { name: 'Všeobecný lekár', id: 'vseobecny-lekar', count: 2305 },
  { name: 'Neurológ', id: 'neurolog', count: 453 },
  { name: 'Detský neurológ', id: 'detsky-neurolog', count: 61 },
  { name: 'Kožný lekár (dermatológ)', id: 'kozny-lekar-dermatolog', count: 417 },
  { name: 'Kardiológ', id: 'kardiolog', count: 331 },
];

const towns = [
  { name: 'Gelnica', id: '/specializacia/neurolog/kosicky-kraj/gelnica/', url: 'https://www.zoznam-lekarov.sk/specializacia/neurolog/kosicky-kraj/gelnica/', count: 2 },
  { name: 'Košice I', id: '/specializacia/neurolog/kosicky-kraj/kosice-i/', url: 'https://www.zoznam-lekarov.sk/specializacia/neurolog/kosicky-kraj/kosice-i/', count: 31 },
  { name: 'Košice II', id: '/specializacia/neurolog/kosicky-kraj/kosice-ii/', url: 'https://www.zoznam-lekarov.sk/specializacia/neurolog/kosicky-kraj/kosice-ii/', count: 4 },
  { name: 'Michalovce', id: '/specializacia/neurolog/kosicky-kraj/michalovce/', url: 'https://www.zoznam-lekarov.sk/specializacia/neurolog/kosicky-kraj/michalovce/', count: 8 },
];

describe('normalize', () => {
  it('removes diacritics and case', () => {
    expect(normalize('Kožný lekár (dermatológ)')).toBe('kozny lekar dermatolog');
  });
});

describe('matchSpeciality', () => {
  it.each([
    ['Neurológ', 'Neurológ'],
    ['neurolog', 'Neurológ'],
    ['vseobecny-lekar', 'Všeobecný lekár'], // slug
    ['Zubár', 'Zubár (stomatológ)'],
    ['Kožný lekár', 'Kožný lekár (dermatológ)'],
    ['Detský neurológ', 'Detský neurológ'],
  ])('"%s" -> %s', (query, expected) => {
    expect(matchSpeciality(query, specialities)?.name).toBe(expected);
  });

  it.each(['xyz', 'neurologist'])('does not guess "%s"', (query) => {
    expect(matchSpeciality(query, specialities)).toBeUndefined();
  });
});

describe('matchTown', () => {
  it.each([
    ['Košice I', 'Košice I'],
    ['Košice', 'Košice I'], // several districts: the one with most doctors wins
    ['michalovce', 'Michalovce'],
  ])('"%s" -> %s', (query, expected) => {
    expect(matchTown(query, towns)?.name).toBe(expected);
  });

  // Grammatical cases are resolved by the model (enum in planSearch), not by guessing here.
  it.each(['Košiciach', 'Michalovciach'])('does not guess "%s"', (query) => {
    expect(matchTown(query, towns)).toBeUndefined();
  });

  it('returns undefined for a town outside the list', () => {
    expect(matchTown('Bratislava', towns)).toBeUndefined();
  });
});

describe('searchSources', () => {
  const texts = loadLlmConfig().findDoctors;

  // A fake website: no HTTP, just fixed data. Any adapter looks like this to find_doctors.
  function fakeSource(name: string, doctorsInTown: number): DoctorSource {
    return {
      name,
      getSpecialities: async () => specialities,
      getTowns: async () => towns,
      getDoctors: async () =>
        Array.from({ length: doctorsInTown }, (_, i) => ({
          name: `${name} doctor ${i + 1}`,
          specialities: ['Neurológ'],
          address: 'Košice I',
          url: `https://${name}/doctor-${i + 1}`,
        })),
    };
  }

  it('combines doctors from all sources', async () => {
    const result = await searchSources(
      [fakeSource('first', 2), fakeSource('empty', 0), fakeSource('second', 3)],
      'Neurológ',
      'Košice I',
      texts,
    );
    if (!result.found) throw new Error('expected doctors');
    expect(result.hits.map((hit) => hit.source.name)).toEqual(['first', 'second']);
    expect(result.listings.map((doctor) => doctor.name)).toEqual([
      'first doctor 1',
      'first doctor 2',
      'second doctor 1',
      'second doctor 2',
      'second doctor 3',
    ]);
  });

  it('skips a source that crashes', async () => {
    const broken: DoctorSource = {
      ...fakeSource('broken', 1),
      getSpecialities: () => Promise.reject(new Error('site down')),
    };
    const result = await searchSources([broken, fakeSource('second', 1)], 'Neurológ', 'Košice I', texts);
    expect(result.found && result.hits.map((hit) => hit.source.name)).toEqual(['second']);
  });

  it('reports the first failure when no source has doctors', async () => {
    const result = await searchSources([fakeSource('first', 0)], 'Neurológ', 'Bratislava', texts);
    expect(result).toEqual({ found: false, message: expect.stringContaining('No town matches "Bratislava"') });
  });
});

describe('withoutDuplicates', () => {
  it('keeps the first of two listings with the same name and address', () => {
    const doctor = { name: 'MUDr. Ján Kováč', specialities: [], address: 'Hlavná 1, Košice', url: 'https://a/1' };
    const sameOnOtherSite = { ...doctor, name: 'MUDR. JAN KOVAC', url: 'https://b/7' };
    const otherAddress = { ...doctor, address: 'Mlynská 2, Košice', url: 'https://a/2' };
    expect(withoutDuplicates([doctor, sameOnOtherSite, otherAddress])).toEqual([doctor, otherAddress]);
  });
});

describe('findSpecialities', () => {
  const source = (name: string, names: string[]): DoctorSource => ({
    name,
    getSpecialities: async () => names.map((n) => ({ name: n, id: n, count: 0 })),
    getTowns: async () => [],
    getDoctors: async () => [],
  });

  it('combines names from all sources, each once, and skips a failing source', async () => {
    const down: DoctorSource = { ...source('down', []), getSpecialities: () => Promise.reject(new Error('down')) };
    const names = await findSpecialities([
      down,
      source('first', ['Neurológ', 'Kardiológ']),
      source('second', ['neurolog', 'Ortopéd']),
    ]);
    expect(names).toEqual(['Neurológ', 'Kardiológ', 'Ortopéd']);
  });
});
