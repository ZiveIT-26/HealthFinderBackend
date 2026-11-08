import { normalize } from './tools/find-doctors.tool.js';

/**
 * The KSK register and zoznam-lekarov.sk often list the same doctor, written
 * differently:
 *   register: "Neurologická ambulancia, MUDr. Marek Makara, Michalovce, (MUDr. Marek Makara)"
 *             "Nám. Osloboditeľov 945/15, 07101 Michalovce"
 *   zoznam:   "MUDr. Marek Makara"
 *             "Námestie osloboditeľov 15, Michalovce, 071 01"
 * Same doctor = one name contains the other (ignoring case, diacritics, spaces
 * and punctuation) AND the street is the same (its longest word).
 */
export function sameDoctor(a: { name: string; address: string }, b: { name: string; address: string }): boolean {
  const nameA = compact(a.name);
  const nameB = compact(b.name);
  if (!nameA || !nameB || !(nameA.includes(nameB) || nameB.includes(nameA))) return false;

  const streetA = streetWord(a.address);
  const streetB = streetWord(b.address);
  if (!streetA || !streetB) return true;
  return normalize(a.address).includes(streetB) || normalize(b.address).includes(streetA);
}

/** Keeps the first of each doctor (the list order decides which source wins). */
export function withoutSameDoctors<T extends { name: string; address: string }>(doctors: T[]): T[] {
  const kept: T[] = [];
  for (const doctor of doctors) {
    if (!kept.some((other) => sameDoctor(other, doctor))) kept.push(doctor);
  }
  return kept;
}

function compact(value: string): string {
  return normalize(value).replace(/ /g, '');
}

/** "Nám. Osloboditeľov 945/15, 07101 Michalovce" -> "osloboditelov" */
function streetWord(address: string): string | undefined {
  const street = normalize(address.split(',')[0] ?? '');
  return street
    .split(' ')
    .filter((word) => /^[a-z]{4,}$/.test(word))
    .sort((x, y) => y.length - x.length)[0];
}
