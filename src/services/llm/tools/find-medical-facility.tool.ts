import { tool } from '@langchain/core/tools';
import { z } from 'zod';

const WFS_URL = 'https://www.geoportalksk.sk/geoserver/wfs';
const NAME_SEARCH_COLUMNS = ['nazov_zariadenia', 'druh_zariadenia'];
const GEOMETRY_COLUMN = 'geom';
const PAGE_SIZE = 500;
const REQUEST_DELAY = 500;

const KEYS_TO_REMOVE_PROPERTIES = [
  'id',
  'identifikator',
  'kpzs_kod',
  'typ_zariadenia_id',
  'typ_zariadenia_complex_code',
  'poskytovatel_id',
  'poloha_lat',
  'poloha_lon',
];

const KEYS_TO_REMOVE_POINT = ['type', 'id', 'bbox'];

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function createFindMedicalFacilityTool() {
  return tool(
    async ({ query, county_filter, user_latitude, user_longitude, radius }) => {
      const baseParams = getBaseParams(
        query,
        county_filter,
        user_latitude,
        user_longitude,
        radius,
      );

      let total = 0;
      try {
        total = await getTotalRecords(baseParams);
      } catch (e) {
        console.error('Failed to get total records:', e);
        return [];
      }

      if (total === 0) return [];

      const allFeatures: any[] = [];

      for (let startIndex = 0; startIndex < total; startIndex += PAGE_SIZE) {
        const expected = Math.min(PAGE_SIZE, total - startIndex);

        try {
          const features = await getPage(baseParams, startIndex, expected);
          if (!features || features.length === 0) break;

          allFeatures.push(...features);

          if (features.length < expected) break;

          await delay(REQUEST_DELAY);
        } catch (e) {
          console.error(`Failed to fetch page starting at ${startIndex}:`, e);
          break;
        }
      }

      for (const feature of allFeatures) {
        for (const key of KEYS_TO_REMOVE_POINT) delete feature[key];

        const properties = feature.properties || {};
        for (const key of KEYS_TO_REMOVE_PROPERTIES) delete properties[key];

        const geom = feature.geometry;
        if (
          geom &&
          geom.type === 'Point' &&
          user_latitude !== undefined &&
          user_longitude !== undefined
        ) {
          const [fac_lon, fac_lat] = geom.coordinates || [0, 0];
          const dist = haversineDistance(
            user_latitude,
            user_longitude,
            fac_lat,
            fac_lon,
          );
          properties.distance_to_home_km = Number(dist.toFixed(2));
        } else {
          properties.distance_to_home_km = Infinity;
        }
      }

      if (user_latitude !== undefined && user_longitude !== undefined) {
        allFeatures.sort(
          (a, b) =>
            (a.properties.distance_to_home_km || Infinity) -
            (b.properties.distance_to_home_km || Infinity),
        );
      }

      return allFeatures;
    },
    {
      name: 'find_medical_facility',
      description:
        'Search for healthcare facilities and doctors in the Košice region based on name, county, and distance from the user.',
      schema: z.object({
        query: z
          .string()
          .optional()
          .describe(
            "Search string for the facility or doctor name/type (e.g., 'zubná').",
          ),
        county_filter: z
          .string()
          .optional()
          .describe("Filter by specific county (e.g., 'Košice I')."),
        user_latitude: z
          .number()
          .optional()
          .describe("User's latitude for distance calculation."),
        user_longitude: z
          .number()
          .optional()
          .describe("User's longitude for distance calculation."),
        radius: z.number().optional().describe('Search radius in kilometers.'),
      }),
    },
  );
}

export function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371.0;
  const toRad = (val: number) => (val * Math.PI) / 180;

  const lat1Rad = toRad(lat1);
  const lon1Rad = toRad(lon1);
  const lat2Rad = toRad(lat2);
  const lon2Rad = toRad(lon2);

  const dlat = lat2Rad - lat1Rad;
  const dlon = lon2Rad - lon1Rad;

  const a =
    Math.sin(dlat / 2) ** 2 +
    Math.cos(lat1Rad) * Math.cos(lat2Rad) * Math.sin(dlon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

export function getBaseParams(
  nameFilter?: string,
  countyFilter?: string,
  lat?: number,
  lon?: number,
  radiusKm?: number,
): URLSearchParams {
  const params = new URLSearchParams({
    service: 'WFS',
    version: '2.0.0',
    request: 'GetFeature',
    typeNames: 'ksk_evucsk:poskytovatelia_zs',
    outputFormat: 'application/json',
    sortBy: 'id A',
    srsName: 'EPSG:4326',
  });

  const cqlConditions: string[] = [];

  if (nameFilter) {
    const nameConds = NAME_SEARCH_COLUMNS.map(
      (col) => `${col} ILIKE '%${nameFilter}%'`,
    );
    cqlConditions.push(`(${nameConds.join(' OR ')})`);
  }

  if (countyFilter) {
    cqlConditions.push(`county ILIKE '%${countyFilter}%'`);
  }

  if (lat !== undefined && lon !== undefined && radiusKm !== undefined) {
    const x = (lon * 20037508.34) / 180;
    const y =
      (Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) / (Math.PI / 180)) *
      (20037508.34 / 180);

    const scaleFactor = 1 / Math.cos((lat * Math.PI) / 180);
    const radiusMeters = radiusKm * 1000 * scaleFactor;

    cqlConditions.push(
      `DWITHIN(${GEOMETRY_COLUMN}, POINT(${x} ${y}), ${radiusMeters}, meters)`,
    );
  }

  if (cqlConditions.length > 0) {
    params.set('cql_filter', cqlConditions.join(' AND '));
  }

  return params;
}

export async function getTotalRecords(
  baseParams: URLSearchParams,
): Promise<number> {
  const params = new URLSearchParams(baseParams);
  params.delete('outputFormat');
  params.delete('sortBy');
  params.set('resultType', 'hits');

  const response = await fetch(`${WFS_URL}?${params.toString()}`);
  if (!response.ok) throw new Error('Failed to fetch count');

  const text = await response.text();
  const match = text.match(/numberMatched="(\d+)"/);

  if (!match || match[1] === 'unknown') {
    throw new Error('The server did not provide a valid record count.');
  }

  return parseInt(match[1], 10);
}

export async function getPage(
  baseParams: URLSearchParams,
  startIndex: number,
  count: number,
): Promise<any[]> {
  const params = new URLSearchParams(baseParams);
  params.set('startIndex', startIndex.toString());
  params.set('count', count.toString());

  const response = await fetch(`${WFS_URL}?${params.toString()}`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const data = await response.json();
  if (!data.features) throw new Error('Invalid GeoJSON response.');

  return data.features;
}

