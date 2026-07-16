/**
 * Маршрут по дорогам через Yandex MultiRouter / ymaps.route.
 * Запросы — по очереди; отбрасываем «маршруты», совпадающие с прямой (через реку).
 */

export const YANDEX_ROUTE_UI_OPTIONS = {
  boundsAutoApply: false,
  balloonPanelMaxMapArea: 0,
  routeOpenBalloonOnClick: false,
  routeBalloonVisible: false,
  routeActiveBalloonVisible: false,
  routeMarkerVisible: false,
  routeWalkMarkerVisible: false,
  pinVisible: false,
  wayPointVisible: false,
} as const;

export interface YandexDrivingRouteResult {
  route: Array<[number, number]>;
  distance_km: number;
  duration_minutes: number;
}

export interface YandexRouteStyle {
  strokeColor: string;
  strokeWidth?: number;
  opacity?: number;
}

export interface RouteValidationOptions {
  /** Подъезд между заказами — строже; поездка pickup→dropoff — доверяем метаданным Yandex. */
  legType?: 'deadhead' | 'ride';
}

const ROUTE_GAP_MS = 200;
const ROUTE_RETRY_MS = 400;
let routeQueue: Promise<unknown> = Promise.resolve();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function enqueueRouteTask<T>(task: () => Promise<T>): Promise<T> {
  const run = routeQueue.then(() => task());
  routeQueue = run.then(
    () => sleep(ROUTE_GAP_MS),
    () => sleep(ROUTE_GAP_MS),
  );
  return run;
}

function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function polylineLengthM(points: Array<[number, number]>): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += haversineM(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1]);
  }
  return total;
}

function flattenCoordinates(raw: unknown): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const walk = (node: unknown): void => {
    if (!Array.isArray(node) || node.length === 0) return;
    if (typeof node[0] === 'number' && typeof node[1] === 'number') {
      out.push([node[0], node[1]]);
      return;
    }
    for (const child of node) walk(child);
  };
  walk(raw);
  return out;
}

function crossTrackDistanceM(
  from: [number, number],
  to: [number, number],
  point: [number, number],
): number {
  const midLat = (from[0] + to[0]) / 2;
  const latScale = 111320;
  const lonScale = 111320 * Math.cos((midLat * Math.PI) / 180);
  const bx = (to[1] - from[1]) * lonScale;
  const by = (to[0] - from[0]) * latScale;
  const lenSq = bx * bx + by * by;
  if (lenSq < 1) return 0;
  const px = (point[1] - from[1]) * lonScale;
  const py = (point[0] - from[0]) * latScale;
  const t = Math.max(0, Math.min(1, (px * bx + py * by) / lenSq));
  const dx = px - t * bx;
  const dy = py - t * by;
  return Math.hypot(dx, dy);
}

function maxCrossTrackDeviationM(
  points: Array<[number, number]>,
  from: [number, number],
  to: [number, number],
): number {
  let maxDev = 0;
  for (const point of points) {
    maxDev = Math.max(maxDev, crossTrackDistanceM(from, to, point));
  }
  return maxDev;
}

function routeDistanceM(meta?: { distance_km?: number; distance_m?: number }): number | null {
  if (meta?.distance_m != null && meta.distance_m > 0) return meta.distance_m;
  if (meta?.distance_km != null && meta.distance_km > 0) return meta.distance_km * 1000;
  return null;
}

/** Прямая или почти прямая линия — типичный признак fallback через реку. */
export function isSuspiciousStraightRoute(
  points: Array<[number, number]>,
  from: [number, number],
  to: [number, number],
  meta?: { distance_km?: number; distance_m?: number },
  options?: RouteValidationOptions,
): boolean {
  const straightM = haversineM(from[0], from[1], to[0], to[1]);
  if (straightM < 150) return false;

  const reportedM = routeDistanceM(meta);
  const isRide = options?.legType === 'ride';

  // Yandex/OSRM вернули длину по дорогам заметно больше прямой — доверяем.
  if (reportedM != null && reportedM > straightM * (isRide ? 1.2 : 1.35)) {
    return false;
  }

  if (!points || points.length < 2) {
    return reportedM == null || reportedM <= straightM * 1.15;
  }

  const pathM = polylineLengthM(points);
  if (isRide && points.length >= 8 && pathM > straightM * 1.1) {
    return false;
  }
  const ratioThreshold = isRide ? 1.15 : 1.25;
  if (pathM < straightM * ratioThreshold) {
    return reportedM == null || reportedM <= straightM * 1.15;
  }

  if (!isRide && straightM >= 800 && maxCrossTrackDeviationM(points, from, to) < 100) {
    return true;
  }

  return false;
}

function appendPathCoordinates(
  target: Array<[number, number]>,
  coords: unknown,
): void {
  for (const point of flattenCoordinates(coords)) {
    const prev = target[target.length - 1];
    if (prev && prev[0] === point[0] && prev[1] === point[1]) continue;
    target.push(point);
  }
}

function processPaths(
  target: Array<[number, number]>,
  paths: { each?: (cb: (path: unknown) => void) => void } | null | undefined,
): void {
  paths?.each?.((path) => {
    const p = path as {
      getCoordinates?: () => unknown;
      geometry?: { getCoordinates?: () => unknown };
    };
    appendPathCoordinates(
      target,
      p.getCoordinates?.() ?? p.geometry?.getCoordinates?.(),
    );
  });
}

function extractRoutePoints(route: {
  getPaths?: () => { each: (cb: (path: unknown) => void) => void };
  getRoutes?: () => { each: (cb: (routeItem: unknown) => void) => void };
  getActiveRoute?: () => {
    getPaths: () => { each: (cb: (path: unknown) => void) => void };
  } | null;
}): Array<[number, number]> {
  const points: Array<[number, number]> = [];

  const activeRoute = route.getActiveRoute?.();
  if (activeRoute?.getPaths) {
    processPaths(points, activeRoute.getPaths());
  }

  if (points.length < 3 && route.getRoutes) {
    route.getRoutes().each((routeItem) => {
      const item = routeItem as { getPaths?: () => { each: (cb: (path: unknown) => void) => void } };
      processPaths(points, item.getPaths?.());
    });
  }

  if (points.length < 3 && route.getPaths) {
    processPaths(points, route.getPaths());
  }

  return points;
}

function readRouteMeta(route: {
  getLength?: () => number;
  getTime?: () => number;
  getActiveRoute?: () => { properties?: { get?: (key: string) => { value?: number } } } | null;
}): { distance_km: number; duration_minutes: number; distance_m: number } {
  const activeRoute = route.getActiveRoute?.();
  const distanceRaw =
    activeRoute?.properties?.get?.('distance')?.value ?? route.getLength?.() ?? 0;
  const durationRaw =
    activeRoute?.properties?.get?.('duration')?.value ?? route.getTime?.() ?? 0;
  const distanceM = typeof distanceRaw === 'number' ? distanceRaw : Number(distanceRaw) || 0;
  const durationS = typeof durationRaw === 'number' ? durationRaw : Number(durationRaw) || 0;
  return {
    distance_m: distanceM,
    distance_km: Math.round((distanceM / 1000) * 100) / 100,
    duration_minutes: Math.max(1, Math.round(durationS / 60)),
  };
}

function fetchMultiRouteOnce(
  map: ymaps.Map,
  from: [number, number],
  to: [number, number],
  routingMode: 'auto' | 'driving',
  style?: YandexRouteStyle,
): Promise<YandexDrivingRouteResult & { layer: ymaps.multiRouter.MultiRoute }> {
  return new Promise((resolve, reject) => {
    if (!window.ymaps?.multiRouter?.MultiRoute) {
      reject(new Error('Yandex MultiRouter unavailable'));
      return;
    }

    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    try {
      const multiRoute = new ymaps.multiRouter.MultiRoute(
        { referencePoints: [from, to], params: { routingMode } },
        {
          ...YANDEX_ROUTE_UI_OPTIONS,
          routeActiveStrokeColor: style?.strokeColor ?? '2563eb',
          routeStrokeColor: style?.strokeColor ?? '2563eb',
          routeActiveStrokeWidth: style?.strokeWidth ?? 4,
          routeStrokeWidth: style?.strokeWidth ?? 4,
          opacity: style?.opacity ?? 0,
        },
      );

      const timeoutId = window.setTimeout(() => {
        try {
          map.geoObjects.remove(multiRoute);
        } catch {
          /* ignore */
        }
        finish(() => reject(new Error('Yandex route timeout')));
      }, 25000);

      const handleSuccess = () => {
        window.clearTimeout(timeoutId);
        const meta = readRouteMeta(multiRoute);
        let points = extractRoutePoints(multiRoute);

        const finalize = () => {
          if (points.length < 2) {
            try {
              map.geoObjects.remove(multiRoute);
            } catch {
              /* ignore */
            }
            finish(() => reject(new Error('Yandex route has no geometry')));
            return;
          }
          finish(() =>
            resolve({
              route: points,
              distance_km: meta.distance_km,
              duration_minutes: meta.duration_minutes,
              layer: multiRoute,
            }),
          );
        };

        if (points.length < 3) {
          window.setTimeout(() => {
            points = extractRoutePoints(multiRoute);
            finalize();
          }, 80);
          return;
        }

        finalize();
      };

      multiRoute.model.events.add('requestsuccess', handleSuccess);

      multiRoute.model.events.add('requestfail', (event: { get?: (key: string) => { message?: string } }) => {
        window.clearTimeout(timeoutId);
        try {
          map.geoObjects.remove(multiRoute);
        } catch {
          /* ignore */
        }
        const msg = event?.get?.('error')?.message || 'Yandex routing failed';
        finish(() => reject(new Error(msg)));
      });

      map.geoObjects.add(multiRoute);
    } catch (error) {
      finish(() => reject(error instanceof Error ? error : new Error('Yandex MultiRouter error')));
    }
  });
}

function fetchYmapsRouteOnce(
  from: [number, number],
  to: [number, number],
  routingMode: 'auto' | 'driving',
): Promise<YandexDrivingRouteResult> {
  return new Promise((resolve, reject) => {
    if (!window.ymaps?.route) {
      reject(new Error('ymaps.route unavailable'));
      return;
    }
    window.ymaps
      .route([from, to], { routingMode, mapStateAutoApply: false })
      .then(
        (route) => {
          const points = extractRoutePoints(route);
          const meta = readRouteMeta(route);
          if (points.length < 2) {
            reject(new Error('ymaps.route empty geometry'));
            return;
          }
          resolve({ route: points, distance_km: meta.distance_km, duration_minutes: meta.duration_minutes });
        },
        (err) => reject(err instanceof Error ? err : new Error('ymaps.route failed')),
      );
  });
}

function acceptRouteResult(
  result: YandexDrivingRouteResult,
  from: [number, number],
  to: [number, number],
  options?: RouteValidationOptions,
): boolean {
  return !isSuspiciousStraightRoute(
    result.route,
    from,
    to,
    { distance_km: result.distance_km },
    options,
  );
}

export function fetchYandexDrivingRouteGeometry(
  map: ymaps.Map,
  from: [number, number],
  to: [number, number],
  options?: RouteValidationOptions,
): Promise<YandexDrivingRouteResult> {
  return enqueueRouteTask(async () => {
    const modes: Array<'driving' | 'auto'> = ['driving', 'auto'];
    let lastError: Error | null = null;

    for (const mode of modes) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const result = await fetchMultiRouteOnce(map, from, to, mode);
          try {
            map.geoObjects.remove(result.layer);
          } catch {
            /* ignore */
          }
          if (acceptRouteResult(result, from, to, options)) {
            return {
              route: result.route,
              distance_km: result.distance_km,
              duration_minutes: result.duration_minutes,
            };
          }
          lastError = new Error('MultiRoute geometry too straight');
        } catch (error) {
          lastError = error instanceof Error ? error : new Error('MultiRoute failed');
        }
        await sleep(ROUTE_RETRY_MS);
      }
    }

    for (const mode of modes) {
      try {
        const result = await fetchYmapsRouteOnce(from, to, mode);
        if (acceptRouteResult(result, from, to, options)) {
          return result;
        }
        lastError = new Error('ymaps.route geometry too straight');
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('ymaps.route failed');
      }
      await sleep(ROUTE_RETRY_MS);
    }

    throw lastError ?? new Error('No road route from Yandex');
  });
}

/** Оставляет MultiRoute на карте — запасной вариант, если polyline не построить. */
export function addYandexDrivingRouteLayer(
  map: ymaps.Map,
  from: [number, number],
  to: [number, number],
  style: YandexRouteStyle,
  options?: RouteValidationOptions,
): Promise<YandexDrivingRouteResult & { layer: ymaps.multiRouter.MultiRoute }> {
  return enqueueRouteTask(async () => {
    const modes: Array<'driving' | 'auto'> = ['driving', 'auto'];
    let lastError: Error | null = null;

    for (const mode of modes) {
      try {
        const result = await fetchMultiRouteOnce(map, from, to, mode, {
          ...style,
          opacity: style.opacity ?? 0.9,
        });
        if (acceptRouteResult(result, from, to, options)) {
          return result;
        }
        try {
          map.geoObjects.remove(result.layer);
        } catch {
          /* ignore */
        }
        lastError = new Error('MultiRoute geometry too straight');
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('MultiRoute failed');
      }
      await sleep(ROUTE_RETRY_MS);
    }

    throw lastError ?? new Error('No road route from Yandex');
  });
}

export function createStraightRoutePolyline(
  from: [number, number],
  to: [number, number],
  style: YandexRouteStyle,
): ymaps.Polyline {
  return new ymaps.Polyline(
    [from, to],
    {},
    {
      strokeColor: style.strokeColor,
      strokeWidth: style.strokeWidth ?? 5,
      opacity: (style.opacity ?? 0.9) * 0.5,
      strokeStyle: 'shortdash',
    },
  );
}
