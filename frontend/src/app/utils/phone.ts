/**
 * Нормализует номер телефона для сравнения (только цифры).
 * Используется для проверки точного совпадения пассажира по номеру.
 */
export function normalizePhoneDigits(phone: string): string {
  if (!phone || typeof phone !== 'string') return '';
  return phone.replace(/\D/g, '');
}
