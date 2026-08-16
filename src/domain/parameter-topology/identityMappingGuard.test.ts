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

  it("rejects resolve when the task is not open", () => {
    expect(guardResolveIdentityMapping({ taskId: "task-1", status: "resolved" })).toEqual({
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
