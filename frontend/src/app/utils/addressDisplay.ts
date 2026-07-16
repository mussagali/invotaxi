/** Формат адреса как в экспорте/распределении: улица (объект). */
export function formatOrderAddressDisplay(
  objectName?: string | null,
  title?: string | null,
): string {
  const obj = (objectName || '').trim();
  const addr = (title || '').trim();
  if (addr && obj && obj.toLowerCase() !== addr.toLowerCase()) {
    return `${addr} (${obj})`;
  }
  return addr || obj;
}

/** Расстояние между двумя точками в метрах (Haversine). */
export function distanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const r = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(a));
}
