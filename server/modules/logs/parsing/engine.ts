import { compileFileGlob } from "../adminPattern";
import type { DecodedEvent, DecodedValue, DecodeCounts, FieldSpec, ParsingSpec } from "./spec";
import { compileParsingPattern, MAX_PARSING_LINE_CHARS, MAX_PARSING_MATCH_CHARS, timestampFormat } from "./spec";

export const MAX_DECODE_LINE_BYTES = 8192;
export const MAX_DECODE_EVENTS = 50_000;
export const MAX_DECODE_FIELD_BYTES = 4096;
export const DECODE_BATCH_LINES = 2000;
export type DecodeLogFile = { file: string; lines: readonly string[] };
export type DecodeResult = { events: DecodedEvent[]; counts: DecodeCounts; unmatchedLineCount: number };
export type DecodeInputFile = DecodeLogFile | { file: string; lineCount: number };
export type DecodeStep = DecodeResult & { readLine?: { fileIndex: number; lineNumber: number } };

function timestamp(raw: string, { names, pattern }: ReturnType<typeof timestampFormat>): string {
  const match = pattern.exec(raw);
  if (!match) throw new Error("Timestamp does not match format");
  const parts = Object.fromEntries(names.map((name, i) => [name, match[i + 1]]));
  const year = Number(parts.Y ?? 1970), month = Number(parts.m ?? 1), day = Number(parts.d ?? 1);
  const hour = Number(parts.H ?? 0), minute = Number(parts.M ?? 0), second = Number(parts.S ?? 0);
  const date = new Date(0); date.setUTCFullYear(year, month - 1, day); date.setUTCHours(hour, minute, second, Number((parts.f ?? "").padEnd(3, "0").slice(0, 3)));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day || hour > 23 || minute > 59 || second > 59) throw new Error("Invalid calendar timestamp");
  if (parts.z && parts.z !== "Z") {
    const zone = parts.z.replace(":", ""), hours = Number(zone.slice(1, 3)), minutes = Number(zone.slice(3));
    if (hours > 23 || minutes > 59) throw new Error("Invalid timezone offset");
    date.setTime(date.getTime() - (zone[0] === "+" ? 1 : -1) * (hours * 60 + minutes) * 60_000);
  }
  return date.toISOString();
}

function decode(raw: string, spec: FieldSpec, timeFormat?: ReturnType<typeof timestampFormat>): DecodedValue {
  let value: DecodedValue;
  switch (spec.type) {
    case "string": return raw;
    case "int": case "uint": {
      if (!/^[+-]?(?:\d+|0x[\da-f]+|0b[01]+)$/i.test(raw)) throw new Error("Invalid integer");
      const sign = raw[0] === "-" ? -1 : 1, digits = raw.replace(/^[+-]/, "");
      value = sign * Number(digits);
      if (!Number.isSafeInteger(value) || spec.type === "uint" && value < 0) throw new Error("Integer outside safe range");
      break;
    }
    case "float":
      if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(raw) || !Number.isFinite(Number(raw))) throw new Error("Invalid float");
      value = Number(raw); break;
    case "bool":
      if (!/^(true|false|1|0|yes|no|on|off)$/i.test(raw)) throw new Error("Invalid boolean");
      value = /^(true|1|yes|on)$/i.test(raw); break;
    case "enum":
      if (!Object.hasOwn(spec.values, raw)) throw new Error("Unknown enum value");
      value = spec.values[raw]; break;
    case "timestamp": value = timestamp(raw, timeFormat!); break;
    case "hexbytes": case "base64bytes": {
      const hex = spec.type === "hexbytes";
      const encoded = hex ? raw.replace(/\s/g, "") : raw;
      if (!(hex ? /^(?:[\da-f]{2})*$/i : /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/).test(encoded)) throw new Error("Invalid byte encoding");
      const length = hex ? encoded.length / 2 : encoded.length / 4 * 3 - (encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0);
      if (length > MAX_DECODE_FIELD_BYTES) throw new Error("byte_cap");
      const bytes = Buffer.from(encoded, hex ? "hex" : "base64");
      if (!hex && bytes.toString("base64") !== raw) throw new Error("Noncanonical base64");
      value = { hex: bytes.toString("hex"), length }; break;
    }
  }
  return { raw, value };
}

/** Pure deterministic decoder. All limits produce errors, never partial/truncated matches. */
export function decodeLogFiles(spec: ParsingSpec, files: DecodeLogFile[], maxEvents = MAX_DECODE_EVENTS): DecodeResult {
  const steps = decodeLogFilesSteps(spec, files, maxEvents);
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
}

/** Resumable pure engine: checkpoints retain assembly state and expose completed events only. */
export function* decodeLogFilesSteps(spec: ParsingSpec, files: DecodeInputFile[], maxEvents = MAX_DECODE_EVENTS): Generator<DecodeStep, DecodeResult, string | undefined> {
  if (!Number.isSafeInteger(maxEvents) || maxEvents < 1) throw new Error("Decode event limit must be a positive safe integer");
  const events: DecodedEvent[] = [];
  const counts: DecodeCounts = { total: 0, byExtractor: Object.fromEntries(spec.extractors.map((e) => [e.id, 0])), errors: {} };
  const result: DecodeResult = { events, counts, unmatchedLineCount: files.reduce((sum, file) => sum + ("lines" in file ? file.lines.length : file.lineCount), 0) };
  const countError = (code: string) => { counts.errors[code] = (counts.errors[code] ?? 0) + 1; };
  const compiled = [];
  for (const extractor of spec.extractors) {
    yield result;
    compiled.push({ extractor, pattern: compileParsingPattern(extractor.pattern, "s", MAX_PARSING_MATCH_CHARS),
    timeFormats: new Map(Object.entries(extractor.fields).flatMap(([name, field]) => field.type === "timestamp" ? [[name, timestampFormat(field.format)] as const] : [])),
    globs: extractor.files?.map(compileFileGlob), start: extractor.multiline && compileParsingPattern(extractor.multiline.start),
    next: extractor.multiline?.continue ? compileParsingPattern(extractor.multiline.continue) : undefined,
    end: extractor.multiline?.end ? compileParsingPattern(extractor.multiline.end) : undefined });
  }
  for (const [fileIndex, input] of files.entries()) {
    const { file } = input;
    const lineCount = "lines" in input ? input.lines.length : input.lineCount;
    function* readLine(index: number): Generator<DecodeStep, string, string | undefined> {
      if ("lines" in input) { yield result; return input.lines[index]; }
      const line = yield { ...result, readLine: { fileIndex, lineNumber: index + 1 } };
      if (line === undefined) throw new Error("Streaming decoder requires a line");
      return line;
    }
    yield result; // File selection is bounded too, including files with no applicable extractor.
    const applicable = compiled.filter(({ globs }) => !globs || globs.some((glob) => glob.test(file)));
    if (!applicable.length) continue;
    const matched = new Uint8Array(Math.ceil(lineCount / 8));
    const oversized = new Set<number>();
    for (let i = 0; i < lineCount; i++) {
      const line = yield* readLine(i);
      if (Buffer.byteLength(line, "utf8") > MAX_DECODE_LINE_BYTES) { oversized.add(i); countError("line_cap"); }
      else if (line.length > MAX_PARSING_LINE_CHARS) { oversized.add(i); countError("match_input_cap"); }
    }
    for (const { extractor, pattern, start, next, end, timeFormats } of applicable) {
      const emit = (text: string, indices: number[], errorCode?: string) => {
        const match = errorCode === "match_input_cap" ? null : pattern.exec(text);
        if (!match && !errorCode) return;
        if (events.length >= maxEvents) { countError("event_cap"); return; }
        const event: DecodedEvent = { v: 1, source: "declarative", extractor: extractor.id, file, line: indices[0] + 1,
          ...(indices.length > 1 ? { endLine: indices.at(-1)! + 1 } : {}), fields: Object.create(null) };
        const error = (code: string, message: string, field?: string) => { (event.errors ??= []).push({ code, message, ...(field ? { field } : {}) }); countError(code); };
        if (errorCode) error(errorCode, `Multiline assembly exceeded ${errorCode === "max_lines" ? "maxLines" : "the pattern input limit"}`);
        if (match) for (const [name, field] of Object.entries(extractor.fields)) {
          const raw = match.groups?.[name];
          try { if (raw == null) throw new Error("Group did not participate"); event.fields[name] = decode(raw, field, timeFormats.get(name)); }
          catch (cause) { const message = cause instanceof Error ? cause.message : String(cause); error(message === "byte_cap" ? "byte_cap" : "invalid_field", message === "byte_cap" ? `Decoded bytes exceed ${MAX_DECODE_FIELD_BYTES} bytes` : message, name); }
        }
        for (const i of indices) {
          const byte = i >>> 3, bit = 1 << (i & 7);
          if (!(matched[byte] & bit)) { matched[byte] |= bit; result.unmatchedLineCount--; }
        }
        events.push(event); counts.total++; counts.byExtractor[extractor.id]++;
      };
      if (!start) {
        for (let i = 0; i < lineCount; i++) {
          const line = yield* readLine(i);
          if (!oversized.has(i)) emit(line, [i]);
        }
        continue;
      }
      const pending = new Map<string, { text: string; indices: number[] }>();
      for (let i = 0; i < lineCount; i++) {
        const text = yield* readLine(i);
        if (oversized.has(i)) { pending.clear(); continue; }
        const starts = start.exec(text), ends = end?.exec(text), continues = next?.exec(text);
        const control = starts ?? ends ?? continues;
        if (!control && (next || extractor.multiline!.keyField)) continue;
        const key = extractor.multiline!.keyField ? control?.groups?.[extractor.multiline!.keyField] : "";
        if (key == null) continue;
        if (starts) {
          const previous = pending.get(key); if (previous) emit(previous.text, previous.indices);
          if (pending.size + events.length >= maxEvents && !pending.has(key)) { countError("event_cap"); continue; }
          pending.set(key, { text: "", indices: [] });
        }
        const group = pending.get(key); if (!group) continue;
        if (group.text.length + text.length + (group.indices.length ? 1 : 0) > MAX_PARSING_MATCH_CHARS) {
          emit("", [...group.indices, i], "match_input_cap"); pending.delete(key); continue;
        }
        group.text += `${group.indices.length ? "\n" : ""}${text}`; group.indices.push(i);
        const exceeded = !ends && group.indices.length >= extractor.multiline!.maxLines ? "max_lines" : undefined;
        if (ends || exceeded) { emit(group.text, group.indices, exceeded); pending.delete(key); }
      }
      for (const group of pending.values()) {
        yield result;
        emit(group.text, group.indices);
      }
    }
  }
  return result;
}
