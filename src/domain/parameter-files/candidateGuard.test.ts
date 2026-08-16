import { describe, expect, it } from "vitest";

import {
  guardAbandonCandidate,
  guardActivateCandidate,
  guardCandidateBaseFresh,
  guardNewFileActivation,
  guardRecomputeCandidate
} from "./candidateGuard";

describe("guardAbandonCandidate", () => {
  it("allows ready, blocked, failed, and stale candidates", () => {
    expect(guardAbandonCandidate("ready")).toEqual({ ok: true });
    expect(guardAbandonCandidate("blocked")).toEqual({ ok: true });
    expect(guardAbandonCandidate("failed")).toEqual({ ok: true });
    expect(guardAbandonCandidate("stale")).toEqual({ ok: true });
  });

  it("rejects abandon in other statuses", () => {
    expect(guardAbandonCandidate("active")).toEqual({
      ok: false,
      code: "CONFLICT",
      message: "Cannot abandon candidate in status active",
      details: { status: "active" }
    });
    expect(guardAbandonCandidate("abandoned")).toMatchObject({
      ok: false,
      code: "CONFLICT",
      message: "Cannot abandon candidate in status abandoned"
    });
  });
});

describe("guardRecomputeCandidate", () => {
  it("allows ready, blocked, failed, and stale candidates", () => {
    expect(guardRecomputeCandidate("ready")).toEqual({ ok: true });
    expect(guardRecomputeCandidate("stale")).toEqual({ ok: true });
  });

  it("rejects recompute in other statuses", () => {
    expect(guardRecomputeCandidate("active")).toEqual({
      ok: false,
      code: "CONFLICT",
      message: "Cannot recompute candidate in status active",
      details: { status: "active" }
    });
  });
});

describe("guardActivateCandidate", () => {
  it("allows only ready candidates", () => {
    expect(guardActivateCandidate("ready")).toEqual({ ok: true });
  });

  it("rejects activate when the candidate is not ready", () => {
    expect(guardActivateCandidate("stale")).toEqual({
      ok: false,
      code: "CONFLICT",
      message: "Cannot activate candidate in status stale",
      details: { status: "stale" }
    });
    expect(guardActivateCandidate("abandoned")).toMatchObject({
      ok: false,
      code: "CONFLICT",
      message: "Cannot activate candidate in status abandoned"
    });
  });
});

describe("guardCandidateBaseFresh", () => {
  it("allows matching actual, expected, and candidate base versions", () => {
    expect(
      guardCandidateBaseFresh({
        actualCurrentVersionId: "v1",
        expectedCurrentVersionId: "v1",
        candidateBaseVersionId: "v1"
      })
    ).toEqual({ ok: true });
    expect(
      guardCandidateBaseFresh({
        actualCurrentVersionId: null,
        expectedCurrentVersionId: null,
        candidateBaseVersionId: null
      })
    ).toEqual({ ok: true });
  });

  it("rejects when the working version drifted from expected", () => {
    expect(
      guardCandidateBaseFresh({
        actualCurrentVersionId: "v2",
        expectedCurrentVersionId: "v1",
        candidateBaseVersionId: "v1"
      })
    ).toEqual({
      ok: false,
      code: "CONFLICT",
      message: "Candidate base is stale; Working configuration was preserved. Recompute impact before activating.",
      details: {}
    });
  });

  it("rejects when the candidate base version drifted from expected", () => {
    expect(
      guardCandidateBaseFresh({
        actualCurrentVersionId: "v1",
        expectedCurrentVersionId: "v1",
        candidateBaseVersionId: "v0"
      })
    ).toMatchObject({
      ok: false,
      code: "CONFLICT"
    });
  });
});

describe("guardNewFileActivation", () => {
  it("requires configSetId and role for a new file", () => {
    expect(guardNewFileActivation({ configSetId: "set-1", role: "base" })).toEqual({ ok: true });
    expect(guardNewFileActivation({ role: "base" })).toEqual({
      ok: false,
      code: "VALIDATION_FAILED",
      message: "New file activation requires configSetId and role",
      details: {}
    });
    expect(guardNewFileActivation({ configSetId: "set-1" })).toMatchObject({
      ok: false,
      code: "VALIDATION_FAILED"
    });
  });
});
