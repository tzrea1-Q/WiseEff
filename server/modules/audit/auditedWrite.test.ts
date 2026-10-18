import { describe, expect, it } from "vitest";

import type { AuthContext } from "../auth/types";
import { createAgentInvocation, createSystemInvocation, createUserInvocation, type TrustedInvocationContext } from "../auth/trustedInvocation";
import { createDatabase, type Queryable, type QueryResult } from "../../shared/database/client";
import { asAuditTx, withAuditedWrite, writeAuditEventInTx, writeMilestoneAudit, writeRefusalAudit } from "./auditedWrite";

function auth(): AuthContext {
  return {
    user: {
      id: "user-1",
      organizationId: "org-1",
      name: "Riley Chen",
      email: "riley@example.com",
      title: "Admin",
      isActive: true
    },
    organization: { id: "org-1", name: "ChargeLab" },
    roles: [{ projectId: null, roleId: "admin" }],
    permissions: ["admin:access"]
  };
}

/** Session-recording Queryable so the real createDatabase drives BEGIN/COMMIT/ROLLBACK. */
function recordingSession() {
  const statements: string[] = [];
  const session: Queryable = {
    query: async <Row,>(text: string): Promise<QueryResult<Row>> => {
      statements.push(text.trim().toLowerCase().split(/\s+/).slice(0, 4).join(" "));
      return { rows: [] as Row[], rowCount: 0 };
    }
  };
  return { session, statements };
}

const AUDIT = {
  app: "parameter-admin",
  kind: "unit-test",
  action: "did the thing",
  severity: "Low" as const,
  projectId: "p1",
  targetType: "thing",
  targetId: "t1",
  metadata: { a: 1 }
};

describe("withAuditedWrite", () => {
  it.each([undefined, auth(), { initiator: "user", principal: auth() }])(
    "rejects missing or unbranded invocation before any domain write",
    async (raw) => {
      const { session, statements } = recordingSession();
      let called = false;
      await expect(withAuditedWrite(createDatabase(session), raw as TrustedInvocationContext,
        { requestId: "invalid" }, async () => {
          called = true;
          return { result: undefined, audit: null };
        })).rejects.toMatchObject({ code: "INVALID_TRUSTED_INVOCATION_CONTEXT" });
      expect(called).toBe(false);
      expect(statements).toEqual([]);
    }
  );

  it("commits the domain write and the audit event in one transaction", async () => {
    const { session, statements } = recordingSession();
    const db = createDatabase(session);

    const result = await withAuditedWrite(db, createUserInvocation(auth()), { requestId: "req-1" }, async (tx) => {
      await tx.query("insert into things values (1)");
      return { result: "ok", audit: AUDIT };
    });

    expect(result).toBe("ok");
    const beginIndex = statements.indexOf("begin");
    const insertIndex = statements.findIndex((s) => s.startsWith("insert into things"));
    const auditIndex = statements.findIndex((s) => s.startsWith("insert into audit_events"));
    const commitIndex = statements.indexOf("commit");
    expect(beginIndex).toBeGreaterThanOrEqual(0);
    expect(insertIndex).toBeGreaterThan(beginIndex);
    expect(auditIndex).toBeGreaterThan(insertIndex);
    expect(commitIndex).toBeGreaterThan(auditIndex);
    expect(statements).not.toContain("rollback");
  });

  it("rolls back the domain write when the audit insert fails", async () => {
    const statements: string[] = [];
    const session: Queryable = {
      query: async (text: string) => {
        const normalized = text.trim().toLowerCase();
        statements.push(normalized.split(/\s+/).slice(0, 4).join(" "));
        if (normalized.startsWith("insert into audit_events")) {
          throw new Error("audit insert failed");
        }
        return { rows: [], rowCount: 0 };
      }
    };
    const db = createDatabase(session);

    await expect(
      withAuditedWrite(db, createUserInvocation(auth()), { requestId: "req-2" }, async (tx) => {
        await tx.query("insert into things values (1)");
        return { result: "ok", audit: AUDIT };
      })
    ).rejects.toThrow("audit insert failed");

    // The domain insert happened inside the transaction and the transaction rolled back.
    expect(statements.some((s) => s.startsWith("insert into things"))).toBe(true);
    expect(statements).toContain("rollback");
    expect(statements).not.toContain("commit");
  });

  it("rolls back the audit when the domain write fails after nested transactions", async () => {
    const { session, statements } = recordingSession();
    const db = createDatabase(session);

    await expect(
      withAuditedWrite(db, createUserInvocation(auth()), { requestId: "req-3" }, async (tx) => {
        // Services that open their own transaction degrade to savepoints here.
        await tx.transaction(async (inner) => {
          await inner.query("insert into nested values (1)");
        });
        throw new Error("domain write failed");
      })
    ).rejects.toThrow("domain write failed");

    expect(statements.some((s) => s.startsWith("savepoint"))).toBe(true);
    expect(statements).toContain("rollback");
    expect(statements.some((s) => s.startsWith("insert into audit_events"))).toBe(false);
  });

  it("writes one audit event per spec and skips when audit is null", async () => {
    const { session, statements } = recordingSession();
    const db = createDatabase(session);

    await withAuditedWrite(db, createUserInvocation(auth()), { requestId: "req-4" }, async () => ({
      result: undefined,
      audit: [AUDIT, { ...AUDIT, kind: "unit-test-2" }]
    }));
    expect(statements.filter((s) => s.startsWith("insert into audit_events"))).toHaveLength(2);

    statements.length = 0;
    await withAuditedWrite(db, createUserInvocation(auth()), { requestId: "req-5" }, async () => ({
      result: undefined,
      audit: null
    }));
    expect(statements.filter((s) => s.startsWith("insert into audit_events"))).toHaveLength(0);
    expect(statements).toContain("commit");
  });
});

describe("writeAuditEventInTx", () => {
  it("projects User, Agent and System provenance without trusting spec metadata", async () => {
    const values: unknown[][] = [];
    const tx: Queryable = { query: async (_text, args = []) => {
      values.push(args);
      return { rows: [], rowCount: 0 };
    } };
    const principal = auth();
    const agent = createAgentInvocation(principal, {
      sessionId: "session-1", toolCallId: "tool-1",
      approval: { required: true, approvalId: "approval-1" }
    });
    for (const invocation of [createUserInvocation(principal), agent]) {
      await writeAuditEventInTx(asAuditTx(tx), invocation, { requestId: "req-provenance" }, {
        ...AUDIT, id: "explicit-id", metadata: { initiator: "spoof", toolCallId: "spoof" }
      });
    }
    expect(values[0].slice(0, 5)).toEqual(["explicit-id", "org-1", "p1", "user-1", "user"]);
    expect(values[1].slice(0, 5)).toEqual(["explicit-id", "org-1", "p1", "user-1", "agent"]);
    expect(JSON.parse(values[1][11] as string)).toMatchObject({
      initiator: "agent", sessionId: "session-1", toolCallId: "tool-1", approvalId: "approval-1"
    });
    await writeAuditEventInTx(asAuditTx(tx), createSystemInvocation({ kind: "job", name: "audit-test" }),
      { requestId: "system" }, { ...AUDIT, organizationId: "org-1" });
    expect(values[2].slice(1, 5)).toEqual(["org-1", "p1", null, "system"]);
    expect(JSON.parse(values[2][11] as string)).toMatchObject({
      initiator: "system", systemKind: "job", systemName: "audit-test"
    });
    await expect(writeAuditEventInTx(asAuditTx(tx), createUserInvocation(principal),
      { requestId: "override" }, { ...AUDIT, organizationId: "other-org" }))
      .rejects.toMatchObject({ code: "INVALID_TRUSTED_INVOCATION_CONTEXT" });
    expect(values).toHaveLength(3);
  });

  it("rejects raw AuthContext in transactional, refusal and milestone writes", async () => {
    const { session, statements } = recordingSession();
    const db = createDatabase(session);
    for (const write of [writeAuditEventInTx, writeRefusalAudit, writeMilestoneAudit]) {
      await expect(write(db as typeof db & ReturnType<typeof asAuditTx>, auth() as unknown as TrustedInvocationContext,
        { requestId: "invalid" }, AUDIT)).rejects.toMatchObject({ code: "INVALID_TRUSTED_INVOCATION_CONTEXT" });
    }
    expect(statements).toEqual([]);
  });

  it("derives actor and organization from auth and traceId from context", async () => {
    const calls: Array<{ text: string; values: unknown[] }> = [];
    const tx: Queryable = {
      query: async (text: string, values: unknown[] = []) => {
        calls.push({ text, values });
        return { rows: [], rowCount: 0 };
      }
    };

    await writeAuditEventInTx(asAuditTx(tx), createUserInvocation(auth()), { requestId: "req-6" }, AUDIT);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.values).toEqual(
      expect.arrayContaining(["org-1", "user-1", "user", "unit-test", "req-6"])
    );
  });
});
