import { normalizeRow } from "./normalizeRow";
import type { ParsedImportRow } from "./types";
import type { DtsImportParseResult, ParseDtsImportInput } from "@/application/ports/ParameterRepository";

export type ParseDtsFullDeps = {
  parseDtsImport: (input: ParseDtsImportInput) => Promise<DtsImportParseResult>;
};

/**
 * Full `.dts` import rows come from the server CST parse endpoint (or mock).
 * Never silently fall back to `parseDtsFragmentImport`.
 */
export async function parseDtsFull(
  input: { sourceName?: string; content: string },
  deps: ParseDtsFullDeps
): Promise<ParsedImportRow[]> {
  const result = await deps.parseDtsImport({
    sourceName: input.sourceName?.trim() || "import.dts",
    content: input.content
  });

  const rows: ParsedImportRow[] = [];
  for (const item of result.rows) {
    const value = item.rawText !== "" ? item.rawText : item.normalizedValue;
    const row = normalizeRow(
      {
        name: item.name,
        module: item.module,
        currentValue: value,
        recommendedValue: value,
        rawSnippet: item.rawText,
        sourceLocation: item.sourceNodePath,
        parseWarnings: item.skipSuggested ? ["skip suggested by parser"] : undefined
      },
      "dts-full",
      item.sourceNodePath
    );
    if (row) {
      rows.push(row);
    }
  }
  return rows;
}
