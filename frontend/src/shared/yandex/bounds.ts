/**
 * Границы поиска адресов для Яндекс.Карт.
 *
 * Источник истины по области — backend/orders/geocoding_service.py (ATYRAU_REGION_BOUNDS).
 * Городская застройка — backend/orders/management/commands/atyrau_poi_catalog.py (ATYRAU_CITY_BOUNDS).
 * Dart-зеркало: invo_common/lib/yandex_service_bounds.dart.
 */

/** Город по умолчанию: добавляется как префикс к поисковым запросам. */
export const YANDEX_CITY_NAME = 'Атырау';

/** Название области для сообщений и нормализации. */
export const YANDEX_OBLAST_NAME = 'Атырауская область';

/**
 * Городская застройка Атырау — приоритет геокодирования внутри области.
 * SW [lat, lon], NE [lat, lon].
 */
export const YANDEX_CITY_BOUNDS: number[][] = [
  [47.055, 51.835],
  [47.17, 51.96],
];

/**
 * Атырауская область — границы поиска (SuggestView, SearchControl, Geosuggest)
 * и проверки координат. SW [lat, lon], NE [lat, lon].
 */
export const YANDEX_OBLAST_BOUNDS: number[][] = [
  [45.5, 48.5],
  [49.5, 55.0],
];

/** Алиас для обратной совместимости. */
export const YANDEX_SERVICE_BOUNDS = YANDEX_OBLAST_BOUNDS;

/** Центр карты по умолчанию (город Атырау). */
export const ATYRAU_MAP_CENTER: [number, number] = [
  (YANDEX_CITY_BOUNDS[0][0] + YANDEX_CITY_BOUNDS[1][0]) / 2,
  (YANDEX_CITY_BOUNDS[0][1] + YANDEX_CITY_BOUNDS[1][1]) / 2,
];

