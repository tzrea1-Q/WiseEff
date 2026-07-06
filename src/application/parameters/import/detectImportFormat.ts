import { parseDtsFragmentImport } from "./parseDtsFragment";
import { parseJsonImport } from "./parseJson";
import { parseSpreadsheetImport } from "./parseSpreadsheet";
import type { ImportSourceFormat, ParsedImportRow } from "./types";

export type DetectImportFormatInput = {
  fileName?: string;
  bytes?: Uint8Array;
  text?: string;
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

export function detectImportFormat(input: DetectImportFormatInput): ImportSourceFormat {
  if (isXlsxSpreadsheet(input)) {
    return "spreadsheet";
  }
  if (isDtsFull(input)) {
    return "dts-full";
  }
  if (isJson(input)) {
    return "json";
  }
  return "spreadsheet";
}

export function parseImportSource(input: DetectImportFormatInput): ParsedImportRow[] {
  const format = detectImportFormat(input);
  switch (format) {
    case "json":
      return parseJsonImport(input.text ?? "");
    case "dts-full":
    case "dts-fragment":
      return parseDtsFragmentImport(input.text ?? "");
    case "spreadsheet":
    default:
      return parseSpreadsheetImport(input);
  }
}
