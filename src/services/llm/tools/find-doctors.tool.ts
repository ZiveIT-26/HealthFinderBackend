import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { DoctorResponse } from '../doctor-response.js';
import {
  type Speciality,
  type Town,
  ZOZNAM_LEKAROV_ORIGIN,
  ZoznamLekarovClient,
} from '../sources/zoznam-lekarov.client.js';

export const FIND_DOCTORS_TOOL = 'find_doctors';

/** How many doctors go to the user (artifact) and to the model (text). */
const MAX_DOCTORS_FOR_USER = 20;
const MAX_DOCTORS_FOR_MODEL = 8;
const DEFAULT_TOWN = 'Košice I';

export type FindDoctorsArtifact = {
  doctors: DoctorResponse['doctors'];
  sourceUrl: string;
};

/**
 * One tool call instead of the LLM walking the website page by page.
 * The model only chooses the speciality and the town; code does the rest.
 * The doctor list is returned as an artifact, so `finalize` can use it
 * directly and the model cannot invent or alter doctors.
 */
export function createFindDoctorsTool(client: ZoznamLekarovClient) {
  return tool(
    async ({ speciality, town }): Promise<[string, FindDoctorsArtifact | undefined]> => {
      const specialities = await client.getSpecialities();
      const chosenSpeciality = matchSpeciality(speciality, specialities);
      if (!chosenSpeciality) {
        const suggestions = suggestSpecialities(speciality, specialities);
        return [
          `No speciality matches "${speciality}". Call ${FIND_DOCTORS_TOOL} again with one of these exact names: ${suggestions.join(', ')}.`,
          undefined,
        ];
      }

      const towns = await client.getTowns(chosenSpeciality.slug);
      if (towns.length === 0) {
        return [
          `There are no doctors of speciality "${chosenSpeciality.name}" in Košický kraj.`,
          undefined,
        ];
      }

      const chosenTown = matchTown(town?.trim() || DEFAULT_TOWN, towns);
      if (!chosenTown) {
        const available = towns.map((t) => `${t.name} (${t.count})`).join(', ');
        return [
          `No town matches "${town}". Towns with ${chosenSpeciality.name} in Košický kraj: ${available}.`,
          undefined,
        ];
      }

      const listings = await client.getDoctors(chosenTown.path);
      const sourceUrl = new URL(chosenTown.path, ZOZNAM_LEKAROV_ORIGIN).toString();

      const doctors = listings.slice(0, MAX_DOCTORS_FOR_USER).map((doctor) => {
        const others = doctor.specialities.filter((s) => s !== chosenSpeciality.name);
        return {
          name: doctor.name,
          speciality: chosenSpeciality.name,
          address: doctor.address || 'Not available',
          url: doctor.url,
          phone: null,
          email: null,
          additionalInfo: others.length > 0 ? `Also: ${others.slice(0, 5).join(', ')}` : null,
        };
      });

      const lines = doctors
        .slice(0, MAX_DOCTORS_FOR_MODEL)
        .map((doctor, index) => `${index + 1}. ${doctor.name} — ${doctor.address}`);

      const content = [
        `Speciality: ${chosenSpeciality.name}. Town: ${chosenTown.name}. Found ${listings.length} doctors.`,
        `Source: ${sourceUrl}`,
        ...lines,
        listings.length > lines.length ? `... and ${listings.length - lines.length} more.` : '',
        'The full doctor list is shown to the user automatically. Write a short answer and do not repeat the whole list.',
      ]
        .filter(Boolean)
        .join('\n');

      return [content, { doctors, sourceUrl }];
    },
    {
      name: FIND_DOCTORS_TOOL,
      description:
        'Find doctors of one medical speciality in a town of the Košice region (Slovakia), using the trusted directory zoznam-lekarov.sk.',
      schema: z.object({
        speciality: z
          .string()
          .min(1)
          .describe('Slovak speciality name, e.g. "Neurológ", "Všeobecný lekár", "Kardiológ", "Zubár (stomatológ)".'),
        town: z
          .string()
          .optional()
          .describe('Town in the Košice region, e.g. "Košice I", "Michalovce". Leave empty if the user did not say.'),
      }),
      responseFormat: 'content_and_artifact',
    },
  );
}

/** Lowercase, no diacritics, only letters/digits: "Neurológ" -> "neurolog". */
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

  const scored = specialities
    .map((speciality) => {
      const name = normalize(speciality.name);
      const slug = speciality.slug.replace(/-/g, ' ');
      let score = 0;
      if (name === q || slug === q) score = 4;
      else if (name.startsWith(q) || slug.startsWith(q)) score = 3;
      // "neurologist" contains "neurolog"; "zubar" is inside "zubar stomatolog"
      else if (q.includes(name.split(' ')[0]) && name.split(' ')[0].length >= 5) score = 2;
      else if (name.includes(q) && q.length >= 4) score = 1;
      return { speciality, score, length: name.length };
    })
    .filter((entry) => entry.score > 0)
    // best score first; on a tie prefer the shorter, more general name ("Neurológ" over "Detský neurológ")
    .sort((a, b) => b.score - a.score || a.length - b.length);

  return scored[0]?.speciality;
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

  const scored = towns
    .map((town) => {
      const name = normalize(town.name);
      const firstWord = name.split(' ')[0];
      let score = 0;
      if (name === q) score = 3;
      else if (name.startsWith(q)) score = 2;
      // Slovak cases: "Košiciach", "Michalovciach" share the first 5 letters with the town name
      else if (firstWord.length >= 5 && q.startsWith(firstWord.slice(0, 5))) score = 1;
      return { town, score };
    })
    .filter((entry) => entry.score > 0)
    // on a tie (e.g. several Košice districts) prefer the town with more doctors
    .sort((a, b) => b.score - a.score || b.town.count - a.town.count);

  return scored[0]?.town;
}
