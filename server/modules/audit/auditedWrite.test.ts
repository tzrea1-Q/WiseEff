import { describe, expect, it } from "vitest";

import type { AuthContext } from "../auth/types";
import { createDatabase, type Queryable, type QueryResult } from "../../shared/database/client";
import { asAuditTx, withAuditedWrite, writeAuditEventInTx } from "./auditedWrite";

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
  it("commits the domain write and the audit event in one transaction", async () => {
    const { session, statements } = recordingSession();
    const db = createDatabase(session);

    const result = await withAuditedWrite(db, auth(), { requestId: "req-1" }, async (tx) => {
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
      withAuditedWrite(db, auth(), { requestId: "req-2" }, async (tx) => {
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
      withAuditedWrite(db, auth(), { requestId: "req-3" }, async (tx) => {
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

    await withAuditedWrite(db, auth(), { requestId: "req-4" }, async () => ({
      result: undefined,
      audit: [AUDIT, { ...AUDIT, kind: "unit-test-2" }]
    }));
    expect(statements.filter((s) => s.startsWith("insert into audit_events"))).toHaveLength(2);

    statements.length = 0;
    await withAuditedWrite(db, auth(), { requestId: "req-5" }, async () => ({
      result: undefined,
      audit: null
    }));
    expect(statements.filter((s) => s.startsWith("insert into audit_events"))).toHaveLength(0);
    expect(statements).toContain("commit");
  });
});

describe("writeAuditEventInTx", () => {
  it("derives actor and organization from auth and traceId from context", async () => {
    const calls: Array<{ text: string; values: unknown[] }> = [];
    const tx: Queryable = {
      query: async (text: string, values: unknown[] = []) => {
        calls.push({ text, values });
        return { rows: [], rowCount: 0 };
      }
    };

    await writeAuditEventInTx(asAuditTx(tx), auth(), { requestId: "req-6" }, AUDIT);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.values).toEqual(
      expect.arrayContaining(["org-1", "user-1", "user", "unit-test", "req-6"])
    );
  });
});
