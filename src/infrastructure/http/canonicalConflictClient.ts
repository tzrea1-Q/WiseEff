import type { z } from "zod";
import {
  canonicalSourceConflictListResponseSchema,
  canonicalSourceConflictSubmitRequestSchema,
  canonicalSourceConflictSubmitResponseSchema
} from "@wiseeff/dto-schemas";
import { createApiClient } from "./apiClient";
import { createDefaultApiClient } from "./defaultApiClient";
import type { ManualSyncPreparation } from "./canonicalManualSyncClient";

export type CanonicalSourceConflictList = z.infer<typeof canonicalSourceConflictListResponseSchema>;
export type CanonicalSourceConflictSubmitInput = z.infer<typeof canonicalSourceConflictSubmitRequestSchema>;
export type CanonicalSourceConflictSubmitResult = z.infer<typeof canonicalSourceConflictSubmitResponseSchema>["item"];

export function canonicalBatchConflictReady(proof: ManualSyncPreparation,
  item: CanonicalSourceConflictList["items"][number]): boolean {
  const target = proof.targets.find((entry) => entry.bindingId === item.selectedBindingId);
  if (!target) return false;
  const file = item.choices.file;
  const draft = item.choices.draft;
  return file.choice === "file" && draft.choice === "draft"
    && file.action === target.action && file.targetText === target.afterText
    && file.selectedDraftProof === draft.selectedDraftProof
    && file.selectedDraftCandidateId === draft.selectedDraftCandidateId
    && file.selectedDraftCandidateDigest === draft.selectedDraftCandidateDigest
    && [file, draft].every((choice) => choice.candidateId === proof.candidateId
      && /^[0-9a-f]{64}$/.test(choice.decisionProofDigest)
      && choice.selectedBindingId === item.selectedBindingId
      && choice.selectedDraftId === item.selectedDraftId
      && choice.fileId === proof.fileId && choice.baseVersionId === proof.baseVersionId
      && choice.configSetId === proof.configSetId
      && choice.sourceProofToken === proof.proofToken
      && choice.cohortProofToken === proof.cohortProofToken
      && choice.sourceCandidateDigest === proof.proposedDigest
      && choice.selectedSourcePinId === target.sourcePinId
      && choice.selectedBaseValueId === target.baseCurrentValueId
      && choice.selectedRevisionId === target.configRevisionId
      && JSON.stringify(choice.members) === JSON.stringify(proof.members)
      && JSON.stringify(choice.cohort) === JSON.stringify(proof.cohort));
}

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
