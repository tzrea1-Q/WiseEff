/**
 * Prepare multi-line DTS property raw text for CST writeback.
 *
 * UI may strip board-file continuation indent for editing. Before splicing into
 * the source span, restore continuation-line indent from the original span (or
 * from the whitespace that precedes the span on its first line).
 *
 * Line 0 stays as-is: leading indent for the first value line usually lives
 * *outside* the property value span (between `=` and the span start).
 */
export function indentDtsRawValueForWriteback(
  newValue: string,
  source: string,
  spanStart: number,
  originalSpanText: string
): string {
  const normalized = newValue.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n").map((line) => line.replace(/[ \t]+$/g, ""));
  while (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  if (lines.length <= 1) {
    return lines[0] ?? "";
  }

  const continuationIndent = detectContinuationIndent(source, spanStart, originalSpanText);
  return lines
    .map((line, index) => {
      if (index === 0) return line.replace(/^[ \t]+/, "");
      if (line.trim() === "") return "";
      return `${continuationIndent}${line.replace(/^[ \t]+/, "")}`;
    })
    .join("\n");
}

function detectContinuationIndent(
  source: string,
  spanStart: number,
  originalSpanText: string
): string {
  const originalLines = originalSpanText.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  for (let index = 1; index < originalLines.length; index += 1) {
    const line = originalLines[index] ?? "";
    if (line.trim() === "") continue;
    const match = line.match(/^[ \t]+/);
    if (match) return match[0];
  }

  const before = source.slice(0, spanStart);
  const lastNewline = before.lastIndexOf("\n");
  const linePrefix = lastNewline === -1 ? before : before.slice(lastNewline + 1);
  const prefixMatch = linePrefix.match(/^[ \t]*/);
  if (prefixMatch && prefixMatch[0].length > 0) {
    return prefixMatch[0];
  }

  // New multi-line value with no prior indent cue: one tab deeper than the property line.
  const propertyLineStart = lastNewline === -1 ? 0 : lastNewline + 1;
  const propertyLine = source.slice(propertyLineStart, spanStart);
  const propertyIndent = propertyLine.match(/^[ \t]*/)?.[0] ?? "";
  return `${propertyIndent}\t`;
}
