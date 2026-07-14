import type { Queryable } from "../../shared/database/client";
import { parseDts, resolveDts } from "../dts";
import type { ParsedIndex } from "./types";
import { replaceDtsStructuralModel, type StructuralInsertCounts } from "./structuralRepository";

export function derivedParsedIndexFromResolved(resolved: ReturnType<typeof resolveDts>): ParsedIndex {
  const index: ParsedIndex = {};
  for (const node of resolved.nodes) {
    for (const prop of node.properties) {
      const key = node.nodePath ? `${node.nodePath}/${prop.name}` : prop.name;
      index[key] = { value: prop.normalizedValue };
    }
  }
  return index;
}

export async function ingestDtsFileVersion(
  db: Queryable,
  fileVersionId: string,
  source: string,
): Promise<{ parsedIndex: ParsedIndex; counts: StructuralInsertCounts }> {
  const doc = parseDts(source);
  const resolved = resolveDts(doc);
  const counts = await replaceDtsStructuralModel(db, fileVersionId, resolved);
  const parsedIndex = derivedParsedIndexFromResolved(resolved);
  return { parsedIndex, counts };
}
