import { describe, expect, it } from "vitest";

import { guardReopenIdentityMapping, guardResolveIdentityMapping } from "./identityMappingGuard";

describe("guardResolveIdentityMapping", () => {
  it("rejects a missing task", () => {
    expect(guardResolveIdentityMapping({ taskId: "task-missing" })).toEqual({
      ok: false,
      code: "NOT_FOUND",
      message: "Identity mapping task was not found.",
      details: { taskId: "task-missing" }
    });
  });

  it("allows an open task", () => {
    expect(guardResolveIdentityMapping({ taskId: "task-1", status: "open" })).toEqual({ ok: true });
  });

  it("allows protected re-resolve for an already resolved task", () => {
    expect(
      guardResolveIdentityMapping({
        taskId: "task-1",
        status: "resolved",
        taskKind: "identity-ambiguity",
        decision: "resolved",
        selectedLogicalNodeId: "ln-next",
        priorSelectedLogicalNodeId: "ln-prior",
        previousLogicalNodeId: "ln-previous",
        candidateLogicalNodeIds: ["ln-prior", "ln-next"]
      })
    ).toEqual({ ok: true });
  });

  it("requires prior-selection and previous-node continuity for protected re-resolve", () => {
    expect(
      guardResolveIdentityMapping({
        taskId: "task-1",
        status: "resolved",
        taskKind: "identity-ambiguity",
        decision: "resolved",
        selectedLogicalNodeId: "ln-next",
        priorSelectedLogicalNodeId: null,
        previousLogicalNodeId: "ln-previous",
        candidateLogicalNodeIds: ["ln-prior", "ln-next"]
      })
    ).toEqual({
      ok: false,
      code: "CONFLICT",
      message: "Completed mapping lacks reversible continuity evidence; an explicit migration is required.",
      details: { code: "identity-mapping-migration-required", taskId: "task-1" }
    });
  });

  it("requires the next re-resolve target to remain in the original candidate scope", () => {
    expect(
      guardResolveIdentityMapping({
        taskId: "task-1",
        status: "resolved",
        taskKind: "identity-ambiguity",
        decision: "resolved",
        selectedLogicalNodeId: "ln-foreign",
        priorSelectedLogicalNodeId: "ln-prior",
        previousLogicalNodeId: "ln-previous",
        candidateLogicalNodeIds: ["ln-prior", "ln-next"]
      })
    ).toMatchObject({
      ok: false,
      code: "CONFLICT",
      details: { code: "identity-mapping-migration-required", taskId: "task-1" }
    });
  });

  it("preserves the singleton-cardinality identity-decision gate", () => {
    expect(
      guardResolveIdentityMapping({
        taskId: "task-singleton",
        status: "open",
        taskKind: "singleton-cardinality",
        decision: "resolved",
        selectedLogicalNodeId: "ln-a"
      })
    ).toEqual({
      ok: false,
      code: "CONFLICT",
      message:
        "Singleton-per-project conflicts must be fixed in the registration or topology; identity decisions cannot discard instances.",
      details: { code: "singleton-cardinality-conflict", taskId: "task-singleton" }
    });
  });

  it("rejects non-resolve decisions when the task is not open", () => {
    expect(
      guardResolveIdentityMapping({
        taskId: "task-1",
        status: "resolved",
        decision: "dismissed"
      })
    ).toEqual({
      ok: false,
      code: "CONFLICT",
      message: "Identity mapping task is not open.",
      details: { taskId: "task-1" }
    });
    expect(guardResolveIdentityMapping({ taskId: "task-1", status: "dismissed" }).ok).toBe(false);
    expect(guardResolveIdentityMapping({ taskId: "task-1", status: "new_identity" }).ok).toBe(false);
  });
});

describe("guardReopenIdentityMapping", () => {
  it("rejects a missing task", () => {
    expect(guardReopenIdentityMapping({ taskId: "task-missing" })).toEqual({
      ok: false,
      code: "NOT_FOUND",
      message: "Identity mapping task was not found.",
      details: { taskId: "task-missing" }
    });
  });

  it("rejects reopening a resolved task", () => {
    expect(guardReopenIdentityMapping({ taskId: "task-1", status: "resolved" })).toEqual({
      ok: false,
      code: "CONFLICT",
      message: "Resolved identity mapping tasks cannot be reopened.",
      details: { taskId: "task-1" }
    });
  });

  it("rejects reopening a task that is already open", () => {
    expect(guardReopenIdentityMapping({ taskId: "task-1", status: "open" })).toEqual({
      ok: false,
      code: "CONFLICT",
      message: "Identity mapping task is already open.",
      details: { taskId: "task-1" }
    });
  });

  it("allows reopening dismissed and new_identity tasks", () => {
    expect(guardReopenIdentityMapping({ taskId: "task-1", status: "dismissed" })).toEqual({ ok: true });
    expect(guardReopenIdentityMapping({ taskId: "task-1", status: "new_identity" })).toEqual({ ok: true });
  });
});
