/**
 * Слой локального поиска адресов (единая логика для админки и карты).
 *
 * Схема:
 *   input → SuggestView (yandex#search, OBLAST — ТЦ, рестораны, улицы)
 *         → select / Enter
 *         → geocode: search → map (фильтр области)
 *         → cache + requestId
 *
 * На карте: SearchControl (yandex#search) для организаций и POI.
 * Зеркало: invo_common/lib/widgets/yandex_order_map_html.dart
 */

import {
  YANDEX_CITY_BOUNDS,
  YANDEX_CITY_NAME,
  YANDEX_OBLAST_BOUNDS,
  YANDEX_OBLAST_NAME,
} from './bounds';

export interface AddressSearchResult {
  coords: number[];
  address: string;
}

export function normalizeAddress(value: string): string {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/^г\.?\s*/i, '')
    .replace(new RegExp(`^${YANDEX_OBLAST_NAME},?\\s*`, 'i'), '')
    .replace(new RegExp(`^${YANDEX_CITY_NAME},?\\s*`, 'i'), '');
}

/** Населённые пункты области — не подставляем «Атырау» автоматически. */
const OTHER_SETTLEMENT_PATTERN =
  /курмангазы|макат|индербор|махамбет|кулсары|ишимбай|даулба|ганюшкино/i;

export function makeSearchQuery(value: string): string {
  const clean = normalizeAddress(value);
  if (!clean) return '';
  if (OTHER_SETTLEMENT_PATTERN.test(clean)) return clean;
  if (/\bатырау\b/i.test(clean)) return clean;
  return `${YANDEX_CITY_NAME}, ${clean}`;
}

export function isInsideCityBounds(coords: number[]): boolean {
  const [lat, lon] = coords;
  return (
    lat >= YANDEX_CITY_BOUNDS[0][0] &&
    lat <= YANDEX_CITY_BOUNDS[1][0] &&
    lon >= YANDEX_CITY_BOUNDS[0][1] &&
    lon <= YANDEX_CITY_BOUNDS[1][1]
  );
}

export function isInsideServiceBounds(coords: number[]): boolean {
  const [lat, lon] = coords;
  return (
    lat >= YANDEX_OBLAST_BOUNDS[0][0] &&
    lat <= YANDEX_OBLAST_BOUNDS[1][0] &&
    lon >= YANDEX_OBLAST_BOUNDS[0][1] &&
    lon <= YANDEX_OBLAST_BOUNDS[1][1]
  );
}

const geocodeCache = new Map<string, Promise<AddressSearchResult | null>>();

function parseGeoObject(geoObject: any, fallbackQuery: string): AddressSearchResult | null {
  const coords: number[] | undefined = geoObject?.geometry?.getCoordinates?.();
  if (!coords || coords.length < 2) return null;

  let address = '';
  try {
    address =
      geoObject.getAddressLine?.() ||
      geoObject.properties.get('text') ||
      geoObject.properties.get('name') ||
      '';
  } catch {
    /* ignore */
  }
  if (!address) address = fallbackQuery;

  return { coords, address };
}

/** Разбор geoObject из SearchControl (yandex#search): name + description. */
export function parseSearchGeoObject(geoObject: any): AddressSearchResult | null {
  if (!geoObject?.geometry) return null;
  const coords: number[] | undefined = geoObject.geometry.getCoordinates?.();
  if (!coords || coords.length < 2) return null;

  let name = '';
  let description = '';
  let text = '';
  try {
    name = geoObject.properties.get('name') || '';
    description = geoObject.properties.get('description') || '';
    text = geoObject.properties.get('text') || '';
  } catch {
    /* ignore */
  }

  let address = text;
  if (!address) {
    address = [name, description].filter(Boolean).join(', ');
  }
  if (!address) {
    address = geoObject.getAddressLine?.() || name || description || '';
  }
  if (!address) return null;

  return { coords, address };
}

function scoreAddressResult(result: AddressSearchResult, query: string): number {
  const [lat, lon] = result.coords;
  const addr = result.address.toLowerCase();
  const q = query.toLowerCase();
  let score = 0;

  if (isInsideCityBounds([lat, lon])) score += 100;

  if (/\bатырау\b/.test(addr) && !/курмангазы/.test(addr)) score += 60;
  if (/город\s+атырау|атырау,\s*казахстан/.test(addr)) score += 40;

  if (!OTHER_SETTLEMENT_PATTERN.test(q)) {
    if (/курмангазы|село\s|аудан|қазақ|с\.?\s/i.test(addr)) score -= 120;
    if (/\bмакат\b|\bкулсары\b|\bиндербор\b/.test(addr)) score -= 80;
  }

  return score;
}

function pickBestFromGeoObjects(
  geoObjects: any,
  query: string,
  useSearchParser: boolean,
  filterByService: boolean,
): AddressSearchResult | null {
  const candidates: AddressSearchResult[] = [];

  for (let i = 0; i < geoObjects.getLength(); i++) {
    const obj = geoObjects.get(i);
    const parsed = useSearchParser
      ? parseSearchGeoObject(obj)
      : parseGeoObject(obj, query);
    if (!parsed) continue;
    if (filterByService && !isInsideServiceBounds(parsed.coords)) continue;
    candidates.push(parsed);
  }

  if (!candidates.length) return null;

  candidates.sort(
    (a, b) => scoreAddressResult(b, query) - scoreAddressResult(a, query),
  );
  return candidates[0];
}

function pickFromGeoObjects(
  geoObjects: any,
  query: string,
  useSearchParser: boolean,
  filterByService: boolean,
): AddressSearchResult | null {
  return pickBestFromGeoObjects(geoObjects, query, useSearchParser, filterByService);
}

function geocodeWithProvider(
  query: string,
  provider: 'yandex#map' | 'yandex#search',
  boundedBy: number[][],
  strictBounds: boolean,
  results: number,
  filterByService: boolean,
): Promise<AddressSearchResult | null> {
  return window.ymaps
    .geocode(query, {
      boundedBy,
      strictBounds,
      results,
      provider,
    })
    .then((res: any) =>
      pickFromGeoObjects(
        res.geoObjects,
        query,
        provider === 'yandex#search',
        filterByService,
      ),
    )
    .catch(() => null);
}

function resolveQuery(
  query: string,
  strict = true,
): Promise<AddressSearchResult | null> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return Promise.resolve(null);

  const cacheKey = `resolve:${trimmed}:${strict}`;
  const cached = geocodeCache.get(cacheKey);
  if (cached) return cached;

  const promise = (async () => {
    const cityQuery = makeSearchQuery(trimmed);

    // 1. Заведения в городе Атырау
    let result = await geocodeWithProvider(
      cityQuery,
      'yandex#search',
      YANDEX_CITY_BOUNDS,
      false,
      10,
      true,
    );
    if (result && scoreAddressResult(result, cityQuery) >= 50) return result;

    // 2. Улицы и дома в городе
    const cityStreet = await geocodeWithProvider(
      cityQuery,
      'yandex#map',
      YANDEX_CITY_BOUNDS,
      true,
      5,
      true,
    );
    if (cityStreet) return cityStreet;
    if (result && isInsideCityBounds(result.coords)) return result;

    if (!strict) return null;

    // 3. Заведения по области (село, районы)
    result = await geocodeWithProvider(
      OTHER_SETTLEMENT_PATTERN.test(trimmed) ? trimmed : cityQuery,
      'yandex#search',
      YANDEX_OBLAST_BOUNDS,
      false,
      10,
      true,
    );
    if (result) return result;

    // 4. Адреса по области
    return geocodeWithProvider(
      cityQuery,
      'yandex#map',
      YANDEX_OBLAST_BOUNDS,
      false,
      5,
      true,
    );
  })();

  geocodeCache.set(cacheKey, promise);
  return promise;
}

/**
 * Геокод текста: только при выборе подсказки или Enter.
 * Цепочка: search (заведения) → map+город → map+область.
 */
export function geocodeAddress(
  value: string,
  strict = true,
): Promise<AddressSearchResult | null> {
  const query = makeSearchQuery(value);
  if (query.length < 2) return Promise.resolve(null);
  return resolveQuery(query, strict);
}

/** Алиас для Enter / программного поиска. */
export function findBestAddress(
  value: string,
  strict = true,
): Promise<AddressSearchResult | null> {
  return geocodeAddress(value, strict);
}

/**
 * SuggestView: заведения + адреса в Атырауской области (как SearchControl на карте).
 */
export function createSuggestView(
  input: HTMLElement | string,
  onSelect: (result: AddressSearchResult, rawValue: string) => void,
  onNotFound?: (rawValue: string) => void,
): () => void {
  let requestId = 0;

  const suggestView = new window.ymaps.SuggestView(input, {
    boundedBy: YANDEX_CITY_BOUNDS,
    strictBounds: false,
    results: 10,
    provider: 'yandex#search',
  });

  suggestView.events.add('select', async (event: any) => {
    const item = event.get('item');
    const value: string = item?.value ?? item?.displayName ?? '';
    if (!value) return;

    const currentRequestId = ++requestId;
    // Подсказка уже от search — геокодим как есть, без переписывания запроса
    const result = await resolveQuery(value, true);
    if (currentRequestId !== requestId) return;

    if (!result) {
      onNotFound?.(value);
      return;
    }
    onSelect(result, value);
  });

  return () => {
    try {
      suggestView.destroy();
    } catch {
      /* уже уничтожен */
    }
  };
}

export interface SearchControlAttachOptions {
  onSelect: (result: AddressSearchResult) => void;
  onNotFound?: () => void;
  placeholder?: string;
  results?: number;
}

export function attachSearchControl(
  map: ymaps.Map,
  options: SearchControlAttachOptions,
): () => void {
  let requestId = 0;

  const searchControl = new ymaps.control.SearchControl({
    options: {
      provider: 'yandex#search',
      size: 'large',
      float: 'none',
      position: { top: 8, left: 8, right: 8 },
      boundedBy: YANDEX_OBLAST_BOUNDS,
      strictBounds: false,
      useMapBounds: false,
      results: options.results ?? 10,
      noPopup: false,
      noPlacemark: true,
      noCentering: true,
      placeholderContent: options.placeholder ?? 'Поиск адреса или места',
    },
  });

  map.controls.add(searchControl);

  const onResultSelect = (event: any) => {
    const index = event.get('index');
    const currentRequestId = ++requestId;
    searchControl.getResult(index).then((geoObject: any) => {
      if (currentRequestId !== requestId) return;
      const parsed = parseSearchGeoObject(geoObject);
      if (!parsed || !isInsideServiceBounds(parsed.coords)) {
        options.onNotFound?.();
        return;
      }
      options.onSelect(parsed);
    });
  };

  searchControl.events.add('resultselect', onResultSelect);

  return () => {
    try {
      searchControl.events.remove('resultselect', onResultSelect);
      map.controls.remove(searchControl);
    } catch {
      /* уже уничтожен */
    }
  };
}
