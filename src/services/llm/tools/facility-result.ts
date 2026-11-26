import { Logger } from '@nestjs/common';
import type { RunnableConfig } from '@langchain/core/runnables';
import { tool } from '@langchain/core/tools';
import type {
  DoctorListTexts,

  FindMedicalFacilityTexts,
  RequestLocationTexts,
} from '../../../config/llm.config.js';
import { fillTemplate } from '../../../config/template.js';
import type { LocationAccess, SharedLocation } from '../device-location.service.js';
import type { DoctorResponse } from '../doctor-response.js';
import {
  facilitySearchSchema,
  type createFindMedicalFacilityTool,
} from './find-medical-facility.tool.js';
import { normalize } from './find-doctors.tool.js';
import { askDeviceLocation } from './request-location.tool.js';


export const FIND_MEDICAL_FACILITY_TOOL = 'find_medical_facility';

const MAX_FOR_USER = 20;
const MAX_FOR_MODEL = 8;
const TIMEOUT_MS = 20_000;
const REGISTER_URL = 'https://www.geoportalksk.sk/home/zdravotnictvo-kosickeho-kraja/';
const INSURERS: Record<string, string> = { vszp: 'VšZP', dovera: 'Dôvera', union: 'Union' };

const logger = new Logger('FindMedicalFacility');

type FacilityTool = ReturnType<typeof createFindMedicalFacilityTool>;
type Doctor = DoctorResponse['doctors'][number];

export type Facility = {
  properties: Record<string, unknown>;
  geometry?: { type?: string; coordinates?: number[] } | null;
};

export type FacilityArtifact = {
  doctors: Doctor[];
  sourceUrls: string[];
};

type Texts = {
  findMedicalFacility: FindMedicalFacilityTexts;
  doctorList: DoctorListTexts;
  requestLocation: RequestLocationTexts;
};

const modelSchema = facilitySearchSchema.omit({ user_latitude: true, user_longitude: true });

export function townOf(facility: Facility): string | undefined {
  const { municipality, county } = facility.properties;
  if (typeof municipality === 'string' && municipality.startsWith('Košice - mestská časť')) {
    return typeof county === 'string' ? county : undefined;
  }
  return typeof municipality === 'string' && municipality ? municipality : undefined;
}

export function inTown(facilities: Facility[], town: string): Facility[] {
  const wanted = normalize(town);
  return facilities.filter((facility) => normalize(townOf(facility) ?? '') === wanted);
}

export function inCounty(facilities: Facility[], county: string): Facility[] {
  const wanted = normalize(county);
  return facilities.filter(
    (facility) =>
      normalize(String(facility.properties.county ?? '')) === wanted ||
      normalize(townOf(facility) ?? '') === wanted,
  );
}

export function withoutDuplicateFacilities(facilities: Facility[]): Facility[] {
  const seen = new Set<string>();
  return facilities.filter((facility) => {
    const key = `${normalize(String(facility.properties.nazov_zariadenia ?? ''))}|${normalize(
      String(facility.properties.addressline ?? ''),
    )}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function distanceOf(facility: Facility): number | undefined {
  const km = facility.properties.distance_to_home_km;
  return typeof km === 'number' && Number.isFinite(km) ? km : undefined;
}

export function byDistance(facilities: Facility[]): Facility[] {
  return [...facilities].sort(
    (a, b) => (distanceOf(a) ?? Number.POSITIVE_INFINITY) - (distanceOf(b) ?? Number.POSITIVE_INFINITY),
  );
}

function formatKm(km: number): string {
  return km < 10 ? km.toFixed(1) : String(Math.round(km));
}

export function facilityToDoctor(facility: Facility, speciality: string, texts: DoctorListTexts): Doctor {
  const p = facility.properties;
  const text = (key: string) => {
    const value = typeof p[key] === 'string' ? p[key].trim() : '';
    return value || null;
  };

  const hours = Object.entries(texts.days)
    .filter(([day]) => text(day))
    .map(([day, short]) => `${short} ${text(day)}`)
    .join('; ');
  const insurers = Object.entries(INSURERS)
    .filter(([field]) => p[field] === 'áno')
    .map(([, name]) => name)
    .join(', ');
  const km = distanceOf(facility);
  const info = [
    km !== undefined ? fillTemplate(texts.distance, { km: formatKm(km) }) : '',
    hours ? fillTemplate(texts.openingHours, { hours }) : '',
    insurers ? fillTemplate(texts.insurers, { insurers }) : '',
  ]
    .filter(Boolean)
    .join(' · ');

  return {
    name: text('nazov_zariadenia') ?? texts.addressMissing,
    speciality,
    address: (text('addressline') ?? texts.addressMissing).replace(/,\s*Slovenská republika\s*$/, ''),
    url: mapUrl(facility),
    phone: text('telefon') ?? text('mobil'),
    email: text('email'),
    additionalInfo: info || null,
  };
}

export function mapUrl(facility: Facility): string {
  const [lon, lat] = facility.geometry?.coordinates ?? [];
  return Number.isFinite(lat) && Number.isFinite(lon)
    ? `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`
    : REGISTER_URL;
}

export function facilityResult(
  facilities: Facility[],
  {
    what,
    town,
    speciality,
    radiusKm,
    near,
  }: { what: string; town?: string; speciality: string; radiusKm?: number; near?: string },
  texts: Pick<Texts, 'findMedicalFacility' | 'doctorList'>,
): [string, FacilityArtifact | undefined] {
  const t = texts.findMedicalFacility;
  const place =
    town ??
    (radiusKm !== undefined
      ? fillTemplate(t.nearby, { km: radiusKm })
      : near !== undefined
        ? fillTemplate(t.nearPlace, { place: near })
        : t.anywhere);
  const unique = byDistance(withoutDuplicateFacilities(facilities));
  if (unique.length === 0) return [fillTemplate(t.noResults, { what, town: place }), undefined];

  const doctors = unique.slice(0, MAX_FOR_USER).map((f) => facilityToDoctor(f, speciality, texts.doctorList));
  const lines = doctors.slice(0, MAX_FOR_MODEL).map((d, i) => {
    const km = distanceOf(unique[i]);
    return fillTemplate(t.resultFacility, {
      index: i + 1,
      name: d.name,
      address: d.address,
      distance: km !== undefined ? fillTemplate(t.distance, { km: formatKm(km) }) : '',
    });
  });
  const header = unique.length > doctors.length ? t.resultHeaderPartial : t.resultHeader;

  const content = [
    fillTemplate(header, { count: unique.length, what, town: place, shown: doctors.length }),
    ...lines,
    unique.length > lines.length ? fillTemplate(t.resultMore, { count: unique.length - lines.length }) : '',
    t.resultFooter,
  ]
    .filter(Boolean)
    .join('\n');
  return [content, { doctors, sourceUrls: [REGISTER_URL] }];
}

async function callTool(facilityTool: FacilityTool, args: Record<string, unknown>): Promise<Facility[]> {
  const result = await Promise.race([
    facilityTool.invoke(args),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`no answer in ${TIMEOUT_MS / 1000}s`)), TIMEOUT_MS),
    ),
  ]);
  return Array.isArray(result) ? (result as Facility[]) : [];
}


async function searchLocation(
  location: LocationAccess | undefined,
  county: string | undefined,
  config: RunnableConfig | undefined,
): Promise<SharedLocation | undefined> {
  if (!location) return undefined;
  const state = location.state();
  if (state.status === 'shared') return state.location;
  if (state.status !== 'unknown' || county) return undefined;

  const reply = await askDeviceLocation(location, config);
  return reply.kind === 'shared' ? reply.location : undefined;
}

export function createFacilityToolForModel(
  facilityTool: FacilityTool,
  texts: Texts,
  location?: LocationAccess,
) {
  return tool(
    async (args: Record<string, unknown>, config): Promise<[string, FacilityArtifact | undefined]> => {
      const what = String(args.query ?? '');
      const county = typeof args.county_filter === 'string' ? args.county_filter : undefined;
      const radiusKm = typeof args.radius === 'number' ? args.radius : undefined;
      try {
        const near = await searchLocation(location, county, config);
        const found = await callTool(facilityTool, {
          ...args,
          ...(near ? { user_latitude: near.lat, user_longitude: near.lon } : {}),
        });
        const exact = county ? inCounty(found, county) : found;
        return facilityResult(
          exact.length > 0 ? exact : found,
          {
            what,
            town: county,
            speciality: what,
            radiusKm: near ? radiusKm : undefined,
            near: near ? (near.label ?? texts.requestLocation.unnamedPlace) : undefined,
          },
          texts,
        );
      } catch (error) {
        logger.warn(`find_medical_facility failed: ${String(error)}`);
        return [fillTemplate(texts.findMedicalFacility.failed, { what }), undefined];
      }
    },
    {
      name: FIND_MEDICAL_FACILITY_TOOL,
      description: facilityTool.description,
      schema: modelSchema,
      responseFormat: 'content_and_artifact',
    },
  );
}
