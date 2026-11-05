/**
 * Rental dates (R2): all date logic of rentals runs in the salon time zone.
 * A rental day turns over at noon: an item booked 14 → 16 is busy from the
 * 14th 12:00 to the 16th 12:00, so the next customer may take it on the 16th,
 * and a return after 12:00 counts one more day.
 */
export const RENTAL_TIME_ZONE = 'Asia/Tashkent';
export const RENTAL_DAY_BOUNDARY_HOUR = 12;

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

const formatter = new Intl.DateTimeFormat('en-US', {
  timeZone: RENTAL_TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function localParts(date: Date): LocalParts {
  const parts: Record<string, number> = {};
  for (const p of formatter.formatToParts(date)) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value);
  }
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

/** Day number of a local calendar date (days since epoch), for day differences. */
function dayNumber(p: { year: number; month: number; day: number }): number {
  return Math.round(Date.UTC(p.year, p.month - 1, p.day) / DAY_MS);
}

/** `YYYY-MM-DD` in the salon time zone. */
export function toLocalDate(date: Date): string {
  const p = localParts(date);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/**
 * Instant of `hour:00` on a local calendar date (`YYYY-MM-DD`).
 * Throws on a malformed date.
 */
export function localDateAt(date: string, hour: number): Date {
  const m = DATE_ONLY.exec(date);
  if (!m) throw new Error(`Invalid date, expected YYYY-MM-DD: ${date}`);
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const wallClock = Date.UTC(year, month - 1, day, hour);
  // Local wall clock as if it were UTC, minus the zone offset at that instant
  const p = localParts(new Date(wallClock));
  const offset =
    Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) -
    wallClock;
  const result = new Date(wallClock - offset);
  if (toLocalDate(result) !== date) {
    throw new Error(`Invalid date: ${date}`);
  }
  return result;
}

/** Start/end of a booking: noon of the local date. */
export function rentalBoundary(date: string): Date {
  return localDateAt(date, RENTAL_DAY_BOUNDARY_HOUR);
}

/** Calendar days between two instants, by local dates. */
export function calendarDaysBetween(from: Date, to: Date): number {
  return dayNumber(localParts(to)) - dayNumber(localParts(from));
}

/**
 * Days to charge from `start` to the return moment: calendar days, plus one
 * when the return is after 12:00 local time; at least 1.
 * 14th → 16th 11:00 (or 12:00 sharp) = 2 days, 16th 15:00 = 3 days.
 */
export function rentalDays(start: Date, returnedAt: Date): number {
  const p = localParts(returnedAt);
  const afterNoon =
    p.hour > RENTAL_DAY_BOUNDARY_HOUR ||
    (p.hour === RENTAL_DAY_BOUNDARY_HOUR && (p.minute > 0 || p.second > 0));
  return Math.max(
    1,
    calendarDaysBetween(start, returnedAt) + (afterNoon ? 1 : 0),
  );
}

/** Days a booking is priced for: the end date counts as a return before noon. */
export function plannedDays(startDate: Date, endDate: Date): number {
  return Math.max(1, calendarDaysBetween(startDate, endDate));
}

/** `instant` + whole days (Asia/Tashkent has no DST, a day is always 24h). */
export function addDaysToInstant(instant: Date, days: number): Date {
  return new Date(instant.getTime() + days * DAY_MS);
}

/** Local `YYYY-MM-DD` of today. */
export function todayLocalDate(now: Date = new Date()): string {
  return toLocalDate(now);
}

/** Adds whole days to a local date string. */
export function addLocalDays(date: string, days: number): string {
  const m = DATE_ONLY.exec(date);
  if (!m) throw new Error(`Invalid date, expected YYYY-MM-DD: ${date}`);
  const d = new Date(
    Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) + days * DAY_MS,
  );
  return d.toISOString().slice(0, 10);
}
