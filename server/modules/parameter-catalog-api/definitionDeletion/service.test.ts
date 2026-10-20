import pg from "pg";
import { describe, expect, it, vi } from "vitest";

import type { Database } from "../../../shared/database/client";
import { makeTestAuthContext } from "../../../testing/authContext";
import { previewDefinitionDeletion, requireDefinitionErasureAdministrator } from "./service";

describe("definition deletion boundary", () => {
  it.each([
    { roleId: "admin" as const },
    { roleId: "platform-admin" as const, isActive: false },
    { roles: [{ roleId: "platform-admin" as const, projectId: "project-only" }] },
  ])("requires an active global platform administrator: %j", input => {
    expect(() => requireDefinitionErasureAdministrator(makeTestAuthContext(input))).toThrow("只有平台超级管理员");
  });

  it.each([["40001", "definition-erasure-preview-stale"], ["40P01", "definition-erasure-busy"],
    ["55P03", "definition-erasure-busy"], ["PCA05", "definition-erasure-busy"]])("maps PostgreSQL %s to a retryable HTTP conflict", async (code, reason) => {
    const error = new pg.DatabaseError("Database concurrency refusal", 0, "ERROR");
    error.code = code;
    const transaction = vi.fn(async () => { throw error; });
    const db: Database = { query: vi.fn(), transaction };
    await expect(previewDefinitionDeletion(db, makeTestAuthContext({ roleId: "platform-admin" }), "pdef_selected"))
      .rejects.toMatchObject({ code: "CONFLICT", status: 409, details: { reason } });
  });
});
