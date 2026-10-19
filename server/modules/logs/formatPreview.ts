import { MAX_EXTRACTOR_PREVIEW_BYTES, MAX_EXTRACTOR_PREVIEW_LINES } from "./parsing/extractorBuilder";
import { MAX_PARSING_LINE_CHARS } from "./parsing/spec";
import { formatPreviewRequestSchema, validateLogFormatProfile } from "./formatProfile";
import { parseLogText } from "./parser";
import { createLogPatternCache } from "./adminPattern";

/** Uses the runtime parser unchanged, with multiline disabled only for the per-line annotations. */
export function previewLogFormat(value: { sampleText: string; formatProfile?: unknown }) {
  const input = formatPreviewRequestSchema.parse(value);
  if (Buffer.byteLength(input.sampleText, "utf8") > MAX_EXTRACTOR_PREVIEW_BYTES) throw new Error("Format sample exceeds 1 MiB UTF-8");
  const rawLines = input.sampleText.split(/\r\n|\n|\r/);
  if (rawLines.at(-1) === "") rawLines.pop();
  if (rawLines.length > MAX_EXTRACTOR_PREVIEW_LINES || rawLines.some((text) => text.length > MAX_PARSING_LINE_CHARS)) throw new Error("Format preview allows at most 500 lines of 6144 UTF-16 code units each");
  const patternCache = createLogPatternCache();
  const validated = validateLogFormatProfile(input.formatProfile, patternCache);
  if (!validated.ok) throw new Error(validated.issues.join("; "));
  const { multiline: _multiline, ...singleLineProfile } = validated.profile;
  const log = { fileName: "sample.log", content: input.sampleText };
  const grouped = parseLogText(log, { profile: validated.profile, patternCache });
  const single = parseLogText(log, { profile: singleLineProfile, patternCache });
  if (!grouped.ok) throw new Error(grouped.reason);
  if (!single.ok) throw new Error(single.reason);
  const byLine = new Map(single.entries.map((entry) => [entry.lineNumber, entry]));
  return {
    lines: grouped.rawLines.map((text, index) => ({ line: index + 1, text, timestamp: byLine.get(index + 1)?.timestamp, severity: byLine.get(index + 1)?.severity ?? "info" as const })),
    entries: grouped.entries.map((entry, index) => ({
      lineNumbers: grouped.rawLines.slice(entry.lineNumber - 1, grouped.entries[index + 1] ? grouped.entries[index + 1].lineNumber - 1 : undefined)
        .flatMap((text, offset) => text.trim() ? [entry.lineNumber + offset] : []),
      text: entry.message, timestamp: entry.timestamp, severity: entry.severity
    }))
  };
}
