import { matchSpeciality, matchTown, normalize } from './find-doctors.tool.js';

const specialities = [
  { name: 'Zubár (stomatológ)', slug: 'zubar-stomatolog', count: 2919 },
  { name: 'Všeobecný lekár', slug: 'vseobecny-lekar', count: 2305 },
  { name: 'Neurológ', slug: 'neurolog', count: 453 },
  { name: 'Detský neurológ', slug: 'detsky-neurolog', count: 61 },
  { name: 'Kožný lekár (dermatológ)', slug: 'kozny-lekar-dermatolog', count: 417 },
  { name: 'Kardiológ', slug: 'kardiolog', count: 331 },
];

const towns = [
  { name: 'Gelnica', path: '/specializacia/neurolog/kosicky-kraj/gelnica/', count: 2 },
  { name: 'Košice I', path: '/specializacia/neurolog/kosicky-kraj/kosice-i/', count: 31 },
  { name: 'Košice II', path: '/specializacia/neurolog/kosicky-kraj/kosice-ii/', count: 4 },
  { name: 'Michalovce', path: '/specializacia/neurolog/kosicky-kraj/michalovce/', count: 8 },
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
    ['neurologist', 'Neurológ'],
    ['Zubár', 'Zubár (stomatológ)'],
    ['Kožný lekár', 'Kožný lekár (dermatológ)'],
    ['Detský neurológ', 'Detský neurológ'],
  ])('"%s" -> %s', (query, expected) => {
    expect(matchSpeciality(query, specialities)?.name).toBe(expected);
  });

  it('returns undefined for nonsense', () => {
    expect(matchSpeciality('xyz', specialities)).toBeUndefined();
  });
});

describe('matchTown', () => {
  it.each([
    ['Košice I', 'Košice I'],
    ['Košice', 'Košice I'], // several districts: the one with most doctors wins
    ['Košiciach', 'Košice I'], // Slovak locative case
    ['Michalovciach', 'Michalovce'],
    ['michalovce', 'Michalovce'],
  ])('"%s" -> %s', (query, expected) => {
    expect(matchTown(query, towns)?.name).toBe(expected);
  });

  it('returns undefined for a town outside the list', () => {
    expect(matchTown('Bratislava', towns)).toBeUndefined();
  });
});
