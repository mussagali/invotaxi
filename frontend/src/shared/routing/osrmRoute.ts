/**
 * Маршрут по дорогам через OSRM (OpenStreetMap), без Yandex Router.
 */

export interface OsrmRouteResult {
  route: Array<[number, number]>;
  distance_km: number;
  duration_minutes: number;
  geometry_source: 'osrm';
}

function osrmServers(): string[] {
  const custom = (import.meta.env.VITE_OSRM_BASE_URL as string | undefined)?.trim();
  const servers: string[] = [];
  if (custom) servers.push(custom);
  servers.push('https://router.project-osrm.org');
  return servers;
}

export async function fetchOsrmRouteGeometry(
  from: [number, number],
  to: [number, number],
): Promise<OsrmRouteResult> {
  const [lat1, lon1] = from;
  const [lat2, lon2] = to;
  let lastError: Error | null = null;

  for (const base of osrmServers()) {
    const url =
      `${base.replace(/\/$/, '')}/route/v1/driving/${lon1},${lat1};${lon2},${lat2}` +
      '?overview=full&geometries=geojson';
    try {
      const response = await fetch(url);
      if (!response.ok) {
        lastError = new Error(`OSRM HTTP ${response.status}`);
        continue;
      }
      const data = await response.json();
      if (data.code !== 'Ok' || !data.routes?.[0]) {
        lastError = new Error(data.code ?? 'OSRM NoRoute');
        continue;
      }
      const route = data.routes[0];
      const coordinates: number[][] = route.geometry?.coordinates ?? [];
      const points: Array<[number, number]> = coordinates.map(([lon, lat]) => [lat, lon]);
      if (points.length < 2) {
        lastError = new Error('OSRM empty geometry');
        continue;
      }
      return {
        route: points,
        distance_km: Number(route.distance ?? 0) / 1000,
        duration_minutes: Math.max(1, Math.round(Number(route.duration ?? 0) / 60)),
        geometry_source: 'osrm',
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw lastError ?? new Error('OSRM unavailable');
}
