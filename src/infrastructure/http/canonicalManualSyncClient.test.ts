import { describe, expect, it, vi } from "vitest";
import { createCanonicalManualSyncClient } from "./canonicalManualSyncClient";
import { canonicalManualSyncPrepareResponseSchema } from "@wiseeff/dto-schemas";

const digest = "a".repeat(64);
const prepared = {
  kind: "canonical-source-batch", organizationId: "org", projectId: "project/1",
  candidateId: "candidate", fileId: "file/1", format: "json", baseVersionId: "current",
  configSetId: "set", baseDigest: digest, proposedDigest: "b".repeat(64),
  cohortProofToken: "workflow", proofToken: "candidate-proof", batchProofDigest: digest,
  members: [{ memberId: "member", fileId: "file/1", fileVersionId: "current", sourceName: "source.json",
    format: "json", role: "base", sortOrder: 0, checksum: "checksum", sizeBytes: 1,
    configSetId: "set", isCandidateFile: true }],
  cohort: ["a", "b"].map((bindingId) => ({ bindingId, oldValueId: `old-${bindingId}`,
    sourcePinId: `pin-${bindingId}`, sourceOccurrenceId: `occurrence-${bindingId}`,
    definitionId: "definition", effectiveRevisionId: "revision", catalogReleaseId: "release",
    locator: { pointer: `/${bindingId}` }, valueKind: "number", valueDigest: digest, configSetId: "set" })),
  targets: ["a", "b"].map((bindingId) => ({ bindingId, definitionId: "definition",
    baseCurrentValueId: `old-${bindingId}`, configRevisionId: "revision",
    sourcePinId: `pin-${bindingId}`, locator: { pointer: `/${bindingId}` },
    baseDigest: digest, proposedDigest: digest, action: "set", beforeText: "1", afterText: "2" })),
  replayed: false
};

describe("canonical manual sync HTTP client", () => {
  it("keeps the single alternative closed and preserves batch target cardinality and parsing", () => {
    const { batchProofDigest: _batch, ...base } = prepared;
    const single = { ...base, kind: "canonical-source-single", configRevisionId: "revision",
      targets: [base.targets[0]], before: "before", after: "after" };
    expect(canonicalManualSyncPrepareResponseSchema.safeParse({ item: single }).success).toBe(true);
    for (const item of [{ ...single, targets: base.targets }, { ...single, targets: [] },
      { ...single, cohort: [] }, { ...single, configRevisionId: undefined },
      { ...single, batchProofDigest: digest }, { ...single, kind: "caller-single" },
      { ...prepared, targets: [prepared.targets[0]] }]) {
      expect(canonicalManualSyncPrepareResponseSchema.safeParse({ item }).success, JSON.stringify(item)).toBe(false);
    }
    expect(canonicalManualSyncPrepareResponseSchema.parse({ item: { ...prepared, before: "unknown" } }).item).toEqual(prepared);
  });
  it("accepts one target with a full sibling cohort and submits the frozen single body", async () => {
    const { batchProofDigest: _batch, ...base } = prepared;
    const single = { ...base, kind: "canonical-source-single", configRevisionId: "revision",
      targets: [base.targets[0]], cohort: [...base.cohort, { ...base.cohort[1]!, bindingId: "c" }],
      before: "before", after: "after" };
    const raw = vi.fn().mockResolvedValueOnce({ json: async () => ({ item: single }) })
      .mockResolvedValue({ json: async () => ({ item: { requestId: "single-request", status: "pending", replayed: false } }) });
    const client = createCanonicalManualSyncClient({ raw } as never);
    expect((await client.prepare("project/1", "file/1", { contentBase64: "e30=",
      expectedCurrentVersionId: "current", expectedWorkflowProofToken: "workflow" }, "prepare-single")).kind)
      .toBe("canonical-source-single");
    const body = { expectedCurrentVersionId: "current", expectedProofToken: "candidate-proof",
      expectedWorkflowProofToken: "workflow", reason: "single", assignedToUserId: "reviewer" };
    expect(await client.submitSingle("project/1", "candidate/1", body, "submit-single"))
      .toMatchObject({ requestId: "single-request" });
    expect(raw.mock.calls[1]?.[0]).toBe("/api/v1/projects/project%2F1/parameter-file-candidates/candidate%2F1/source-submit");
    expect(raw.mock.calls[1]?.[1].headers["X-Request-Id"]).toBe("submit-single");
    expect(JSON.parse(raw.mock.calls[1]?.[1].body)).toEqual(body);
  });
  it("uses C prepare and v2 batch submit DTOs with distinct caller-owned X-Request-Id values", async () => {
    const raw = vi.fn().mockResolvedValueOnce({ json: async () => ({ item: prepared }) })
      .mockResolvedValueOnce({ json: async () => ({ item: {
        id: "request", projectId: "project/1", candidateId: "candidate", status: "pending",
        batchProofDigest: digest, cohortCount: 2, reason: "review",
        draftImpactDigest: digest, draftImpact: ["a", "b"].map((bindingId, ordinal) => ({
          ordinal, bindingId, role: "target", decision: "file",
          baseCurrentValueId: `old-${bindingId}`, sourcePinId: `pin-${bindingId}`,
          configRevisionId: "revision", drafts: []
        })), uploadCandidateId: null,
        decisionProofDigest: null, compositionProof: null,
        submitterUserId: "author", assignedToUserId: "reviewer", reviewerUserId: null,
        reviewerNote: null, sourceProofToken: "candidate-proof", cohortProofToken: "workflow",
        fileId: "file/1", baseVersionId: "current", configSetId: "set",
        appliedAt: null, appliedAuditRef: null,
        targets: ["a", "b"].map((bindingId, ordinal) => ({
          ordinal, draftId: null, decision: "file", bindingId, definitionId: "definition",
          definitionRevisionId: "revision", catalogReleaseId: "release",
          baseCurrentValueId: `old-${bindingId}`, configRevisionId: "revision",
          sourceRef: `/${bindingId}`, sourcePinId: `pin-${bindingId}`, action: "set",
          targetText: "2", appliedValueId: null, appliedHistoryEventId: null,
          appliedSourcePinId: null, appliedFileVersionId: null
        }))
      } }) });
    const client = createCanonicalManualSyncClient({ raw } as never);
    const input = { contentBase64: "e30=", expectedCurrentVersionId: "current",
      expectedWorkflowProofToken: "workflow" };
    expect((await client.prepare("project/1", "file/1", input, "prepare-key")).targets).toHaveLength(2);
    expect((await client.submit("project/1", { candidateId: "candidate", expectedProofToken: "candidate-proof",
      reason: "review", assignedToUserId: "reviewer", targetDecisions: ["a", "b"].map((bindingId) => ({
        bindingId, choice: "file" as const,
        ...(bindingId === "a" ? { expectedConflictProofs: [
          { draftId: "draft-a", decisionProofDigest: digest }
        ] } : {})
      })) }, "submit-key")).id).toBe("request");
    expect(raw.mock.calls.map(([path, init]) => ({ path, requestId: init.headers["X-Request-Id"],
      body: JSON.parse(init.body) }))).toEqual([
      { path: "/api/v1/projects/project%2F1/parameter-files/file%2F1/source-manual-sync/prepare",
        requestId: "prepare-key", body: input },
      { path: "/api/v2/projects/project%2F1/parameter-value-change-requests/batches",
        requestId: "submit-key", body: { candidateId: "candidate", expectedProofToken: "candidate-proof",
          reason: "review", assignedToUserId: "reviewer",
          targetDecisions: ["a", "b"].map((bindingId) => ({ bindingId, choice: "file",
            ...(bindingId === "a" ? { expectedConflictProofs: [
              { draftId: "draft-a", decisionProofDigest: digest }
            ] } : {}) })) } }
    ]);
  });
});
