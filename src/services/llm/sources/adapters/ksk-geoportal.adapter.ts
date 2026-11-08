import { Logger } from '@nestjs/common';
import type { DoctorListTexts, FacilityType, LlmConfig } from '../../../../config/llm.config.js';
import { fillTemplate } from '../../../../config/template.js';
// The WFS requests are the ones written for the find_medical_facility tool.
import { getBaseParams, getPage, getTotalRecords } from '../../tools/find-medical-facility.tool.js';
import type { DoctorListing, DoctorSource, Speciality, Town } from '../doctor-source.js';
import { PageCache } from '../page-cache.js';

/**
 * Adapter (DoctorSource) for the official register of healthcare providers of
 * Košický kraj (geoportalksk.sk, WFS layer ksk_evucsk:poskytovatelia_zs).
 *
 *   speciality -> facility types (config/ksk-geoportal.yaml)
 *              -> one WFS query for those types (cached for CACHE_TTL_MS)
 *              -> grouped by town -> doctors
 *
 * Compared with zoznam-lekarov.sk it has opening hours, insurers and
 * coordinates, but no web page per doctor: the link is a map pin.
 */

const GEOPORTAL_URL = 'https://www.geoportalksk.sk';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const PAGE_SIZE = 500;
const PAGE_DELAY_MS = 500;
const REQUEST_TIMEOUT_MS = 20_000;

const INSURERS: Record<string, string> = { vszp: 'VšZP', dovera: 'Dôvera', union: 'Union' };

/** The fields of one facility that this adapter uses. */
type Facility = {
  properties: Record<string, string | number | null | undefined>;
  geometry?: { type: string; coordinates?: [number, number] } | null;
};

export class KskGeoportalAdapter implements DoctorSource {
  readonly name = 'geoportalksk.sk (register KSK)';

  private readonly cache = new PageCache(CACHE_TTL_MS);
  private readonly logger = new Logger('KskGeoportal');
  private readonly specialities: Record<string, FacilityType[]>;
  private readonly texts: DoctorListTexts;

  constructor(llmConfig: LlmConfig) {
    this.specialities = llmConfig.kskGeoportal.specialities;
    this.texts = llmConfig.doctorList;
  }

  async getSpecialities(): Promise<Speciality[]> {
    return Object.keys(this.specialities).map((name) => ({ name, id: name, count: 0 }));
  }

  async getTowns(speciality: Speciality): Promise<Town[]> {
    const counts = new Map<string, number>();
    for (const facility of await this.getFacilities(speciality)) {
      const town = townOf(facility);
      if (town) counts.set(town, (counts.get(town) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort(([a], [b]) => a.localeCompare(b, 'sk'))
      .map(([name, count]) => ({ name, id: name, url: GEOPORTAL_URL, count }));
  }

  async getDoctors(speciality: Speciality, town: Town): Promise<DoctorListing[]> {
    return (await this.getFacilities(speciality))
      .filter((facility) => townOf(facility) === town.id)
      .map((facility) => this.toListing(facility));
  }

  /** All facilities of the types mapped to this speciality. */
  private async getFacilities(speciality: Speciality): Promise<Facility[]> {
    const types = this.specialities[speciality.id] ?? [];
    if (types.length === 0) return [];

    const typeList = [...new Set(types.map((t) => t.type))].map((t) => `'${t.replace(/'/g, "''")}'`);
    const params = getBaseParams();
    params.set('cql_filter', `druh_zariadenia IN (${typeList.join(', ')})`);

    const { body, outcome } = await this.cache.get(params.toString(), async () => ({
      status: 200,
      body: JSON.stringify(await this.fetchAll(params)),
    }));
    if (outcome === 'stale') {
      this.logger.warn(`register did not answer, using the old copy for ${speciality.name}`);
    } else if (outcome !== 'fresh') {
      this.logger.log(`${speciality.name}: ${outcome}`);
    }

    // Some types are shared by adults and children; codeIncludes tells them apart.
    return (JSON.parse(body) as Facility[]).filter((facility) =>
      types.some(
        (t) =>
          facility.properties.druh_zariadenia === t.type &&
          (!t.codeIncludes ||
            String(facility.properties.typ_zariadenia_complex_code ?? '').includes(t.codeIncludes)),
      ),
    );
  }

  /** Same paging as the find_medical_facility tool, with a timeout per request. */
  private async fetchAll(params: URLSearchParams): Promise<Facility[]> {
    const total = await withTimeout(getTotalRecords(params));
    const facilities: Facility[] = [];
    for (let start = 0; start < total; start += PAGE_SIZE) {
      const page = (await withTimeout(getPage(params, start, Math.min(PAGE_SIZE, total - start)))) as Facility[];
      facilities.push(...page);
      if (page.length < PAGE_SIZE) break;
      await new Promise((resolve) => setTimeout(resolve, PAGE_DELAY_MS));
    }
    return facilities;
  }

  private toListing(facility: Facility): DoctorListing {
    const p = facility.properties;
    return {
      name: facilityName(p),
      specialities: [],
      address: String(p.addressline ?? '').replace(/,\s*Slovenská republika\s*$/, ''),
      url: mapUrl(facility),
      details: this.details(p) || undefined,
    };
  }

  /** "Ordinačné hodiny: Po 7:00 - 15:00; Ut ... · Poisťovne: VšZP, Dôvera" */
  private details(p: Facility['properties']): string {
    const hours = Object.entries(this.texts.days)
      .filter(([day]) => p[day])
      .map(([day, short]) => `${short} ${p[day]}`)
      .join('; ');
    const insurers = Object.entries(INSURERS)
      .filter(([field]) => p[field] === 'áno')
      .map(([, name]) => name)
      .join(', ');
    return [
      hours ? fillTemplate(this.texts.openingHours, { hours }) : '',
      insurers ? fillTemplate(this.texts.insurers, { insurers }) : '',
    ]
      .filter(Boolean)
      .join(' · ');
  }
}

/**
 * Town name in the same form as zoznam-lekarov.sk: Košice city parts become
 * their district ("Košice - mestská časť Juh" -> county "Košice IV"),
 * everything else is the municipality ("Michalovce", "Sečovce").
 */
export function townOf(facility: Facility): string | undefined {
  const { municipality, county } = facility.properties;
  if (typeof municipality === 'string' && municipality.startsWith('Košice - mestská časť')) {
    return typeof county === 'string' ? county : undefined;
  }
  return typeof municipality === 'string' && municipality ? municipality : undefined;
}

/**
 * "MUDr. Vladimír Šafčák, MPH (1. Neurologická, a.s.)": the doctors from
 * `odborni_zastupcovia` plus the provider (last brackets of the facility name).
 */
export function facilityName(p: Facility['properties']): string {
  const fullName = String(p.nazov_zariadenia ?? '').trim();
  const doctors = String(p.odborni_zastupcovia ?? '')
    // "... ako lekár", "... ako zubný lekár": the role, up to the next comma
    .replace(/\s+ako\s+[\p{L} ]+?(?=,|$)/gu, '')
    .trim();
  if (!doctors) return fullName;
  const provider = fullName.match(/\(([^()]*)\)\s*$/)?.[1]?.trim();
  return provider && provider !== doctors ? `${doctors} (${provider})` : doctors;
}

function mapUrl(facility: Facility): string {
  const [lon, lat] = facility.geometry?.coordinates ?? [
    Number(facility.properties.poloha_lon),
    Number(facility.properties.poloha_lat),
  ];
  return Number.isFinite(lat) && Number.isFinite(lon)
    ? `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`
    : GEOPORTAL_URL;
}

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`no answer in ${REQUEST_TIMEOUT_MS / 1000}s`)), REQUEST_TIMEOUT_MS),
    ),
  ]);
}
