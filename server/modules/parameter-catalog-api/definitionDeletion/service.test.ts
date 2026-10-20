import pg from "pg";
import { describe, expect, it, vi } from "vitest";

import type { Database } from "../../../shared/database/client";
import { makeTestAuthContext } from "../../../testing/authContext";
import { createAgentInvocation, createSystemInvocation } from "../../auth/trustedInvocation";
import { deleteDefinition, previewDefinitionDeletion, requireDefinitionErasureAdministrator } from "./service";

describe("definition deletion boundary", () => {
  it("rejects non-human invocations before any database write", async () => {
    const db: Database = { query: vi.fn(), transaction: vi.fn() };
    const auth = makeTestAuthContext({ roleId: "platform-admin" });
    for (const invocation of [createSystemInvocation({ kind: "job", name: "erase" }),
      createAgentInvocation(auth, { sessionId: "session", toolCallId: "call", approval: { required: false } })]) {
      await expect(deleteDefinition(db, invocation, "pdef_selected", "preview", "request"))
        .rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    }
    expect(db.transaction).not.toHaveBeenCalled();
    expect(db.query).not.toHaveBeenCalled();
  });
  it.each([
    { roleId: "admin" as const },
    { roleId: "platform-admin" as const, isActive: false },
    { roles: [{ roleId: "platform-admin" as const, projectId: "project-only" }] },
  ])("requires an active global platform administrator: %j", input => {
    expect(() => requireDefinitionErasureAdministrator(makeTestAuthContext(input))).toThrow("只有平台超级管理员");
  });

  it.each([["40001", "definition-erasure-preview-stale"], ["40P01", "definition-erasure-busy"],
    ["55P03", "definition-erasure-busy"], ["PCA05", "definition-erasure-busy"]])("maps PostgreSQL %s to a retryable HTTP conflict", async (code, reason) => {
    const error = new pg.DatabaseError("Database concurrency refusal", 0, "error");
    error.code = code;
    const transaction = vi.fn(async () => { throw error; });
    const db: Database = { query: vi.fn(), transaction };
    await expect(previewDefinitionDeletion(db, makeTestAuthContext({ roleId: "platform-admin" }), "pdef_selected"))
      .rejects.toMatchObject({ code: "CONFLICT", status: 409, details: { reason } });
  });
});
