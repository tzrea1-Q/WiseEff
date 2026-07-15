import type { Queryable } from "../../shared/database/client";
import { structuralReadResponseSchema } from "./schemas";
import { readDtsStructuralModel, type StructuralReadResult } from "./structuralReadRepository";

/** Read structured DTS model for a file version from dts_* tables only. */
export async function getParameterFileVersionStructure(
  db: Queryable,
  fileVersionId: string,
): Promise<StructuralReadResult> {
  const result = await readDtsStructuralModel(db, fileVersionId);
  return structuralReadResponseSchema.parse(result);
}
