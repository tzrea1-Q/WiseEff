import type { Queryable } from "../../shared/database/client";
import { parseDts, resolveDts } from "../dts";
import { derivedParsedIndexFromResolved } from "./parseIndex";
import type { ParsedIndex } from "./types";
import { replaceDtsStructuralModel, type StructuralInsertCounts } from "./structuralRepository";

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
