import type { Queryable } from "../../shared/database/client";
import { dtsSearchResponseSchema, type DtsSearchBy } from "./schemas";
import { searchDtsStructuralModel, type DtsSearchResultDto } from "./dtsSearchRepository";

export type SearchProjectDtsInput = {
  organizationId: string;
  projectId: string;
  q: string;
  by: DtsSearchBy;
};

/** Project-scoped DTS structured search over dts_* tables only. */
export async function searchProjectDts(
  db: Queryable,
  input: SearchProjectDtsInput,
): Promise<DtsSearchResultDto> {
  const result = await searchDtsStructuralModel(db, input);
  return dtsSearchResponseSchema.parse(result);
}
