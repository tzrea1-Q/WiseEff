import { describe, expect, it, vi } from "vitest";
import { createCanonicalBatchRollbackClient } from "./canonicalBatchRollbackClient";

const digest = "a".repeat(64);
const prepared = {
  kind: "canonical-source-batch", organizationId: "org", projectId: "project/1",
  candidateId: "candidate", fileId: "file/1", format: "json", baseVersionId: "current",
  configSetId: "set", baseDigest: digest, proposedDigest: digest,
  cohortProofToken: "workflow", proofToken: "candidate-proof", batchProofDigest: digest,
  members: [{ memberId: "member", fileId: "file/1", fileVersionId: "current", sourceName: "config.json",
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
  historicalVersionId: "history", historicalDigest: digest, historicalSizeBytes: 1,
  expectedCurrentVersionId: "current", expectedWorkflowProofToken: "workflow", replayed: false
};

describe("canonical batch rollback HTTP client", () => {
  it("uses the exact C routes and caller-owned request IDs for prepare and submit", async () => {
    const raw = vi.fn().mockResolvedValueOnce({ json: async () => ({ item: prepared }) })
      .mockResolvedValueOnce({ json: async () => ({ item: { candidateId: "candidate", requestId: "request",
        status: "pending", batchProofDigest: digest, replayed: false } }) });
    const client = createCanonicalBatchRollbackClient({ raw } as never);
    const input = { versionId: "history", expectedCurrentVersionId: "current",
      expectedWorkflowProofToken: "workflow" };
    expect((await client.prepare("project/1", "file/1", input, "prepare-key")).targets).toHaveLength(2);
    expect((await client.submit("project/1", "file/1", {
      ...input, candidateId: "candidate", expectedCandidateProofToken: "candidate-proof",
      expectedBatchProofDigest: digest, reason: "restore", assignedToUserId: "reviewer"
    }, "submit-key")).requestId).toBe("request");
    expect(raw.mock.calls.map(([path, init]) => ({ path, method: init.method,
      requestId: init.headers["X-Request-Id"], body: JSON.parse(init.body) }))).toEqual([
      { path: "/api/v1/projects/project%2F1/parameter-files/file%2F1/source-batch-rollback/prepare",
        method: "POST", requestId: "prepare-key", body: input },
      { path: "/api/v1/projects/project%2F1/parameter-files/file%2F1/source-batch-rollback/submit",
        method: "POST", requestId: "submit-key", body: {
          ...input, candidateId: "candidate", expectedCandidateProofToken: "candidate-proof",
          expectedBatchProofDigest: digest, reason: "restore", assignedToUserId: "reviewer"
        } }
    ]);
  });
});
