import type { ParameterRecord } from "@/mockData";
import type { ParsedImportRow, ReviewedImportRow } from "./types";

function buildMatchKey(name: string, module: string): string {
  return `${name}::${module}`;
}

function findExistingParameter(
  name: string,
  module: string,
  parameters: ParameterRecord[],
  projectId: string
): ParameterRecord | undefined {
  const matches = parameters.filter(
    (parameter) => parameter.name === name && parameter.module === module
  );
  if (matches.length === 0) {
    return undefined;
  }
  return matches.find((parameter) => parameter.projectId === projectId) ?? matches[0];
}

export function matchToLibrary(
  rows: ParsedImportRow[],
  parameters: ParameterRecord[],
  projectId: string
): ReviewedImportRow[] {
  const matchKeyCounts = new Map<string, number>();
  for (const row of rows) {
    const matchKey = buildMatchKey(row.name, row.module);
    matchKeyCounts.set(matchKey, (matchKeyCounts.get(matchKey) ?? 0) + 1);
  }

  return rows.map((row, index) => {
    const matchKey = buildMatchKey(row.name, row.module);
    const duplicateInBatch = (matchKeyCounts.get(matchKey) ?? 0) > 1;

    if (duplicateInBatch) {
      return {
        ...row,
        rowId: `import-row-${index + 1}`,
        matchKey,
        status: "conflict" as const
      };
    }

    if (!row.module.trim()) {
      return {
        ...row,
        rowId: `import-row-${index + 1}`,
        matchKey,
        status: "needs-module" as const
      };
    }

    const existingParameter = findExistingParameter(row.name, row.module, parameters, projectId);

    return {
      ...row,
      rowId: `import-row-${index + 1}`,
      matchKey,
      status: "pending" as const,
      ...(existingParameter ? { existingParameter } : {})
    };
  });
}
