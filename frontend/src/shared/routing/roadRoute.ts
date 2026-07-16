import { dispatchApi } from '../../app/services/dispatch';
import { isSuspiciousStraightRoute, type RouteValidationOptions } from '../yandex/drivingRoute';
import { fetchOsrmRouteGeometry } from './osrmRoute';

export interface RoadRouteResult {
  route: Array<[number, number]>;
  distance_km: number;
  duration_minutes: number;
  geometry_source: 'osrm' | 'yandex' | 'estimated';
}

function isUsableRoadRoute(
  route: Array<[number, number]> | undefined,
  from: [number, number],
  to: [number, number],
  meta: { distance_km?: number; geometry_source?: string },
  options?: RouteValidationOptions,
): boolean {
  if (!route || route.length < 2) return false;
  const source = meta.geometry_source;
  if (source === 'straight' || source === 'unavailable' || source === 'estimated') {
    return false;
  }
  return !isSuspiciousStraightRoute(
    route,
    from,
    to,
    { distance_km: meta.distance_km },
    options,
  );
}

/** Маршрут для карты: backend OSRM → прямой OSRM в браузере (без Yandex). */
export async function fetchRoadRouteForMap(
  from: [number, number],
  to: [number, number],
  options?: RouteValidationOptions,
): Promise<RoadRouteResult | null> {
  try {
    const backend = await dispatchApi.getRoute(from[0], from[1], to[0], to[1]);
    if (isUsableRoadRoute(backend.route, from, to, backend, options)) {
      return {
        route: backend.route,
        distance_km: backend.distance_km,
        duration_minutes: backend.duration_minutes,
        geometry_source: backend.geometry_source === 'yandex' ? 'yandex' : 'osrm',
      };
    }
  } catch (error) {
    console.warn('Backend OSRM route failed, trying public OSRM:', error);
  }

  try {
    const osrm = await fetchOsrmRouteGeometry(from, to);
    if (isUsableRoadRoute(osrm.route, from, to, osrm, options)) {
      return osrm;
    }
  } catch (error) {
    console.warn('Public OSRM route failed:', error);
  }

  return null;
}
