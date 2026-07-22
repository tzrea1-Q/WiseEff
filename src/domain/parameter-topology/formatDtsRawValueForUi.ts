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
