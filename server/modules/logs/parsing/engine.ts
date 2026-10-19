import { compileFileGlob } from "../adminPattern";
import type { DecodedEvent, DecodedValue, DecodeCounts, DecodeTruncationReason, FieldSpec, ParsingSpec } from "./spec";
import { compileParsingPattern, MAX_PARSING_LINE_CHARS, MAX_PARSING_MATCH_CHARS, timestampFormat, registerCaseKey } from "./spec";
import { decodeRegister, exactInteger, integerValue, RegisterDecodeError } from "./registers";

export const MAX_DECODE_LINE_BYTES = 8192;
export const MAX_DECODE_EVENTS = 50_000;
export const MAX_DECODE_FIELD_BYTES = 4096;
export const DECODE_BATCH_LINES = 2000;
export const MAX_DECODE_EVENT_FIELDS = 1024;
export const MAX_DECODE_EVENT_BYTES = 32 * 1024;
export const MAX_DECODE_OUTPUT_FIELDS = 32_768;
export const MAX_DECODE_OUTPUT_BYTES = 4 * 1024 * 1024;
export type DecodeLogFile = { file: string; lines: readonly string[] };
export type DecodeResult = { events: DecodedEvent[]; counts: DecodeCounts; unmatchedLineCount: number; truncated?: boolean; reason?: DecodeTruncationReason };
export type DecodeInputFile = DecodeLogFile | { file: string; lineCount: number };
export type DecodeStep = DecodeResult & { readLine?: { fileIndex: number; lineNumber: number } };
const jsonBytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), "utf8");
const eventSizeError = { code: "event_size", message: `Decoded event exceeds ${MAX_DECODE_EVENT_BYTES} serialized bytes; fields were trimmed` };
const eventSizeReserve = jsonBytes({ errors: [eventSizeError] }) - 1;

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
    case "int": case "uint": case "hex": {
      const integer = integerValue(raw, spec.type === "hex");
      value = exactInteger(integer);
      if (typeof value === "string" && !spec.decode || spec.type !== "int" && integer < 0n) throw new Error("Integer outside safe range");
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
  let outputFields = 0, outputBytes = 0;
  const truncateOutput = (reason: "output_field_cap" | "output_byte_cap") => {
    result.truncated = counts.truncated = true;
    result.reason = counts.reason = reason;
    countError(reason);
  };
  const compiled = [];
  const mapCases = new Map<string, Map<string, string>>();
  for (const [id, map] of Object.entries(spec.registerMaps ?? {})) {
    const cases = new Map<string, string>();
    for (const [key, register] of Object.entries(map.cases)) { yield result; cases.set(registerCaseKey(key), register); }
    mapCases.set(id, cases);
  }
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
      function* emit(text: string, indices: number[], errorCode?: string): Generator<DecodeStep, void, string | undefined> {
        const match = errorCode === "match_input_cap" ? null : pattern.exec(text);
        if (!match && !errorCode) return;
        if (events.length >= maxEvents) { countError("event_cap"); return; }
        const event: DecodedEvent = { v: 1, source: "declarative", extractor: extractor.id, file, line: indices[0] + 1,
          ...(indices.length > 1 ? { endLine: indices.at(-1)! + 1 } : {}), fields: Object.create(null) };
        // Count encoded JSON fragments once, before retaining each scalar or bit field.
        // Reserving the event_size diagnostic keeps trimming itself inside the cap.
        let fieldCount = 0, eventBytes = jsonBytes(event) + 1, trimmed = false;
        const fitsRun = (fields: number, bytes: number) => {
          if (outputFields + fieldCount + fields > MAX_DECODE_OUTPUT_FIELDS) { truncateOutput("output_field_cap"); return false; }
          if (outputBytes + eventBytes + bytes > MAX_DECODE_OUTPUT_BYTES) { truncateOutput("output_byte_cap"); return false; }
          return true;
        };
        const error = (code: string, message: string, field?: string, force = false) => {
          const item = { code, message, ...(field ? { field } : {}) };
          const bytes = jsonBytes(item) + (event.errors?.length ? 1 : jsonBytes({ errors: [] }) - 1);
          if (eventBytes + bytes + (force ? 0 : eventSizeReserve) > MAX_DECODE_EVENT_BYTES) { trimmed = true; return; }
          if (!fitsRun(0, bytes)) return;
          (event.errors ??= []).push(item); eventBytes += bytes;
        };
        const retainField = (fields: Record<string, DecodedValue>, name: string, value: DecodedValue) => {
          const bytes = jsonBytes({ [name]: value }) - 2 + (Object.keys(fields).length ? 1 : 0);
          if (eventBytes + bytes + eventSizeReserve > MAX_DECODE_EVENT_BYTES) { trimmed = true; return false; }
          if (!fitsRun(1, bytes)) return false;
          fields[name] = value; fieldCount++; eventBytes += bytes; return true;
        };
        if (errorCode) error(errorCode, `Multiline assembly exceeded ${errorCode === "max_lines" ? "maxLines" : "the pattern input limit"}`);
        if (match) for (const [name, field] of Object.entries(extractor.fields)) {
          yield result;
          const raw = match.groups?.[name];
          try { if (raw == null) throw new Error("Group did not participate"); retainField(event.fields, name, decode(raw, field, timeFormats.get(name))); }
          catch (cause) { const message = cause instanceof Error ? cause.message : String(cause); error(message === "byte_cap" ? "byte_cap" : "invalid_field", message === "byte_cap" ? `Decoded bytes exceed ${MAX_DECODE_FIELD_BYTES} bytes` : message, name); }
          if (result.truncated) return;
        }
        if (match) for (const [name, field] of Object.entries(extractor.fields)) {
          if (!("decode" in field) || !field.decode || !Object.hasOwn(event.fields, name)) continue;
          try {
            let registerId: string | undefined;
            if ("register" in field.decode) registerId = field.decode.register;
            else {
              const id = field.decode.registerMap, map = spec.registerMaps![id], selector = event.fields[map.selectBy];
              // Always select from the scalar pass, independent of extractor field order.
              const selected = selector && typeof selector === "object" && "value" in selector ? selector.value : selector;
              registerId = mapCases.get(id)?.get(registerCaseKey(String(selected))) ?? map.default;
              if (!registerId) {
                const rawSelector = selector && typeof selector === "object" && "raw" in selector ? selector.raw : match.groups?.[map.selectBy] ?? String(selected);
                throw new RegisterDecodeError("unmatched_register", `No register case for ${map.selectBy}=${rawSelector} (map ${id})`);
              }
            }
            const register = spec.registers![registerId];
            const raw = match.groups![name], parent = event.fields[name];
            if (!parent || typeof parent !== "object" || !("raw" in parent)) continue;
            const children: Record<string, DecodedValue> = Object.create(null), bytes = jsonBytes({ fields: {} }) - 1;
            if (eventBytes + bytes + eventSizeReserve > MAX_DECODE_EVENT_BYTES) { trimmed = true; continue; }
            if (!fitsRun(0, bytes)) return;
            parent.fields = children; eventBytes += bytes;
            for (const child of decodeRegister(integerValue(raw, field.type === "hex"), register)) {
              yield result;
              if (fieldCount >= MAX_DECODE_EVENT_FIELDS) throw new RegisterDecodeError("field_cap", `Decoded event exceeds ${MAX_DECODE_EVENT_FIELDS} fields`);
              if (!retainField(children, child.name, child.value)) break;
            }
          } catch (cause) {
            error(cause instanceof RegisterDecodeError ? cause.code : "invalid_field", cause instanceof Error ? cause.message : String(cause), name);
          }
          if (result.truncated) return;
        }
        if (trimmed) error(eventSizeError.code, eventSizeError.message, undefined, true);
        if (result.truncated || !fitsRun(0, 0)) return;
        outputFields += fieldCount; outputBytes += jsonBytes(event) + 1;
        for (const i of indices) {
          const byte = i >>> 3, bit = 1 << (i & 7);
          if (!(matched[byte] & bit)) { matched[byte] |= bit; result.unmatchedLineCount--; }
        }
        events.push(event); counts.total++; counts.byExtractor[extractor.id]++;
        for (const item of event.errors ?? []) countError(item.code);
      }
      if (!start) {
        for (let i = 0; i < lineCount; i++) {
          const line = yield* readLine(i);
          if (!oversized.has(i)) yield* emit(line, [i]);
          if (result.truncated) return result;
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
          const previous = pending.get(key); if (previous) yield* emit(previous.text, previous.indices);
          if (result.truncated) return result;
          if (pending.size + events.length >= maxEvents && !pending.has(key)) { countError("event_cap"); continue; }
          pending.set(key, { text: "", indices: [] });
        }
        const group = pending.get(key); if (!group) continue;
        if (group.text.length + text.length + (group.indices.length ? 1 : 0) > MAX_PARSING_MATCH_CHARS) {
          yield* emit("", [...group.indices, i], "match_input_cap");
          if (result.truncated) return result;
          pending.delete(key); continue;
        }
        group.text += `${group.indices.length ? "\n" : ""}${text}`; group.indices.push(i);
        const exceeded = !ends && group.indices.length >= extractor.multiline!.maxLines ? "max_lines" : undefined;
        if (ends || exceeded) { yield* emit(group.text, group.indices, exceeded); pending.delete(key); }
        if (result.truncated) return result;
      }
      for (const group of pending.values()) {
        yield result;
        yield* emit(group.text, group.indices);
        if (result.truncated) return result;
      }
    }
  }
  return result;
}
