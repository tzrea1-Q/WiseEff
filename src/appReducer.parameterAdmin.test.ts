import { describe, expect, it } from "vitest";
import { appReducer } from "./App";
import { initialState } from "./mockData";

describe("parameter-admin reducer actions", () => {
  it("assigns a user role and records audit metadata", () => {
    const next = appReducer(initialState, {
      type: "ASSIGN_USER_ROLE",
      userId: "u-zhao-heng",
      roleId: "committer"
    });

    expect(next.users.find((user) => user.id === "u-zhao-heng")?.roleId).toBe("committer");
    expect(next.auditEvents[0].kind).toBe("user-role-change");
    expect(next.auditEvents[0].userId).toBe("u-zhao-heng");
    expect(next.auditEvents[0].metadata?.previousRole).toBe("guest");
    expect(next.auditEvents[0].metadata?.newRole).toBe("committer");
  });

  it("does not let the current user assign their own role", () => {
    const next = appReducer(initialState, {
      type: "ASSIGN_USER_ROLE",
      userId: initialState.currentUserId,
      roleId: "guest"
    });

    expect(next).toBe(initialState);
  });

  it("toggles user active state and writes an audit event", () => {
    const next = appReducer(initialState, {
      type: "TOGGLE_USER_ACTIVE",
      userId: "u-liu-min",
      isActive: false
    });

    expect(next.users.find((user) => user.id === "u-liu-min")?.isActive).toBe(false);
    expect(next.auditEvents[0].kind).toBe("user-toggle");
  });

  it("adds users and rejects duplicate emails", () => {
    const added = appReducer(initialState, {
      type: "ADD_USER",
      name: "Demo Engineer",
      email: "demo@chargelab.cn",
      title: "Prototype User",
      roleId: "user"
    });

    expect(added.users).toHaveLength(initialState.users.length + 1);
    expect(added.users.at(-1)?.name).toBe("Demo Engineer");
    expect(added.auditEvents[0].kind).toBe("user-add");
    expect(added.auditEvents[0].userId).toBe(added.users.at(-1)?.id);

    const duplicate = appReducer(initialState, {
      type: "ADD_USER",
      name: "Fake",
      email: "xu@chargelab.cn",
      title: "Fake",
      roleId: "guest"
    });

    expect(duplicate).toBe(initialState);
  });

  it("marks exports by snapshotting the current draft and writing audit metadata", () => {
    const dirty = appReducer(initialState, {
      type: "UPDATE_PROJECT_PARAMETER_METADATA",
      projectId: "aurora",
      parameterId: initialState.configDraft.parameterLibrary[0].id,
      patch: { description: "dirty change" }
    });
    const cleared = appReducer(dirty, {
      type: "MARK_EXPORTED",
      snapshotName: "params-demo.json",
      timestamp: "2026-05-10T22:00:00.000Z"
    });

    expect(cleared.lastExportedSnapshot).toBe(JSON.stringify(cleared.configDraft));
    expect(cleared.auditEvents[0].kind).toBe("export");
    expect(cleared.auditEvents[0].metadata?.snapshotName).toBe("params-demo.json");
  });

  it("dismisses insights idempotently and replaces AI flagged ids", () => {
    const once = appReducer(initialState, { type: "DISMISS_INSIGHT", insightId: "high-risk-orphans" });
    const twice = appReducer(once, { type: "DISMISS_INSIGHT", insightId: "high-risk-orphans" });
    const flagged = appReducer(twice, { type: "SET_AI_FLAGGED_IMPORT_IDS", ids: ["p1", "p2"] });

    expect(twice.insightDismissedIds).toEqual(["high-risk-orphans"]);
    expect(flagged.aiFlaggedImportIds).toEqual(["p1", "p2"]);
  });

  it("records agent action execution with viaAgent metadata", () => {
    const next = appReducer(initialState, {
      type: "AGENT_ACTION_EXECUTED",
      actionId: "scan-orphans",
      metadata: { foundOrphans: 2 }
    });

    expect(next.auditEvents[0].kind).toBe("agent-action");
    expect(next.auditEvents[0].viaAgent).toBe(true);
    expect(next.auditEvents[0].metadata?.aiActionId).toBe("scan-orphans");
    expect(next.auditEvents[0].metadata?.foundOrphans).toBe(2);
  });

  it("creates an undo entry for destructive parameter deletion", () => {
    const paramId = initialState.configDraft.parameterLibrary[0].id;
    const next = appReducer(initialState, {
      type: "DELETE_PROJECT_PARAMETER",
      parameterId: paramId
    });

    expect(next.configDraft.parameterLibrary.find((parameter) => parameter.id === paramId)).toBeUndefined();
    expect(next._undoStack?.actionKind).toBe("parameter-delete");
    const expiresIn = new Date(next._undoStack!.expiresAt).getTime() - new Date(next._undoStack!.createdAt).getTime();
    expect(expiresIn).toBeGreaterThanOrEqual(9_500);
    expect(expiresIn).toBeLessThanOrEqual(10_500);
    expect(next.auditEvents[0].kind).toBe("parameter-delete");
  });

  it("undoes the last destructive action before expiry", () => {
    const paramId = initialState.configDraft.parameterLibrary[0].id;
    const deleted = appReducer(initialState, {
      type: "DELETE_PROJECT_PARAMETER",
      parameterId: paramId
    });
    const restored = appReducer(deleted, { type: "UNDO_LAST_DESTRUCTIVE" });

    expect(restored.configDraft.parameterLibrary.find((parameter) => parameter.id === paramId)).toBeTruthy();
    expect(restored._undoStack).toBeNull();
    expect(restored.auditEvents[0].kind).toBe("rollback-undo");
  });

  it("does not undo expired destructive actions and can clear undo manually", () => {
    const paramId = initialState.configDraft.parameterLibrary[0].id;
    const deleted = appReducer(initialState, {
      type: "DELETE_PROJECT_PARAMETER",
      parameterId: paramId
    });
    const expired = {
      ...deleted,
      _undoStack: deleted._undoStack
        ? { ...deleted._undoStack, expiresAt: new Date(Date.now() - 60_000).toISOString() }
        : null
    };

    expect(appReducer(expired, { type: "UNDO_LAST_DESTRUCTIVE" })).toBe(expired);
    expect(appReducer(deleted, { type: "CLEAR_UNDO" })._undoStack).toBeNull();
  });
});
