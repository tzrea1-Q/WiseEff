import type { ParameterBindingValue } from "./types";

/**
 * Present DTS property raw text for UI (detail, editor, diff).
 * Source CST spans often keep board-file indentation (tabs/spaces after newlines);
 * strip per-line leading/trailing indent without changing token content.
 */
export function formatDtsRawValueForUi(raw: string | null | undefined): string {
  if (raw == null) return "";
  const normalized = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return normalized
    .split("\n")
    .map((line) => line.replace(/^[ \t]+/, "").replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/^\n+/, "")
    .replace(/\n+$/, "");
}

/** Empty raw DTS text is valid only when the parsed value explicitly has no literal. */
export function isDtsEmptyValueAllowed(value?: ParameterBindingValue | null): boolean {
  return value?.kind === "boolean" || value?.kind === "empty";
}

/** Display labels never flow back into the source editor or draft payload. */
export function formatDtsValueForUi(
  raw: string | null | undefined,
  value?: ParameterBindingValue | null,
  valueState?: "present" | "deleted" | null
): string {
  if (valueState === "deleted") return "已删除";
  const formatted = formatDtsRawValueForUi(raw);
  if (formatted) return formatted;
  if (value?.kind === "boolean") return "属性存在";
  if (value?.kind === "empty") return "空属性";
  return "未知";
}
