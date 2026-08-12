import { describe, expect, it } from "vitest";
import type { AuthContext } from "../auth/types";
import type { Database, QueryResult, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import {
  archiveLogDomainRecord,
  createLogDomainRecord,
  listLogDomainRecords,
  updateLogDomainRecord
} from "./domainsService";

type QueryCall = {
  text: string;
  values: unknown[];
};

type QueuedResult = unknown[] | ((call: QueryCall) => unknown[]);

function createFakeDb(results: QueuedResult[] = []) {
  const calls: QueryCall[] = [];
  const txCalls: QueryCall[] = [];

  const runQuery = async <Row,>(target: QueryCall[], text: string, values: unknown[] = []): Promise<QueryResult<Row>> => {
    const call = { text, values };
    target.push(call);
    const next = results.shift() ?? [];
    const rows = typeof next === "function" ? next(call) : next;
    return { rows: rows as Row[], rowCount: rows.length };
  };

  const tx: Queryable = {
    query: (text, values = []) => runQuery(txCalls, text, values)
  };
  const db: Database = {
    query: (text, values = []) => runQuery(calls, text, values),
    transaction: async <T,>(fn: (queryable: Queryable) => Promise<T>) => fn(tx)
  };

  return { calls, txCalls, db };
}

function makeAuth(permissions: AuthContext["permissions"]): AuthContext {
  return {
    user: { id: "u-1", organizationId: "org-1", name: "User", title: "Engineer", isActive: true },
    organization: { id: "org-1", name: "Org" },
    roles: [],
    permissions
  };
}

const adminAuth = makeAuth(["logs:view", "logs:admin-domains"]);

const domainRow = {
  id: "domain-1",
  name: "charging-power",
  description: "Charging subsystem",
  status: "active",
  format_profile: null,
  created_at: "2026-08-12T00:00:00.000Z",
  updated_at: "2026-08-12T00:00:00.000Z"
};

describe("listLogDomainRecords", () => {
  it("requires logs:view", async () => {
    const { db } = createFakeDb();
    await expect(listLogDomainRecords(db, makeAuth([]), {})).rejects.toBeInstanceOf(ApiError);
  });

  it("lists active domains by default", async () => {
    const { db, calls } = createFakeDb([[domainRow]]);

    const result = await listLogDomainRecords(db, adminAuth, {});

    expect(result.items).toEqual([
      expect.objectContaining({ id: "domain-1", name: "charging-power", status: "active" })
    ]);
    expect(calls[0].text).toContain("status = 'active'");
  });
});

describe("createLogDomainRecord", () => {
  it("requires logs:admin-domains", async () => {
    const { db } = createFakeDb();
    await expect(
      createLogDomainRecord(db, makeAuth(["logs:view"]), { name: "charging-power" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("creates a domain and writes a log-domain-create audit event", async () => {
    const { db, txCalls } = createFakeDb([
      [],
      [domainRow],
      []
    ]);

    const created = await createLogDomainRecord(db, adminAuth, {
      name: "charging-power",
      description: "Charging subsystem"
    });

    expect(created).toMatchObject({ id: "domain-1", name: "charging-power" });
    const auditCall = txCalls.find((call) => call.text.includes("insert into audit_events"));
    expect(auditCall).toBeTruthy();
    expect(auditCall?.values).toContain("log-domain-create");
    expect(auditCall?.values).toContain("log-domain");
  });

  it("rejects duplicate names inside the organization with 409", async () => {
    const { db } = createFakeDb([[domainRow]]);

    await expect(
      createLogDomainRecord(db, adminAuth, { name: "charging-power" })
    ).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
  });

  it("rejects an invalid format profile with readable issues", async () => {
    const { db } = createFakeDb();

    await expect(
      createLogDomainRecord(db, adminAuth, { name: "charging-power", formatProfile: { timestampPattern: "([" } })
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED", status: 400 });
  });
});

describe("updateLogDomainRecord", () => {
  it("updates fields and audits the change", async () => {
    const { db, txCalls } = createFakeDb([
      [domainRow],
      [{ ...domainRow, description: "updated" }],
      []
    ]);

    const updated = await updateLogDomainRecord(db, adminAuth, {
      domainId: "domain-1",
      description: "updated"
    });

    expect(updated.description).toBe("updated");
    const auditCall = txCalls.find((call) => call.text.includes("insert into audit_events"));
    expect(auditCall?.values).toContain("log-domain-update");
  });

  it("rejects renaming onto an existing domain name", async () => {
    const { db } = createFakeDb([
      [domainRow],
      [{ ...domainRow, id: "domain-2", name: "other" }]
    ]);

    await expect(
      updateLogDomainRecord(db, adminAuth, { domainId: "domain-1", name: "other" })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("returns 404 for unknown domains", async () => {
    const { db } = createFakeDb([[]]);

    await expect(
      updateLogDomainRecord(db, adminAuth, { domainId: "missing", description: "x" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("validates a replacement format profile", async () => {
    const { db } = createFakeDb();

    await expect(
      updateLogDomainRecord(db, adminAuth, { domainId: "domain-1", formatProfile: { unknownKey: true } })
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });
});

describe("archiveLogDomainRecord", () => {
  it("archives and audits", async () => {
    const { db, txCalls } = createFakeDb([
      [domainRow],
      [{ ...domainRow, status: "archived" }],
      []
    ]);

    const archived = await archiveLogDomainRecord(db, adminAuth, "domain-1");

    expect(archived.status).toBe("archived");
    const auditCall = txCalls.find((call) => call.text.includes("insert into audit_events"));
    expect(auditCall?.values).toContain("log-domain-archive");
  });

  it("requires logs:admin-domains", async () => {
    const { db } = createFakeDb();
    await expect(archiveLogDomainRecord(db, makeAuth(["logs:view"]), "domain-1")).rejects.toMatchObject({
      code: "FORBIDDEN"
    });
  });
});
