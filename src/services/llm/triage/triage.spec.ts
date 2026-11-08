import { findRedFlags } from './red-flags.js';
import { combineTriage } from './triage.js';

describe('findRedFlags', () => {
  it.each([
    ['Silno krvácam a točí sa mi hlava.', 'heavy_bleeding'],
    ['Bolí ma na hrudi a nemôžem dýchať', 'chest_pain'],
    ['Nemôžem dýchať', 'breathing'],
    ['I have chest pain', 'chest_pain'],
    ["I cut my hand and it is bleeding badly, it won't stop", 'heavy_bleeding'],
    ['My dad passed out', 'unconscious'],
    ['Otec odpadol a nereaguje', 'unconscious'],
    ['I want to kill myself', 'suicidal'],
    ['Nechcem žiť', 'suicidal'],
  ])('"%s" -> %s', (text, flag) => {
    expect(findRedFlags(text)).toContain(flag);
  });

  it.each([
    'Hľadám neurológa v Košiciach.',
    'Bolí ma hlava už tri dni.',
    'Potrebujem zubára',
    'Looking for a cardiologist in Košice',
    'ORL (ušný, nosný, krčný)',
    'I cut my finger, it bled a little but it stopped',
  ])('no red flag in "%s"', (text) => {
    expect(findRedFlags(text)).toEqual([]);
  });
});

describe('combineTriage', () => {
  it('red flag wins over a low model level', () => {
    const result = combineTriage('Silno krvácam', { hasSymptoms: true, level: 1, reasons: ['bleeding'] });
    expect(result.level).toBe(3);
    expect(result.modelLevel).toBe(1);
    expect(result.redFlags).toEqual(['heavy_bleeding']);
  });

  it('keeps the model level when there is no red flag', () => {
    expect(combineTriage('Mám horúčku tri dni', { hasSymptoms: true, level: 2, reasons: [] }).level).toBe(2);
  });

  it('falls back to rules when the model failed', () => {
    const result = combineTriage('Hľadám zubára', null);
    expect(result.level).toBe(0);
    expect(result.modelLevel).toBeNull();
    expect(result.reasons).toContain('model triage failed; rules only');
  });

  it('symptoms raise level 0 to at least 1', () => {
    const result = combineTriage('my hand itches a little', { hasSymptoms: true, level: 0, reasons: [] });
    expect(result.level).toBe(1);
    expect(result.modelLevel).toBe(0);
    expect(result.reasons).toContain('has symptoms: at least routine');
  });

  it('no symptoms keep level 0', () => {
    expect(combineTriage('thank you', { hasSymptoms: false, level: 0, reasons: [] }).level).toBe(0);
  });

  it('clamps strange model levels', () => {
    expect(combineTriage('hello', { hasSymptoms: false, level: 7, reasons: [] }).level).toBe(3);
  });
});
