import { cleanTitle, fallbackTitle } from './session-title.service.js';

describe('cleanTitle', () => {
  it('strips quotes, a label and a trailing period', () => {
    expect(cleanTitle('Title: "Bolesť hlavy a závraty."')).toBe('Bolesť hlavy a závraty');
  });

  it('returns empty text for an empty reply', () => {
    expect(cleanTitle('  \n ')).toBe('');
  });
});

describe('fallbackTitle', () => {
  it('shortens a long first message at a word boundary', () => {
    const title = fallbackTitle('I have had a strong headache for three days and I need a neurologist in Košice please');
    expect(title.length).toBeLessThanOrEqual(61);
    expect(title.endsWith('…')).toBe(true);
  });
});
