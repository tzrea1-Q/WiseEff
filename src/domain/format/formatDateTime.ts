/**
 * Shared datetime formatter mandated by the design system (§Content and
 * Language): relative wording within 7 days, absolute "YYYY-MM-DD HH:mm"
 * beyond, and a precise absolute form for tooltips. Invalid input falls back
 * to the original string so legacy display values pass through untouched.
 */

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const RELATIVE_WINDOW_MS = 7 * DAY_MS;

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function parseDate(iso: string): Date | null {
  if (typeof iso !== "string" || !iso.trim()) {
    return null;
  }
  const date = new Date(iso);
  return Number.isFinite(date.getTime()) ? date : null;
}

function formatDatePart(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatTimePart(date: Date) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Calendar-day difference (local timezone): 0 = same day, 1 = yesterday. */
function calendarDaysAgo(date: Date, now: Date) {
  const startOf = (input: Date) => new Date(input.getFullYear(), input.getMonth(), input.getDate()).getTime();
  return Math.round((startOf(now) - startOf(date)) / DAY_MS);
}

/**
 * Relative within 7 days ("3 分钟前", "2 小时前", "昨天 14:30", "3 天前"),
 * absolute "2026-08-05 12:52" beyond. Invalid input returns the input as-is.
 */
export function formatRelativeOrAbsolute(iso: string, now: Date = new Date()): string {
  const date = parseDate(iso);
  if (!date) {
    return iso;
  }

  const elapsed = now.getTime() - date.getTime();
  // Future timestamps (clock skew) render absolute except within one minute.
  if (elapsed < -MINUTE_MS || elapsed >= RELATIVE_WINDOW_MS) {
    return `${formatDatePart(date)} ${formatTimePart(date)}`;
  }
  if (elapsed < MINUTE_MS) {
    return "刚刚";
  }
  if (elapsed < HOUR_MS) {
    return `${Math.floor(elapsed / MINUTE_MS)} 分钟前`;
  }

  const daysAgo = calendarDaysAgo(date, now);
  if (daysAgo <= 0) {
    return `${Math.floor(elapsed / HOUR_MS)} 小时前`;
  }
  if (daysAgo === 1) {
    return `昨天 ${formatTimePart(date)}`;
  }
  return `${daysAgo} 天前`;
}

/** Full precise timestamp for tooltips: "2026-08-05 12:52:49". Invalid input returns the input as-is. */
export function formatAbsolute(iso: string): string {
  const date = parseDate(iso);
  if (!date) {
    return iso;
  }
  return `${formatDatePart(date)} ${formatTimePart(date)}:${pad(date.getSeconds())}`;
}
