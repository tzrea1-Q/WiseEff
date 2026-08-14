import { formatRelativeOrAbsolute } from "./formatDateTime";

/**
 * Presenter for the user-governance "last active" column. The API returns an
 * ISO timestamp (or null mapped to "never" by the client), while legacy mock
 * data carries English relative strings ("just now", "2h ago", "today 09:12").
 * Timestamps go through the shared datetime formatter; known legacy strings
 * map to product Chinese; already-formatted Chinese passes through; unknown
 * strings render as "未知".
 */

const LEGACY_EXACT_LABELS: Record<string, string> = {
  never: "从未",
  "just now": "刚刚",
  yesterday: "昨天",
  today: "今天",
  disabled: "已停用"
};

const TIMESTAMP_LIKE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;
const AGO_PATTERN = /^(\d+)\s*(m|h|d)\s+ago$/i;
const TODAY_TIME_PATTERN = /^today\s+(\d{1,2}:\d{2})$/i;
const YESTERDAY_TIME_PATTERN = /^yesterday\s+(\d{1,2}:\d{2})$/i;
const CHINESE_FORMATTED =
  /^(从未|刚刚|昨天|今天|已停用)$|^\d+ 分钟前$|^\d+ 小时前$|^\d+ 天前$|^今天 \d{1,2}:\d{2}$|^昨天 \d{1,2}:\d{2}$|^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;

const AGO_UNIT_LABELS: Record<string, string> = {
  m: "分钟前",
  h: "小时前",
  d: "天前"
};

/** Normalize ISO or Postgres text timestamps for parsing. Returns null when not timestamp-shaped. */
export function normalizeTimestampInput(value: string): string | null {
  const trimmed = value.trim();
  if (!TIMESTAMP_LIKE.test(trimmed)) {
    return null;
  }

  let normalized = trimmed.includes("T") ? trimmed : trimmed.replace(" ", "T");
  normalized = normalized.replace(/([+-]\d{2})$/, "$1:00");

  const date = new Date(normalized);
  return Number.isFinite(date.getTime()) ? normalized : null;
}

export function formatLastActive(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return value;
  }

  const exact = LEGACY_EXACT_LABELS[trimmed.toLowerCase()];
  if (exact) {
    return exact;
  }

  const ago = trimmed.match(AGO_PATTERN);
  if (ago) {
    return `${ago[1]} ${AGO_UNIT_LABELS[ago[2].toLowerCase()]}`;
  }

  const todayTime = trimmed.match(TODAY_TIME_PATTERN);
  if (todayTime) {
    return `今天 ${todayTime[1]}`;
  }

  const yesterdayTime = trimmed.match(YESTERDAY_TIME_PATTERN);
  if (yesterdayTime) {
    return `昨天 ${yesterdayTime[1]}`;
  }

  if (CHINESE_FORMATTED.test(trimmed)) {
    return trimmed;
  }

  const normalized = normalizeTimestampInput(trimmed);
  if (normalized) {
    return formatRelativeOrAbsolute(normalized);
  }

  return "未知";
}
