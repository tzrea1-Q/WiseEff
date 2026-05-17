import { describe, expect, it } from "vitest";
import { auditEvents, initialState, roles, users } from "./mockData";
import type { AuditEventKind, ImportBatch, RoleCapability, UndoEntry } from "./mockData";

describe("parameter admin data contracts", () => {
  it("extends every role with permissions and description", () => {
    for (const role of roles) {
      expect(Array.isArray(role.permissions)).toBe(true);
      expect(role.permissions.length).toBeGreaterThan(0);
      expect(typeof role.description).toBe("string");
      expect(role.description.length).toBeGreaterThan(0);
    }

    expect(roles.find((role) => role.id === "admin")?.permissions).toContain("users:manage");
    expect(roles.find((role) => role.id === "guest")?.permissions).toEqual(["parameter:view"]);
  });

  it("exports at least eight users with valid role bindings", () => {
    expect(users.length).toBeGreaterThanOrEqual(8);
    const roleIds = new Set(roles.map((role) => role.id));

    for (const user of users) {
      expect(roleIds.has(user.roleId)).toBe(true);
      expect(user.email).toMatch(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
      expect(typeof user.isActive).toBe("boolean");
      expect(typeof user.createdAt).toBe("string");
    }

    expect(users.filter((user) => user.roleId === "admin").length).toBeGreaterThanOrEqual(1);
    expect(users.filter((user) => user.roleId === "guest").length).toBeGreaterThanOrEqual(2);
    expect(users.some((user) => !user.isActive)).toBe(true);
  });

  it("initializes parameter admin state fields", () => {
    expect(initialState.users).toBe(users);
    expect(typeof initialState.currentUserId).toBe("string");
    expect(users.find((user) => user.id === initialState.currentUserId)?.roleId).toBe("admin");
    expect(initialState.lastExportedSnapshot).toBe(JSON.stringify(initialState.configDraft));
    expect(initialState._undoStack).toBeNull();
    expect(initialState.insightDismissedIds).toEqual([]);
    expect(initialState.aiFlaggedImportIds).toEqual([]);
  });

  it("supports classified audit events with expanded metadata", () => {
    const kinds: AuditEventKind[] = [
      "parameter-add",
      "parameter-update",
      "parameter-delete",
      "batch-import",
      "bulk-risk-change",
      "bulk-module-change",
      "bulk-delete",
      "user-add",
      "user-role-change",
      "user-toggle",
      "export",
      "rollback-undo",
      "agent-action"
    ];

    expect(kinds.length).toBe(13);
    expect(auditEvents.length).toBeGreaterThanOrEqual(20);
    for (const event of auditEvents) {
      expect(kinds).toContain(event.kind);
    }
    expect(auditEvents.some((event) => event.parameterId)).toBe(true);
    expect(auditEvents.some((event) => event.batchId)).toBe(true);
    expect(auditEvents.some((event) => event.userId)).toBe(true);
    expect(auditEvents.some((event) => event.viaAgent === true)).toBe(true);
  });

  it("carries undo and import batch runtime structures", () => {
    const entry: UndoEntry = {
      id: "undo-1",
      actionKind: "parameter-delete",
      message: "Deleted fast_charge_current_limit_ma",
      snapshot: { configDraft: initialState.configDraft },
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 10_000).toISOString(),
      originalAuditEventId: "audit-xxx"
    };
    expect(entry.actionKind).toBe("parameter-delete");

    const batch: ImportBatch = {
      id: "BI-000001",
      source: "demo",
      demoSourceId: "mixed-8",
      submittedAt: new Date().toISOString(),
      summary: { added: 3, updated: 5, deleted: 0 },
      affectedIds: ["p1", "p2"],
      aiFlaggedIds: ["p1"]
    };
    expect(batch.summary.added + batch.summary.updated).toBe(8);
  });

  it("defines the shared role permission levels", () => {
    const caps: RoleCapability[] = ["parameter:view", "parameter:edit", "parameter:review", "users:manage"];
    expect(caps.length).toBe(4);
  });
});
