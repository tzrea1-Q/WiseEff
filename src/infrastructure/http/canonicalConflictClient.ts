import type { z } from "zod";
import {
  canonicalSourceConflictListResponseSchema,
  canonicalSourceConflictSubmitRequestSchema,
  canonicalSourceConflictSubmitResponseSchema
} from "@wiseeff/dto-schemas";
import { createApiClient } from "./apiClient";
import { createDefaultApiClient } from "./defaultApiClient";

export type CanonicalSourceConflictList = z.infer<typeof canonicalSourceConflictListResponseSchema>;
export type CanonicalSourceConflictSubmitInput = z.infer<typeof canonicalSourceConflictSubmitRequestSchema>;
export type CanonicalSourceConflictSubmitResult = z.infer<typeof canonicalSourceConflictSubmitResponseSchema>["item"];

export function createCanonicalConflictClient(client: ReturnType<typeof createApiClient> = createDefaultApiClient()) {
  const candidate = (projectId: string, candidateId: string) =>
    `/api/v1/projects/${encodeURIComponent(projectId)}/parameter-file-candidates/${encodeURIComponent(candidateId)}`;
  return {
    async listCandidateSourceConflicts(projectId: string, candidateId: string): Promise<CanonicalSourceConflictList> {
      return canonicalSourceConflictListResponseSchema.parse(await client.get(`${candidate(projectId, candidateId)}/source-conflicts`));
    },
    async submitCandidateSourceConflict(projectId: string, candidateId: string,
      input: CanonicalSourceConflictSubmitInput): Promise<CanonicalSourceConflictSubmitResult> {
      return canonicalSourceConflictSubmitResponseSchema.parse(await client.post(
        `${candidate(projectId, candidateId)}/source-conflict-submit`, input
      )).item;
    }
  };
}
