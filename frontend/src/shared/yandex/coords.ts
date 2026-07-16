/** Формат «47.125778, 51.923010» — как в Яндекс.Картах при копировании координат. */

export function formatLatLonPair(lat: number, lon: number): string {
  return `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
}

export function parseLatLonPair(value: string): { lat: number; lon: number } | null {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;

  const parts = trimmed.split(/[,\s;]+/).filter(Boolean);
  if (parts.length !== 2) return null;

  const lat = parseFloat(parts[0].replace(',', '.'));
  const lon = parseFloat(parts[1].replace(',', '.'));
  if (Number.isNaN(lat) || Number.isNaN(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;

  return { lat, lon };
}
