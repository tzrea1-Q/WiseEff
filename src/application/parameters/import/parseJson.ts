import { mapRowRecordToFields } from "./columnMap";
import { normalizeRow } from "./normalizeRow";
import type { ParsedImportRow } from "./types";

function extractJsonRows(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) {
    return parsed;
  }
  if (parsed && typeof parsed === "object" && Array.isArray((parsed as { items?: unknown }).items)) {
    return (parsed as { items: unknown[] }).items;
  }
  return [];
}

export function parseJsonImport(source: string): ParsedImportRow[] {
  const parsed = JSON.parse(source.trim());
  return extractJsonRows(parsed)
    .map((row, index) => {
      if (!row || typeof row !== "object") {
        return null;
      }
      const record = Object.fromEntries(
        Object.entries(row as Record<string, unknown>).map(([key, value]) => [key, String(value ?? "")])
      );
      const mapped = mapRowRecordToFields(record);
      return normalizeRow(mapped, "json", `json:${index + 1}`);
    })
    .filter((row): row is ParsedImportRow => row !== null);
}
