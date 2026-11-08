
// fixed phrases that always mean a level 3 emergency
export const RED_FLAGS: { id: string; patterns: string[] }[] = [
  {
    id: 'chest_pain',
    patterns: [
      'bolest (na |v )?hrudi', 'boli ma (na )?hrud', 'pichanie (na |v )?hrudi',
      'chest pain', 'pain in (my )?chest',
    ],
  },
  {
    id: 'breathing',
    patterns: [
      'nemozem dychat', 'tazko sa mi dycha', 'dusim sa',
      "can'?t breathe", 'cannot breathe', 'short(ness)? of breath', 'choking',
    ],
  },
  {
    id: 'heavy_bleeding',
    patterns: [
      'silno krvac', 'krvacanie .*(nejde|neda|nevie) zastavit', 'velka strata krvi',
      'bleeding heavily', 'heavy bleeding', "won'?t stop bleeding",
      'bleeding (badly|a lot|so much)', "bleeding.*(won'?t|doesn'?t|does not|will not|can'?t|cannot) stop",
    ],
  },
  {
    id: 'unconscious',
    patterns: [
      'bezvedom', 'odpadol', 'odpadla', 'stratil vedomie', 'stratila vedomie',
      'unconscious', 'passed out', 'not breathing',
    ],
  },
  {
    id: 'stroke',
    patterns: [
      'ochrnut', 'pokleseny kutik', 'nemoze hovorit', 'zle rozprava', 'mozgova prihoda',
      'face droop', 'slurred speech', 'numb(ness)? on one side', 'stroke',
    ],
  },
  {
    id: 'suicidal',
    patterns: [
      'samovrazd', 'zabit sa', 'nechcem zit',
      'suicid', 'kill myself', 'end my life',
    ],
  },
  {
    id: 'seizure',
    patterns: ['krce', 'epilepticky zachvat', 'seizure', 'convulsion'],
  },
  {
    id: 'anaphylaxis',
    patterns: [
      'opuch(nuty)? jazyk', 'opuch hrdla', 'opuchnute hrdlo',
      'throat (is )?swelling', 'swollen throat', 'anaphyla',
    ],
  },
];

export function normalizeForRedFlags(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

const COMPILED = RED_FLAGS.map((flag) => ({
  id: flag.id,
  regexes: flag.patterns.map((pattern) => new RegExp(normalizeForRedFlags(pattern), 'u')),
}));

export function findRedFlags(text: string): string[] {
  const normalized = normalizeForRedFlags(text);
  return COMPILED.filter((flag) => flag.regexes.some((regex) => regex.test(normalized))).map(
    (flag) => flag.id,
  );
}
