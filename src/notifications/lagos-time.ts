// Africa/Lagos is UTC+1 all year (no daylight saving), so plain arithmetic
// on UTC is exact. Every "day" of spec 0008 (grouping, cap, quiet hours,
// premium reminders) is a Lagos day.
const OFFSET_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * 60 * 60 * 1000;

const QUIET_START_HOUR = 22;
const QUIET_END_HOUR = 7;

function shifted(date: Date): Date {
  return new Date(date.getTime() + OFFSET_MS);
}

// YYYY-MM-DD of the Lagos day containing this instant.
export function lagosDay(date: Date): string {
  return shifted(date).toISOString().slice(0, 10);
}

export function lagosHour(date: Date): number {
  return shifted(date).getUTCHours();
}

// AC-9: content notifications wait between 22:00 and 07:00.
export function inQuietHours(date: Date): boolean {
  const hour = lagosHour(date);
  return hour >= QUIET_START_HOUR || hour < QUIET_END_HOUR;
}

// The next 07:00 Lagos strictly after this instant.
export function nextQuietEnd(date: Date): Date {
  const local = shifted(date);
  const sevenToday =
    Date.UTC(
      local.getUTCFullYear(),
      local.getUTCMonth(),
      local.getUTCDate(),
      QUIET_END_HOUR,
    ) - OFFSET_MS;
  return new Date(
    sevenToday > date.getTime() ? sevenToday : sevenToday + DAY_MS,
  );
}

// When a content notification created now may be pushed.
export function contentSendAfter(now: Date): Date {
  return inQuietHours(now) ? nextQuietEnd(now) : now;
}

// The UTC instants bounding the Lagos day `daysAhead` days after `date`'s day.
export function lagosDayRange(
  date: Date,
  daysAhead: number,
): { start: Date; end: Date } {
  const local = shifted(date);
  const start =
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) -
    OFFSET_MS +
    daysAhead * DAY_MS;
  return { start: new Date(start), end: new Date(start + DAY_MS) };
}

// dd/MM/yyyy in Lagos, for message texts.
export function formatLagosDate(date: Date): string {
  const [year, month, day] = lagosDay(date).split('-');
  return `${day}/${month}/${year}`;
}
