import { describe, expect, it, vi } from "vitest";
import { createCanonicalConflictClient } from "./canonicalConflictClient";

describe("createCanonicalConflictClient", () => {
  it("keeps caller-owned request identity for the selected single conflict", async () => {
    const raw = vi.fn().mockResolvedValue({ json: async () => ({ item: {
      requestId: "selected-request", status: "pending", replayed: false
    } }) });
    const client = createCanonicalConflictClient({ raw } as never);
    const input = { selectedBindingId: "binding", selectedDraftId: "selected", choice: "draft" as const,
      expectedDecisionProofDigest: "a".repeat(64), reason: "selected reason", assignedToUserId: "reviewer" };
    await client.submitCandidateSourceConflict("project", "candidate", input, "frozen-id");
    expect(raw.mock.calls[0]?.[1].headers["X-Request-Id"]).toBe("frozen-id");
    expect(JSON.parse(raw.mock.calls[0]?.[1].body)).toEqual(input);
  });
  it("uses C's single-conflict discovery and submission routes", async () => {
    const get = vi.fn().mockResolvedValue({ items: [], ineligible: [] });
    const post = vi.fn().mockResolvedValue({ item: { requestId: "request-1", status: "pending", replayed: true } });
    const client = createCanonicalConflictClient({ get, post } as never);
    await expect(client.listCandidateSourceConflicts("project/1", "candidate/1")).resolves.toEqual({ items: [], ineligible: [] });
    await expect(client.submitCandidateSourceConflict("project/1", "candidate/1", {
      selectedBindingId: "binding-1", selectedDraftId: "draft-1", choice: "file",
      expectedDecisionProofDigest: "a".repeat(64), reason: "选择文件值", assignedToUserId: "reviewer-1"
    })).resolves.toMatchObject({ requestId: "request-1", replayed: true });
    expect(get).toHaveBeenCalledWith("/api/v1/projects/project%2F1/parameter-file-candidates/candidate%2F1/source-conflicts");
    expect(post).toHaveBeenCalledWith("/api/v1/projects/project%2F1/parameter-file-candidates/candidate%2F1/source-conflict-submit",
      expect.objectContaining({ choice: "file", expectedDecisionProofDigest: "a".repeat(64) }));
  });
});
