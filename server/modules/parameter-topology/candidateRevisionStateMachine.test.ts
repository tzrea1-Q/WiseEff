import { describe, expect, it } from "vitest";

import {
  assertCanPromoteCandidateToDraft,
  CANDIDATE_NEVER_PROMOTE_FROM,
  CANDIDATE_TRANSITION_TABLE,
  evaluateCandidateSemanticGate,
  isCandidateTransitionAllowed,
} from "./candidateRevisionStateMachine";

describe("candidateRevisionStateMachine transition table", () => {
  it("encodes promote-after-gates only from resolved → draft", () => {
    const promoteRows = CANDIDATE_TRANSITION_TABLE.filter(
      (row) => row.event === "promote-after-gates" && row.to === "draft",
    );
    expect(promoteRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: "resolved", to: "draft", allowed: true }),
        expect.objectContaining({ from: "needs_mapping", to: "draft", allowed: false }),
        expect.objectContaining({ from: "invalid", to: "draft", allowed: false }),
      ]),
    );
    expect(promoteRows.every((row) => row.from !== "needs_mapping" || !row.allowed)).toBe(true);
    expect(promoteRows.every((row) => row.from !== "invalid" || !row.allowed)).toBe(true);
  });

  it("never allows needs_mapping or invalid to be overwritten to draft", () => {
    expect(CANDIDATE_NEVER_PROMOTE_FROM.has("needs_mapping")).toBe(true);
    expect(CANDIDATE_NEVER_PROMOTE_FROM.has("invalid")).toBe(true);
    expect(isCandidateTransitionAllowed("needs_mapping", "draft", "promote-after-gates")).toBe(
      false,
    );
    expect(isCandidateTransitionAllowed("invalid", "draft", "promote-after-gates")).toBe(false);
  });

  it.each(CANDIDATE_TRANSITION_TABLE)(
    "$event: $from → $to allowed=$allowed",
    ({ from, to, event, allowed }) => {
      expect(isCandidateTransitionAllowed(from, to, event)).toBe(allowed);
    },
  );
});

describe("evaluateCandidateSemanticGate", () => {
  const clearGates = {
    status: "resolved" as const,
    openIdentityMappings: 0,
    openSpecReviews: 0,
    unmatchedOccurrences: 0,
    ambiguousBindings: 0,
    resolverErrorDiagnostics: 0,
    toolchainOk: true,
    toolchainFailureCode: null,
  };

  it("passes only when status is resolved and every semantic + toolchain gate is clear", () => {
    expect(evaluateCandidateSemanticGate(clearGates)).toEqual({ ok: true });
    expect(assertCanPromoteCandidateToDraft(clearGates)).toEqual({ ok: true });
  });

  it("fail-closes needs_mapping without promoting (toolchain pass is irrelevant)", () => {
    const result = assertCanPromoteCandidateToDraft({
      ...clearGates,
      status: "needs_mapping",
      toolchainOk: true,
    });
    expect(result).toEqual({
      ok: false,
      reason: "needs-mapping",
      keepStatus: "needs_mapping",
    });
  });

  it("fail-closes invalid without promoting even when toolchain reports ok", () => {
    expect(
      assertCanPromoteCandidateToDraft({
        ...clearGates,
        status: "invalid",
        toolchainOk: true,
      }),
    ).toEqual({
      ok: false,
      reason: "invalid-revision",
      keepStatus: "invalid",
    });
  });

  it("fail-closes unresolved identity mapping", () => {
    expect(
      evaluateCandidateSemanticGate({
        ...clearGates,
        openIdentityMappings: 2,
      }),
    ).toMatchObject({ ok: false, reason: "unresolved-mapping", keepStatus: "needs_mapping" });
  });

  it("fail-closes open spec review", () => {
    expect(
      evaluateCandidateSemanticGate({
        ...clearGates,
        openSpecReviews: 1,
      }),
    ).toMatchObject({ ok: false, reason: "open-spec-review", keepStatus: "resolved" });
  });

  it("fail-closes unmatched occurrence", () => {
    expect(
      evaluateCandidateSemanticGate({
        ...clearGates,
        unmatchedOccurrences: 1,
      }),
    ).toMatchObject({ ok: false, reason: "unmatched-occurrence", keepStatus: "resolved" });
  });

  it("fail-closes ambiguous binding", () => {
    expect(
      evaluateCandidateSemanticGate({
        ...clearGates,
        ambiguousBindings: 1,
      }),
    ).toMatchObject({ ok: false, reason: "ambiguous-binding", keepStatus: "needs_mapping" });
  });

  it("fail-closes resolver diagnostics", () => {
    expect(
      evaluateCandidateSemanticGate({
        ...clearGates,
        resolverErrorDiagnostics: 3,
      }),
    ).toMatchObject({ ok: false, reason: "resolver-diagnostics", keepStatus: "invalid" });
  });

  it("toolchain pass is not sufficient when semantic gates fail", () => {
    const result = evaluateCandidateSemanticGate({
      ...clearGates,
      openSpecReviews: 1,
      toolchainOk: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("open-spec-review");
    }
  });

  it.each([
    ["toolchain-unavailable", "toolchain-unavailable"],
    ["version-mismatch", "toolchain-version-mismatch"],
    ["compile-failed", "toolchain-compile-failed"],
    ["schema-failed", "toolchain-schema-failed"],
  ] as const)("fail-closes toolchain %s", (failureCode, reason) => {
    expect(
      evaluateCandidateSemanticGate({
        ...clearGates,
        toolchainOk: false,
        toolchainFailureCode: failureCode,
      }),
    ).toMatchObject({ ok: false, reason, keepStatus: "invalid" });
  });
});
