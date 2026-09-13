/**
 * Publication job claim (CP-07-C).
 *
 * SKIP LOCKED is queue-only. The claim transaction increments fence, sets
 * running + lease, and commits. It must not hold the job row lock while
 * waiting on the reverse activation lock order.
 */
import type { Queryable } from "../../../shared/database/client";
import { claimNextJob } from "../persistence/store";
import type { ClaimNextJobInput, PublicationJobRecord } from "../persistence/types";
import type { CatalogPublicationStoreResult } from "../persistence/types";

export type ClaimPublicationJobInput = ClaimNextJobInput;

export async function claimPublicationJob(
  db: Queryable,
  input: ClaimPublicationJobInput,
): Promise<CatalogPublicationStoreResult<PublicationJobRecord>> {
  return claimNextJob(db, input);
}
