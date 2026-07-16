const ATYRAU_TZ = "Asia/Atyrau";

/** Завтрашняя календарная дата YYYY-MM-DD в зоне Asia/Atyrau */
export function getTomorrowDateInAtyrau(): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: ATYRAU_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const tomorrow = new Date(Date.now() + 86400000);
  return formatter.format(tomorrow);
}

/** Сегодня YYYY-MM-DD в зоне Asia/Atyrau */
export function getTodayDateInAtyrau(): string {
  return formatAtyrauDate(new Date());
}

/** YYYY-MM-DD для даты в зоне Asia/Atyrau */
export function formatAtyrauDate(date: Date): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: ATYRAU_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(date);
}

const WEEKDAY_OFFSET: Record<string, number> = {
  Monday: 0,
  Tuesday: 1,
  Wednesday: 2,
  Thursday: 3,
  Friday: 4,
  Saturday: 5,
  Sunday: 6,
};

function atyrauWeekdayOffset(dateStr: string): number {
  const anchor = new Date(`${dateStr}T12:00:00+05:00`);
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: ATYRAU_TZ,
    weekday: "long",
  }).format(anchor);
  return WEEKDAY_OFFSET[weekday] ?? 0;
}

/** Календарная неделя пн–вс (Asia/Atyrau) для якорной даты YYYY-MM-DD */
export function getWeekRange(dateStr: string): { from: Date; to: Date } {
  const offset = atyrauWeekdayOffset(dateStr);
  const anchor = new Date(`${dateStr}T12:00:00+05:00`);
  const monday = new Date(anchor.getTime() - offset * 86400000);
  const sunday = new Date(monday.getTime() + 6 * 86400000);
  const from = new Date(`${formatAtyrauDate(monday)}T00:00:00+05:00`);
  const to = new Date(`${formatAtyrauDate(sunday)}T23:59:59.999+05:00`);
  return { from, to };
}

/** Один календарный день (Asia/Atyrau) */
export function getDayRange(dateStr: string): { from: Date; to: Date } {
  const from = new Date(`${dateStr}T00:00:00+05:00`);
  const to = new Date(`${dateStr}T23:59:59.999+05:00`);
  return { from, to };
}

/** ISO-время подачи из даты и времени формы (Asia/Atyrau, +05:00). */
export function buildAtyrauPickupDate(date: string, time: string): Date {
  return new Date(`${date}T${time}:00+05:00`);
}

/** Сообщение об ошибке или null, если дата/время допустимы. */
export function validatePickupDateTime(date: string, time: string): string | null {
  if (!date || !time) {
    return "Укажите дату и время поездки";
  }
  const pickupMs = buildAtyrauPickupDate(date, time).getTime();
  if (Number.isNaN(pickupMs)) {
    return "Некорректная дата или время поездки";
  }
  return null;
}
