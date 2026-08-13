import { formatRelativeOrAbsolute } from "./formatDateTime";

/**
 * Presenter for the user-governance "last active" column. The API returns an
 * ISO timestamp (or null mapped to "never" by the client), while legacy mock
 * data carries English relative strings ("just now", "2h ago", "today 09:12").
 * ISO input goes through the shared datetime formatter; known legacy strings
 * map to product Chinese; unknown strings pass through unchanged.
 */

const LEGACY_EXACT_LABELS: Record<string, string> = {
  never: "从未",
  "just now": "刚刚",
  yesterday: "昨天",
  today: "今天",
  disabled: "已停用"
};

const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const AGO_PATTERN = /^(\d+)\s*(m|h|d)\s+ago$/i;
const TODAY_TIME_PATTERN = /^today\s+(\d{1,2}:\d{2})$/i;
const YESTERDAY_TIME_PATTERN = /^yesterday\s+(\d{1,2}:\d{2})$/i;

const AGO_UNIT_LABELS: Record<string, string> = {
  m: "分钟前",
  h: "小时前",
  d: "天前"
};

export function formatLastActive(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return value;
  }

  if (ISO_PATTERN.test(trimmed)) {
    return formatRelativeOrAbsolute(trimmed);
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

  return value;
}
