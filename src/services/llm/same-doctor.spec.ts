import { sameDoctor, withoutSameDoctors } from './same-doctor.js';

// Real pairs from a search for neurologists in Michalovce (register vs zoznam-lekarov.sk).
const register = (name: string, address: string) => ({ name, address });

describe('sameDoctor', () => {
  it.each([
    [
      register('Neurologická ambulancia, MUDr. Marek Makara, Michalovce, (MUDr. Marek Makara)', 'Nám. Osloboditeľov 945/15, 07101 Michalovce'),
      register('MUDr. Marek Makara', 'Námestie osloboditeľov 15, Michalovce, 071 01'),
    ],
    [
      register('Neurologická ambulancia, MUDr. Martina Kolesárová, Michalovce, (KORAMA, s. r. o.)', 'Štefánikova 1392/14, 07101 Michalovce'),
      register('KORAMA, s.r.o.', 'Štefánikova 1392/14, Michalovce, 071 01'),
    ],
    [
      register('Neurologická ambulancia, MUDr. Miroslava Raničová, Michalovce, (MUDr. Miroslava Raničová)', 'Ľudovíta Štúra 22/12, 07101 Michalovce'),
      register('MUDr. Miroslava Raničová', 'Ľ. Štúra 12, Michalovce, 071 01'),
    ],
    [
      register('Neurologická ambulancia, MUDr. Liana Puzderová, Michalovce, (Neurologická ambulancia č. I. s.r.o.)', 'Štefánikova 1414/76, 07101 Michalovce'),
      register('Neurologická ambulancia č. I., s.r.o.', 'Štefánikova 76, Michalovce, 071 01'),
    ],
  ])('%j is the same as %j', (a, b) => {
    expect(sameDoctor(a, b)).toBe(true);
  });

  it('different doctors at the same address are kept apart', () => {
    expect(
      sameDoctor(
        register('Neurologická ambulancia, MUDr. Peter Čuchran, Michalovce, (NEUROALTMANN s.r.o.)', 'Nám. osloboditeľov 985/73, 07101 Michalovce'),
        register('MADAJUK s. r. o.', 'Nám. osloboditeľov 985/73, Michalovce, 071 01'),
      ),
    ).toBe(false);
  });

  it('the same name in another street is another place', () => {
    expect(
      sameDoctor(register('Poliklinika ABC (ABC s.r.o.)', 'Hlavná 1, Košice'), register('ABC s.r.o.', 'Mlynská 5, Košice')),
    ).toBe(false);
  });
});

describe('withoutSameDoctors', () => {
  it('keeps the first one (the register)', () => {
    const fromRegister = register('Neurologická ambulancia, MUDr. Marek Makara, (MUDr. Marek Makara)', 'Nám. Osloboditeľov 945/15');
    const fromZoznam = register('MUDr. Marek Makara', 'Námestie osloboditeľov 15');
    expect(withoutSameDoctors([fromRegister, fromZoznam])).toEqual([fromRegister]);
  });
});
