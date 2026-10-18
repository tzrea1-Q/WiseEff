import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../../shared/database/client";
import { seedCoreGraph } from "../../testing/fixtures";
import { createEphemeralTestDatabase, isTestDatabaseAvailable, type EphemeralTestDatabase } from "../../testing/testDatabase";
import { createAgentInvocation, createSystemInvocation, createUserInvocation, type TrustedInvocationContext } from "../auth/trustedInvocation";
import type { AuthContext } from "../auth/types";
import { withAuditedWrite, type AuditSpec } from "./auditedWrite";

const databaseAvailable = await isTestDatabaseAvailable();
const principal: AuthContext = {
  user: { id: "audit-user", organizationId: "audit-org", name: "Audit User", title: "Admin", isActive: true },
  organization: { id: "audit-org", name: "Audit Org" }, roles: [], permissions: []
};
const spec: AuditSpec = {
  app: "audit-test", kind: "provenance", action: "write", severity: "Low",
  projectId: null, targetType: null, targetId: null, metadata: {}
};

describe.skipIf(!databaseAvailable)("audited write trusted provenance (PostgreSQL)", () => {
  let database: EphemeralTestDatabase;
  let client: pg.Client;
  let db: Database;
  beforeAll(async () => {
    database = await createEphemeralTestDatabase("auditprov");
    client = new pg.Client({ connectionString: database.url });
    await client.connect();
    db = createDatabase(client);
    await seedCoreGraph(db, { organization: { id: "audit-org" }, users: [{ id: "audit-user" }] });
  });
  afterAll(async () => {
    await client?.end();
    await database?.drop();
  });

  it("rejects raw auth before attempting a domain write or inserting audit evidence", async () => {
    let called = false;
    await expect(withAuditedWrite(db, principal as unknown as TrustedInvocationContext,
      { requestId: "invalid" }, async (tx) => {
        called = true;
        await tx.query("insert into organizations (id, name) values ('invalid-domain', 'Invalid')");
        return { result: undefined, audit: spec };
      })).rejects.toMatchObject({ code: "INVALID_TRUSTED_INVOCATION_CONTEXT" });
    expect(called).toBe(false);
    expect((await db.query("select id from organizations where id = 'invalid-domain'")).rows).toEqual([]);
    expect((await db.query("select id from audit_events")).rows).toEqual([]);
  });

  it("persists distinct User, approved Agent and scoped System actors", async () => {
    const invocations = [createUserInvocation(principal), createAgentInvocation(principal, {
      sessionId: "audit-session", toolCallId: "audit-tool", approval: { required: true, approvalId: "audit-approval" }
    }), createSystemInvocation({ kind: "service", name: "audit-service" })];
    for (const invocation of invocations) {
      await withAuditedWrite(db, invocation, { requestId: invocation.initiator }, async () => ({
        result: undefined,
        audit: { ...spec, ...(invocation.initiator === "system" ? { organizationId: "audit-org" } : {}) }
      }));
    }
    const { rows } = await db.query<{ actor_type: string; actor_user_id: string | null; metadata: Record<string, unknown> }>(
      "select actor_type, actor_user_id, metadata from audit_events order by actor_type"
    );
    expect(rows).toEqual([
      { actor_type: "agent", actor_user_id: "audit-user", metadata: {
        initiator: "agent", sessionId: "audit-session", toolCallId: "audit-tool", approvalId: "audit-approval"
      } },
      { actor_type: "system", actor_user_id: null, metadata: {
        initiator: "system", systemKind: "service", systemName: "audit-service"
      } },
      { actor_type: "user", actor_user_id: "audit-user", metadata: { initiator: "user" } }
    ]);
  });
});
