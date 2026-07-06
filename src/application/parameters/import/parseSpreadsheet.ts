import * as XLSX from "xlsx";
import { mapRowRecordToFields } from "./columnMap";
import { normalizeRow } from "./normalizeRow";
import type { ParsedImportRow } from "./types";

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function splitCsvLine(line: string): string[] {
  return line.split(",").map((value) => value.trim().replace(/^"|"$/g, ""));
}

function rowRecordFromHeaders(headers: string[], values: string[]): Record<string, string> {
  return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
}

function parseMappedSpreadsheetRow(
  record: Record<string, string>,
  sourceLocation: string
): ParsedImportRow | null {
  const mapped = mapRowRecordToFields(record);
  return normalizeRow(mapped, "spreadsheet", sourceLocation);
}

function parseCsvRows(text: string): ParsedImportRow[] {
  const lines = stripBom(text).split(/\r?\n/).filter((line) => line.trim());
  if (lines.length === 0) {
    return [];
  }

  const headers = splitCsvLine(lines[0]).map((header) => header.trim());
  return lines.slice(1).flatMap((line, index) => {
    const values = splitCsvLine(line);
    const row = parseMappedSpreadsheetRow(rowRecordFromHeaders(headers, values), `row:${index + 2}`);
    return row ? [row] : [];
  });
}

function parseXlsxRows(bytes: Uint8Array): ParsedImportRow[] {
  const workbook = XLSX.read(bytes, { type: "array" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    return [];
  }

  const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], {
    header: 1,
    defval: ""
  });
  if (rows.length === 0) {
    return [];
  }

  const headers = (rows[0] ?? []).map((cell) => String(cell ?? "").trim());
  return rows.slice(1).flatMap((cells, index) => {
    const values = (cells as unknown[]).map((cell) => String(cell ?? "").trim());
    const row = parseMappedSpreadsheetRow(rowRecordFromHeaders(headers, values), `row:${index + 2}`);
    return row ? [row] : [];
  });
}

export function parseSpreadsheetImport(input: {
  bytes?: Uint8Array;
  text?: string;
  fileName?: string;
}): ParsedImportRow[] {
  if (input.bytes) {
    return parseXlsxRows(input.bytes);
  }
  if (input.text) {
    return parseCsvRows(input.text);
  }
  return [];
}
