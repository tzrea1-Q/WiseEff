import { expect, it } from "vitest";
import { catalogBatchValueChangeRequestDtoSchema } from "./parameterCatalog";

it("retains exact submission and update times for the unified batch review queue", () => {
  const target = { ordinal: 0, draftId: null, decision: "file", bindingId: "binding-a", definitionId: "definition",
    definitionRevisionId: "revision", catalogReleaseId: "release", baseCurrentValueId: "old-value",
    configRevisionId: "config-revision", sourceRef: "source", sourcePinId: "pin", action: "set",
    targetValue: 4600, targetText: "4600", appliedValueId: null, appliedHistoryEventId: null,
    appliedSourcePinId: null, appliedFileVersionId: null };
  const response = catalogBatchValueChangeRequestDtoSchema.parse({
    id: "batch", projectId: "aurora", candidateId: "candidate", batchProofDigest: "a".repeat(64),
    cohortCount: 2, draftImpactDigest: null, uploadCandidateId: null, decisionProofDigest: null,
    compositionProof: null, draftImpact: null, status: "pending", reason: "校准电压",
    submitterUserId: "author", assignedToUserId: "reviewer", reviewerUserId: null, reviewerNote: null,
    sourceProofToken: "source-proof", cohortProofToken: "cohort-proof", fileId: "file", baseVersionId: "version",
    configSetId: "set", appliedAt: null, appliedAuditRef: null,
    targets: [target, { ...target, ordinal: 1, bindingId: "binding-b" }],
    createdAt: "2026-10-09T01:00:00.000Z", updatedAt: "2026-10-10T01:00:00.000Z"
  });
  expect(response).toMatchObject({ createdAt: "2026-10-09T01:00:00.000Z", updatedAt: "2026-10-10T01:00:00.000Z" });
});
