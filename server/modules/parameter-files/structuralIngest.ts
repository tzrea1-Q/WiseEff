import type { Queryable } from "../../shared/database/client";
import { parseDts, resolveDts } from "../dts";
import { derivedParsedIndexFromResolved } from "./parseIndex";
import type { ParsedIndex } from "./types";
import { replaceDtsStructuralModel, type StructuralInsertCounts } from "./structuralRepository";

export async function ingestDtsFileVersion(
  db: Queryable,
  fileVersionId: string,
  source: string,
  preparedDocument?: ReturnType<typeof parseDts>,
  /** Actual node paths proven by complete configuration resolution, never guessed anchors. */
  configNodePaths?: ReadonlySet<string>,
): Promise<{ parsedIndex: ParsedIndex; counts: StructuralInsertCounts }> {
  const doc = preparedDocument ?? parseDts(source);
  const resolved = resolveDts(doc, configNodePaths);
  const counts = await replaceDtsStructuralModel(db, fileVersionId, resolved, source);
  const parsedIndex = derivedParsedIndexFromResolved(resolved);
  return { parsedIndex, counts };
}
