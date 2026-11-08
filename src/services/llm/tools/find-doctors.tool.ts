import { Logger } from '@nestjs/common';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { DoctorListTexts, FindDoctorsTexts } from '../../../config/llm.config.js';
import { fillTemplate } from '../../../config/template.js';
import type { DoctorResponse } from '../doctor-response.js';
import type { DoctorListing, DoctorSource, Speciality, Town } from '../sources/index.js';

// all other tools that are in ./tools/ are NOT used
export const FIND_DOCTORS_TOOL = 'find_doctors';

// to not waste tokens
const MAX_DOCTORS_FOR_USER = 20;
const MAX_DOCTORS_FOR_MODEL = 8;
const DEFAULT_TOWN = 'Košice I';

const logger = new Logger('FindDoctors');

export type FindDoctorsArtifact = {
  doctors: DoctorResponse['doctors'];
  sourceUrls: string[];
};

// all sourses - one list
export function createFindDoctorsTool(
  sources: DoctorSource[],
  { findDoctors: texts, doctorList }: { findDoctors: FindDoctorsTexts; doctorList: DoctorListTexts },
) {
  return tool(
    async ({ speciality, town }): Promise<[string, FindDoctorsArtifact | undefined]> => {
      const search = await searchSources(sources, speciality, town?.trim() || DEFAULT_TOWN, texts);
      if (!search.found) return [search.message, undefined];

      const { hits, listings } = search;
      // Names are the same in all sources (see DoctorSource); take them from the first.
      const { chosenSpeciality, chosenTown } = hits[0];

      const doctors = listings.slice(0, MAX_DOCTORS_FOR_USER).map((doctor) => {
        const others = doctor.specialities.filter((s) => s !== chosenSpeciality.name);
        return {
          name: doctor.name,
          speciality: chosenSpeciality.name,
          address: doctor.address || doctorList.addressMissing,
          url: doctor.url,
          phone: null,
          email: null,
          additionalInfo:
            others.length > 0
              ? fillTemplate(doctorList.otherSpecialities, { specialities: others.slice(0, 5).join(', ') })
              : null,
        };
      });

      const lines = doctors
        .slice(0, MAX_DOCTORS_FOR_MODEL)
        .map((doctor, index) =>
          fillTemplate(texts.resultDoctor, { index: index + 1, name: doctor.name, address: doctor.address }),
        );

      const header = listings.length > doctors.length ? texts.resultHeaderPartial : texts.resultHeader;
      const content = [
        fillTemplate(header, {
          speciality: chosenSpeciality.name,
          town: chosenTown.name,
          count: listings.length,
          shown: doctors.length,
        }),
        ...hits.map((hit) => fillTemplate(texts.resultSource, { source: hit.source.name, url: hit.chosenTown.url })),
        ...lines,
        listings.length > lines.length
          ? fillTemplate(texts.resultMore, { count: listings.length - lines.length })
          : '',
        texts.resultFooter,
      ]
        .filter(Boolean)
        .join('\n');

      return [content, { doctors, sourceUrls: hits.map((hit) => hit.chosenTown.url) }];
    },
    {
      name: FIND_DOCTORS_TOOL,
      description: texts.description,
      schema: z.object({
        speciality: z
          .string()
          .min(1)
          .describe(texts.specialityField),
        town: z
          .string()
          .optional()
          .describe(texts.townField),
      }),
      responseFormat: 'content_and_artifact',
    },
  );
}

// one source
type SourceHit = {
  source: DoctorSource;
  chosenSpeciality: Speciality;
  chosenTown: Town;
  listings: DoctorListing[];
};

type SourceResult = ({ found: true } & SourceHit) | { found: false; message: string };

type SearchResult =
  | {
      found: true;
      hits: SourceHit[];
      listings: DoctorListing[];
    }
  | { found: false; message: string };


export async function searchSources(
  sources: DoctorSource[],
  speciality: string,
  town: string,
  texts: FindDoctorsTexts,
): Promise<SearchResult> {
  const settled = await Promise.allSettled(
    sources.map((source) => searchOneSource(source, speciality, town, texts)),
  );

  const hits: SourceHit[] = [];
  let firstFailure: string | undefined;
  let firstError: unknown;
  settled.forEach((result, index) => {
    if (result.status === 'rejected') {
      logger.warn(`${sources[index].name} failed: ${String(result.reason)}`);
      firstError ??= result.reason;
    }
    else if (result.value.found) {
      hits.push(result.value);
    }
    else {
      firstFailure ??= result.value.message;
    }
  });

  if (hits.length > 0) {
    return { found: true, hits, listings: withoutDuplicates(hits.flatMap((hit) => hit.listings)) };
  }
  // every source crashed
  if (firstFailure === undefined && firstError !== undefined) throw firstError;
  return { found: false, message: firstFailure ?? texts.noSources };
}

async function searchOneSource(
  source: DoctorSource,
  speciality: string,
  town: string,
  texts: FindDoctorsTexts,
): Promise<SourceResult> {
  const specialities = await source.getSpecialities();
  const chosenSpeciality = matchSpeciality(speciality, specialities);
  if (!chosenSpeciality) {
    const suggestions = suggestSpecialities(speciality, specialities);
    return {
      found: false,
      message: fillTemplate(texts.noSpeciality, { speciality, suggestions: suggestions.join(', ') }),
    };
  }

  const towns = await source.getTowns(chosenSpeciality);
  if (towns.length === 0) {
    return {
      found: false,
      message: fillTemplate(texts.noTownsForSpeciality, { speciality: chosenSpeciality.name }),
    };
  }

  const chosenTown = matchTown(town, towns);
  if (!chosenTown) {
    const available = towns.map((t) => `${t.name} (${t.count})`).join(', ');
    return {
      found: false,
      message: fillTemplate(texts.noTown, { town, speciality: chosenSpeciality.name, towns: available }),
    };
  }

  const listings = await source.getDoctors(chosenSpeciality, chosenTown);
  if (listings.length === 0) {
    return {
      found: false,
      message: fillTemplate(texts.noDoctors, { speciality: chosenSpeciality.name, town: chosenTown.name }),
    };
  }

  return { found: true, source, chosenSpeciality, chosenTown, listings };
}

// remove dupl doctors
export function withoutDuplicates(listings: DoctorListing[]): DoctorListing[] {
  const seen = new Set<string>();
  return listings.filter((doctor) => {
    const key = `${normalize(doctor.name)}|${normalize(doctor.address)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function findTowns(sources: DoctorSource[], specialityName: string): Promise<Town[]> {
  const perSource = await Promise.allSettled(
    sources.map(async (source) => {
      const speciality = matchSpeciality(specialityName, await source.getSpecialities());
      return speciality ? source.getTowns(speciality) : [];
    }),
  );

  const byName = new Map<string, Town>();
  for (const result of perSource) {
    if (result.status !== 'fulfilled') continue;
    for (const town of result.value) {
      const key = normalize(town.name);
      if (!byName.has(key)) byName.set(key, town);
    }
  }
  return [...byName.values()];
}

export async function findSpecialities(sources: DoctorSource[]): Promise<string[]> {
  const perSource = await Promise.allSettled(sources.map((source) => source.getSpecialities()));

  const byName = new Map<string, string>();
  perSource.forEach((result, index) => {
    if (result.status === 'rejected') {
      logger.warn(`${sources[index].name}: specialities failed: ${String(result.reason)}`);
      return;
    }
    for (const speciality of result.value) {
      const key = normalize(speciality.name);
      if (!byName.has(key)) byName.set(key, speciality.name);
    }
  });
  return [...byName.values()];
}

export function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function matchSpeciality(query: string, specialities: Speciality[]): Speciality | undefined {
  const q = normalize(query);
  if (!q) return undefined;

  return (
    specialities.find((s) => normalize(s.name) === q || s.id === q.replace(/ /g, '-')) ??
    specialities
      .filter((s) => normalize(s.name).startsWith(q))
      // prefer the shorter, more general name
      .sort((a, b) => a.name.length - b.name.length)[0]
  );
}

function suggestSpecialities(query: string, specialities: Speciality[]): string[] {
  const stem = normalize(query).slice(0, 4);
  const similar = specialities.filter((s) => stem && normalize(s.name).includes(stem));
  const pool = similar.length > 0 ? similar : specialities;
  return pool.slice(0, 15).map((s) => s.name);
}

export function matchTown(query: string, towns: Town[]): Town | undefined {
  const q = normalize(query);
  if (!q) return undefined;

  return (
    towns.find((town) => normalize(town.name) === q) ??
    towns
      .filter((town) => normalize(town.name).startsWith(q))
      .sort((a, b) => b.count - a.count)[0]
  );
}
