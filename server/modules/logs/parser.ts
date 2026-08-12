import { extname } from "node:path";
import { TextDecoder } from "node:util";

import type { LogFormatProfile } from "./formatProfile";
import { supportedLogExtensions } from "./status";

export type ParsedLogSeverity = "error" | "warn" | "info";

export type ParsedLogEntry = {
  lineNumber: number;
  timestamp?: string;
  severity: ParsedLogSeverity;
  message: string;
  tokens: Record<string, string>;
};

export type ParseLogTextInput = {
  fileName: string;
  content: Buffer | Uint8Array | string;
};

export type ParseLogTextOptions = {
  /** Declarative log-domain format profile; absent = generic parsing (uncategorized log domain). */
  profile?: LogFormatProfile;
};

export type ParseResult =
  | { ok: true; rawLines: string[]; entries: ParsedLogEntry[] }
  | { ok: false; reason: string };

const supportedExtensions = new Set<string>(supportedLogExtensions);
const isoishTimestampPattern = /^\d{4}-\d{2}-\d{2}(?:T[^\s]+| \d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)/;
const keyValuePattern = /(?:^|\s)([A-Za-z_][A-Za-z0-9_.-]*)=("[^"]*"|'[^']*'|\S+)/g;

export function parseLogText(input: ParseLogTextInput, options: ParseLogTextOptions = {}): ParseResult {
  const extension = extname(input.fileName).toLowerCase();

  if (!supportedExtensions.has(extension)) {
    return {
      ok: false,
      reason: `Unsupported log format. Supported extensions: ${supportedLogExtensions.join(", ")}.`
    };
  }

  const decoded = decodeUtf8(input.content);
  if (!decoded.ok) {
    return decoded;
  }

  const rawLines = decoded.text.split(/\r\n|\n|\r/);
  const profile = options.profile;
  const entries = profile ? parseEntriesWithProfile(rawLines, profile) : parseEntriesGeneric(rawLines);

  return { ok: true, rawLines, entries };
}

function parseEntriesGeneric(rawLines: string[]): ParsedLogEntry[] {
  return rawLines.flatMap((rawLine, index) => {
    const trimmedLine = rawLine.trim();
    if (trimmedLine.length === 0) {
      return [];
    }

    return [parseLine(trimmedLine, index + 1)];
  });
}

function parseEntriesWithProfile(rawLines: string[], profile: LogFormatProfile): ParsedLogEntry[] {
  const timestampRegex = compileProfileRegex(profile.timestampPattern);
  const startRegex = compileProfileRegex(profile.multiline?.startPattern);
  const severityMatchers = compileSeverityMatchers(profile);
  const entries: ParsedLogEntry[] = [];

  for (const [index, rawLine] of rawLines.entries()) {
    const trimmedLine = rawLine.trim();
    if (trimmedLine.length === 0) {
      continue;
    }

    const previous = entries[entries.length - 1];
    if (previous && isContinuationLine(rawLine, profile, startRegex)) {
      // Multi-line merge keeps the entry anchored on its original start line; raw
      // line numbers stay stable so evidence citations always resolve.
      previous.message = `${previous.message}\n${trimmedLine}`;
      Object.assign(previous.tokens, parseTokens(trimmedLine));
      continue;
    }

    entries.push(parseLineWithProfile(trimmedLine, index + 1, { timestampRegex, severityMatchers }));
  }

  return entries;
}

function compileProfileRegex(pattern: string | undefined): RegExp | undefined {
  if (!pattern) {
    return undefined;
  }
  try {
    return new RegExp(pattern);
  } catch {
    // Stored profiles are validated on save; an uncompilable pattern degrades to generic behavior.
    return undefined;
  }
}

type SeverityMatchers = Array<{ severity: ParsedLogSeverity; regexes: RegExp[] }>;

function compileSeverityMatchers(profile: LogFormatProfile): SeverityMatchers {
  const matchers: SeverityMatchers = [];
  for (const severity of ["error", "warn", "info"] as const) {
    const regexes = (profile.severityMap?.[severity] ?? [])
      .map((pattern) => compileProfileRegex(pattern))
      .filter((regex): regex is RegExp => regex !== undefined);
    if (regexes.length > 0) {
      matchers.push({ severity, regexes });
    }
  }
  return matchers;
}

function isContinuationLine(rawLine: string, profile: LogFormatProfile, startRegex: RegExp | undefined): boolean {
  const multiline = profile.multiline;
  if (!multiline) {
    return false;
  }
  if (multiline.mode === "indent") {
    return /^\s/.test(rawLine);
  }
  return startRegex ? !startRegex.test(rawLine) : false;
}

function parseLineWithProfile(
  line: string,
  lineNumber: number,
  compiled: { timestampRegex: RegExp | undefined; severityMatchers: SeverityMatchers }
): ParsedLogEntry {
  let timestamp: string | undefined;
  let messageStart = line;

  if (compiled.timestampRegex) {
    const match = line.match(compiled.timestampRegex);
    if (match && match.index === 0) {
      timestamp = match[1] ?? match[0];
      messageStart = line.slice(match[0].length).trimStart();
    }
  } else {
    const fallbackMatch = line.match(isoishTimestampPattern);
    timestamp = fallbackMatch?.[0];
    messageStart = timestamp ? line.slice(timestamp.length).trimStart() : line;
  }

  return {
    lineNumber,
    timestamp,
    severity: parseSeverityWithProfile(line, compiled.severityMatchers),
    message: messageStart,
    tokens: parseTokens(line)
  };
}

function parseSeverityWithProfile(line: string, matchers: SeverityMatchers): ParsedLogSeverity {
  for (const { severity, regexes } of matchers) {
    if (regexes.some((regex) => regex.test(line))) {
      return severity;
    }
  }
  return parseSeverity(line);
}

function decodeUtf8(content: ParseLogTextInput["content"]): { ok: true; text: string } | { ok: false; reason: string } {
  if (typeof content === "string") {
    return decodeUtf8Bytes(Buffer.from(content, "utf8"));
  }

  const bytes = content instanceof Buffer ? content : Buffer.from(content);
  return decodeUtf8Bytes(bytes);
}

function decodeUtf8Bytes(bytes: Buffer): { ok: true; text: string } | { ok: false; reason: string } {
  if (bytes.length > 0) {
    const nullBytes = bytes.reduce((count, byte) => count + (byte === 0x00 ? 1 : 0), 0);
    if (nullBytes / bytes.length > 0.05) {
      return { ok: false, reason: "Input appears to be binary or null-byte-heavy content, not a UTF-8 text log." };
    }
  }

  try {
    return { ok: true, text: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
  } catch {
    return { ok: false, reason: "Unable to decode log content as valid UTF-8 text." };
  }
}

function parseLine(line: string, lineNumber: number): ParsedLogEntry {
  const timestampMatch = line.match(isoishTimestampPattern);
  const timestamp = timestampMatch?.[0];
  const messageStart = timestamp ? line.slice(timestamp.length).trimStart() : line;

  return {
    lineNumber,
    timestamp,
    severity: parseSeverity(line),
    message: messageStart,
    tokens: parseTokens(line)
  };
}

function parseSeverity(line: string): ParsedLogSeverity {
  const upperLine = line.toUpperCase();
  if (/\b(ERROR|ERR)\b/.test(upperLine)) {
    return "error";
  }
  if (/\b(WARN|WARNING)\b/.test(upperLine)) {
    return "warn";
  }
  if (/\bINFO\b/.test(upperLine)) {
    return "info";
  }

  return "info";
}

function parseTokens(line: string): Record<string, string> {
  const tokens: Record<string, string> = {};

  for (const match of line.matchAll(keyValuePattern)) {
    const key = match[1];
    const rawValue = match[2];
    tokens[key] = stripSurroundingQuotes(rawValue);
  }

  return tokens;
}

function stripSurroundingQuotes(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }

  return value;
}
