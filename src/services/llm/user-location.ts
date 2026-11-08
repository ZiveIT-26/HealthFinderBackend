
export type UserLocation = {
  lat: number;
  lon: number;
};

export function parseUserLocation(value: unknown): UserLocation | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const { lat, lon } = value as Record<string, unknown>;
  const latitude = Number(lat);
  const longitude = Number(lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return undefined;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return undefined;
  return { lat: latitude, lon: longitude };
}
