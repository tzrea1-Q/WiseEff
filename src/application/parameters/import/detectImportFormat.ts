import { parseDtsFragmentImport } from "./parseDtsFragment";
import { parseDtsFull, type ParseDtsFullDeps } from "./parseDtsFull";
import { parseJsonImport } from "./parseJson";
import { parseSpreadsheetImport } from "./parseSpreadsheet";
import type { ImportSourceFormat, ParsedImportRow } from "./types";

export type DetectImportFormatInput = {
  fileName?: string;
  bytes?: Uint8Array;
  text?: string;
};

export type ParseImportSourceOptions = {
  /** Required when format resolves to dts-full — never uses fragment fallback. */
  parseDtsFullDeps?: ParseDtsFullDeps;
};

/**
 * Formats recognized as parameter project sources but not importable in this round.
 * They must be refused explicitly — never silently parsed as a spreadsheet.
 */
export type DeferredImportSourceFormat = "yaml" | "toml" | "env";

export type ImportFormatDecision =
  | { supported: true; format: ImportSourceFormat }
  | { supported: false; format: DeferredImportSourceFormat };

const DEFERRED_FORMAT_LABELS: Record<DeferredImportSourceFormat, string> = {
  yaml: "YAML",
  toml: "TOML",
  env: "ENV"
};

/** Raised when the chosen source is a recognized-but-deferred project-source format. */
export class UnsupportedImportFormatError extends Error {
  constructor(
    public readonly format: DeferredImportSourceFormat,
    public readonly fileName?: string
  ) {
    super(
      `暂不支持 ${DEFERRED_FORMAT_LABELS[format]} 格式的参数文件导入，请改用 xlsx、csv、json、dts 或 dtsi 文件。`
    );
    this.name = "UnsupportedImportFormatError";
  }
}

const DEFERRED_EXTENSION_FORMATS: Record<string, DeferredImportSourceFormat> = {
  ".yaml": "yaml",
  ".yml": "yaml",
  ".toml": "toml",
  ".env": "env"
};

function isXlsxSpreadsheet(input: DetectImportFormatInput): boolean {
  if (
    input.bytes &&
    input.bytes.length >= 2 &&
    input.bytes[0] === 0x50 &&
    input.bytes[1] === 0x4b
  ) {
    return true;
  }
  return input.fileName?.toLowerCase().endsWith(".xlsx") ?? false;
}

function isDtsFull(input: DetectImportFormatInput): boolean {
  const lowerName = input.fileName?.toLowerCase() ?? "";
  if (lowerName.endsWith(".dts") || lowerName.endsWith(".dtsi")) {
    return true;
  }
  const text = input.text ?? "";
  return text.includes("/dts-v1/") || text.includes("/{");
}

function isJson(input: DetectImportFormatInput): boolean {
  const text = input.text?.trim();
  if (!text || (!text.startsWith("[") && !text.startsWith("{"))) {
    return false;
  }
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

function contentLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#") && !line.startsWith("//"));
}

/** Every line is `key: value` (or a `- key: value` list item): YAML, not CSV-shaped data. */
function isYamlLike(text: string): boolean {
  const lines = contentLines(text);
  return lines.length > 0 && lines.every((line) => /^(?:-\s+)?[A-Za-z_][\w.-]*\s*:(?:\s|$)/.test(line));
}

/** At least one `[section]` header and every line a header or `key = value`: TOML. */
function isTomlLike(text: string): boolean {
  const lines = contentLines(text);
  const sectionPattern = /^\[[^\]\r\n]+\]$/;
  return (
    lines.some((line) => sectionPattern.test(line)) &&
    lines.every((line) => sectionPattern.test(line) || /^[A-Za-z_][\w.-]*\s*=/.test(line))
  );
}

/** Every line is `KEY=value` (optionally `export KEY=value`): dotenv, not CSV-shaped data. */
function isEnvLike(text: string): boolean {
  const lines = contentLines(text);
  return lines.length > 0 && lines.every((line) => /^(?:export\s+)?[A-Z][A-Z0-9_]*\s*=/.test(line));
}

function deferredFormatFromFileName(fileName: string | undefined): DeferredImportSourceFormat | null {
  const lowerName = fileName?.toLowerCase() ?? "";
  for (const [extension, format] of Object.entries(DEFERRED_EXTENSION_FORMATS)) {
    if (lowerName.endsWith(extension)) {
      return format;
    }
  }
  return null;
}

/**
 * The deferred format this input names or clearly contains, or `null`. File-name evidence
 * always wins: a `.yaml`/`.toml`/`.env` source must never fall through to the spreadsheet parser.
 */
export function detectDeferredImportSourceFormat(
  input: DetectImportFormatInput
): DeferredImportSourceFormat | null {
  return deferredFormatFromFileName(input.fileName) ?? sniffDeferredFormatFromContent(input);
}

/**
 * Conservative content sniffing for pasted input (which carries a placeholder file name).
 * Requires *every* line to fit the dialect so ordinary CSV never matches.
 */
function sniffDeferredFormatFromContent(input: DetectImportFormatInput): DeferredImportSourceFormat | null {
  if (isXlsxSpreadsheet(input) || isDtsFull(input) || isJson(input)) {
    return null;
  }
  const text = input.text ?? "";
  if (!text.trim()) {
    return null;
  }
  if (isTomlLike(text)) return "toml";
  if (isEnvLike(text)) return "env";
  if (isYamlLike(text)) return "yaml";
  return null;
}

export function decideImportFormat(input: DetectImportFormatInput): ImportFormatDecision {
  const namedDeferred = deferredFormatFromFileName(input.fileName);
  if (namedDeferred) {
    return { supported: false, format: namedDeferred };
  }
  if (isXlsxSpreadsheet(input)) {
    return { supported: true, format: "spreadsheet" };
  }
  if (isDtsFull(input)) {
    return { supported: true, format: "dts-full" };
  }
  if (isJson(input)) {
    return { supported: true, format: "json" };
  }
  const sniffedDeferred = sniffDeferredFormatFromContent(input);
  if (sniffedDeferred) {
    return { supported: false, format: sniffedDeferred };
  }
  return { supported: true, format: "spreadsheet" };
}

/** `"unsupported"` marks a recognized-but-deferred project source (e.g. YAML/TOML/ENV). */
export function detectImportFormat(input: DetectImportFormatInput): ImportSourceFormat | "unsupported" {
  const decision = decideImportFormat(input);
  return decision.supported ? decision.format : "unsupported";
}

export async function parseImportSource(
  input: DetectImportFormatInput,
  options: ParseImportSourceOptions = {}
): Promise<ParsedImportRow[]> {
  const decision = decideImportFormat(input);
  if (!decision.supported) {
    throw new UnsupportedImportFormatError(decision.format, input.fileName);
  }

  switch (decision.format) {
    case "json":
      return parseJsonImport(input.text ?? "");
    case "dts-full": {
      if (!options.parseDtsFullDeps) {
        throw new Error("完整 DTS 解析需要服务端 parse-dts（或 mock），请通过 parseDtsFullDeps 提供。");
      }
      return parseDtsFull(
        { sourceName: input.fileName, content: input.text ?? "" },
        options.parseDtsFullDeps
      );
    }
    case "dts-fragment":
      return parseDtsFragmentImport(input.text ?? "");
    case "spreadsheet":
    default:
      return parseSpreadsheetImport(input);
  }
}
