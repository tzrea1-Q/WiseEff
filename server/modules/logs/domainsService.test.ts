import { describe, expect, it } from "vitest";
import type { AuthContext } from "../auth/types";
import type { Database, QueryResult, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import {
  archiveLogDomainRecord,
  createLogDomainRecord,
  listLogDomainKnowledgeLinkRecords,
  listLogDomainRecords,
  listLogDomainWebhookDeliveryRecords,
  sendLogDomainWebhookTestDelivery,
  setLogDomainKnowledgeLinkRecords,
  setLogDomainWebhookRecord,
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
  model_override: null,
  webhook_url: null,
  webhook_secret: null,
  webhook_enabled: false,
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
      createLogDomainRecord(db, makeAuth(["logs:view"]), { name: "charging-power" }, { requestId: "req-test" })
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
    }, { requestId: "req-test" });

    expect(created).toMatchObject({ id: "domain-1", name: "charging-power" });
    const auditCall = txCalls.find((call) => call.text.includes("insert into audit_events"));
    expect(auditCall).toBeTruthy();
    expect(auditCall?.values).toContain("log-domain-create");
    expect(auditCall?.values).toContain("log-domain");
  });

  it("rejects duplicate names inside the organization with 409", async () => {
    const { db } = createFakeDb([[domainRow]]);

    await expect(
      createLogDomainRecord(db, adminAuth, { name: "charging-power" }, { requestId: "req-test" })
    ).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
  });

  it("rejects an invalid format profile with readable issues", async () => {
    const { db } = createFakeDb();

    await expect(
      createLogDomainRecord(db, adminAuth, { name: "charging-power", formatProfile: { timestampPattern: "([" } }, { requestId: "req-test" })
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
    }, { requestId: "req-test" });

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
      updateLogDomainRecord(db, adminAuth, { domainId: "domain-1", name: "other" }, { requestId: "req-test" })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("returns 404 for unknown domains", async () => {
    const { db } = createFakeDb([[]]);

    await expect(
      updateLogDomainRecord(db, adminAuth, { domainId: "missing", description: "x" }, { requestId: "req-test" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("validates a replacement format profile", async () => {
    const { db } = createFakeDb();

    await expect(
      updateLogDomainRecord(db, adminAuth, { domainId: "domain-1", formatProfile: { unknownKey: true } }, { requestId: "req-test" })
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });
});

const publishedEntryRow = {
  id: "5f3a1f8e-52f2-4a11-9a53-0f2a5a4c1a01",
  organization_id: "org-1",
  title: "E_THERMAL_FOLDBACK handbook",
  content_form: "markdown",
  status: "published",
  tags: ["charging"],
  source_type: "human",
  source_session_id: null,
  source_log_id: null,
  created_by_user_id: "u-1",
  head_revision_id: null,
  head_revision_number: 1,
  created_at: "2026-08-12T00:00:00.000Z",
  updated_at: "2026-08-12T00:00:00.000Z",
  published_at: "2026-08-12T00:00:00.000Z",
  archived_at: null
};

const linkRow = {
  id: "link-1",
  log_domain_id: "domain-1",
  knowledge_entry_id: publishedEntryRow.id,
  entry_title: publishedEntryRow.title,
  entry_status: "published",
  entry_tags: ["charging"],
  created_at: "2026-08-13T00:00:00.000Z"
};

describe("listLogDomainKnowledgeLinkRecords", () => {
  it("requires logs:admin-domains", async () => {
    const { db } = createFakeDb();
    await expect(listLogDomainKnowledgeLinkRecords(db, makeAuth(["logs:view"]), "domain-1")).rejects.toMatchObject({
      code: "FORBIDDEN"
    });
  });

  it("lists links with the current entry status", async () => {
    const { db } = createFakeDb([[domainRow], [linkRow]]);

    const result = await listLogDomainKnowledgeLinkRecords(db, adminAuth, "domain-1");

    expect(result.items).toEqual([
      expect.objectContaining({
        knowledgeEntryId: publishedEntryRow.id,
        entryTitle: "E_THERMAL_FOLDBACK handbook",
        entryStatus: "published"
      })
    ]);
  });

  it("returns 404 for unknown domains", async () => {
    const { db } = createFakeDb([[]]);
    await expect(listLogDomainKnowledgeLinkRecords(db, adminAuth, "missing")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("setLogDomainKnowledgeLinkRecords", () => {
  it("requires logs:admin-domains", async () => {
    const { db } = createFakeDb();
    await expect(
      setLogDomainKnowledgeLinkRecords(
        db,
        makeAuth(["logs:view"]),
        { domainId: "domain-1", knowledgeEntryIds: [] },
        { requestId: "req-test" }
      )
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("replaces the link set with published entries and audits the change", async () => {
    const { db, txCalls } = createFakeDb([
      [domainRow],
      [publishedEntryRow],
      [],
      [],
      [linkRow],
      []
    ]);

    const result = await setLogDomainKnowledgeLinkRecords(
      db,
      adminAuth,
      { domainId: "domain-1", knowledgeEntryIds: [publishedEntryRow.id] },
      { requestId: "req-test" }
    );

    expect(result.items).toEqual([expect.objectContaining({ knowledgeEntryId: publishedEntryRow.id })]);
    const insertCall = txCalls.find((call) => call.text.includes("insert into log_domain_knowledge_links"));
    expect(insertCall?.values).toContain(publishedEntryRow.id);
    const auditCall = txCalls.find((call) => call.text.includes("insert into audit_events"));
    expect(auditCall?.values).toContain("log-domain-knowledge-links-update");
  });

  it("rejects non-published entries — publishing stays the single trust gate", async () => {
    const { db } = createFakeDb([
      [domainRow],
      [{ ...publishedEntryRow, status: "draft" }]
    ]);

    await expect(
      setLogDomainKnowledgeLinkRecords(
        db,
        adminAuth,
        { domainId: "domain-1", knowledgeEntryIds: [publishedEntryRow.id] },
        { requestId: "req-test" }
      )
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED", status: 400 });
  });

  it("rejects entries missing from the organization with 404", async () => {
    const { db } = createFakeDb([
      [domainRow],
      []
    ]);

    await expect(
      setLogDomainKnowledgeLinkRecords(
        db,
        adminAuth,
        { domainId: "domain-1", knowledgeEntryIds: [publishedEntryRow.id] },
        { requestId: "req-test" }
      )
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("returns 404 for unknown domains", async () => {
    const { db } = createFakeDb([[]]);

    await expect(
      setLogDomainKnowledgeLinkRecords(
        db,
        adminAuth,
        { domainId: "missing", knowledgeEntryIds: [] },
        { requestId: "req-test" }
      )
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("archiveLogDomainRecord", () => {
  it("archives and audits", async () => {
    const { db, txCalls } = createFakeDb([
      [domainRow],
      [{ ...domainRow, status: "archived" }],
      []
    ]);

    const archived = await archiveLogDomainRecord(db, adminAuth, "domain-1", { requestId: "req-test" });

    expect(archived.status).toBe("archived");
    const auditCall = txCalls.find((call) => call.text.includes("insert into audit_events"));
    expect(auditCall?.values).toContain("log-domain-archive");
  });

  it("requires logs:admin-domains", async () => {
    const { db } = createFakeDb();
    await expect(archiveLogDomainRecord(db, makeAuth(["logs:view"]), "domain-1", { requestId: "req-test" })).rejects.toMatchObject({
      code: "FORBIDDEN"
    });
  });
});

describe("updateLogDomainRecord model override", () => {
  it("saves the per-domain model override and audits the change", async () => {
    const { db, txCalls } = createFakeDb([
      [domainRow],
      [{ ...domainRow, model_override: "gpt-4o" }],
      []
    ]);

    const updated = await updateLogDomainRecord(db, adminAuth, {
      domainId: "domain-1",
      modelOverride: "gpt-4o"
    }, { requestId: "req-test" });

    expect(updated.modelOverride).toBe("gpt-4o");
    const updateCall = txCalls.find((call) => call.text.includes("update log_domains"));
    expect(updateCall?.values).toContain("gpt-4o");
    const auditCall = txCalls.find((call) => call.text.includes("insert into audit_events"));
    expect(JSON.stringify(auditCall?.values)).toContain("modelOverrideChanged");
  });

  it("clears the override back to the global model with null or blank", async () => {
    const { db, txCalls } = createFakeDb([
      [{ ...domainRow, model_override: "gpt-4o" }],
      [domainRow],
      []
    ]);

    const updated = await updateLogDomainRecord(db, adminAuth, {
      domainId: "domain-1",
      modelOverride: "   "
    }, { requestId: "req-test" });

    expect(updated.modelOverride).toBeUndefined();
    const updateCall = txCalls.find((call) => call.text.includes("update log_domains"));
    // Blank input is normalized to SQL NULL (clear), never stored as whitespace.
    expect(updateCall?.values).not.toContain("   ");
  });
});

const secretValue = "webhook-secret-with-enough-entropy";
const configuredWebhookRow = {
  ...domainRow,
  webhook_url: "https://hooks.example.com/wiseeff",
  webhook_secret: secretValue,
  webhook_enabled: true
};

describe("setLogDomainWebhookRecord", () => {
  it("requires logs:admin-domains", async () => {
    const { db } = createFakeDb();
    await expect(
      setLogDomainWebhookRecord(
        db,
        makeAuth(["logs:view"]),
        { domainId: "domain-1", url: "https://hooks.example.com/x", enabled: false },
        { requestId: "req-test" }
      )
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects plain-http URLs with an explicit error code before any write", async () => {
    const { db, calls, txCalls } = createFakeDb();

    await expect(
      setLogDomainWebhookRecord(
        db,
        adminAuth,
        { domainId: "domain-1", url: "http://hooks.example.com/x", enabled: false },
        { requestId: "req-test" }
      )
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED", details: { reason: "webhook-url-scheme" } });
    expect(calls).toHaveLength(0);
    expect(txCalls).toHaveLength(0);
  });

  it("rejects private/loopback/metadata address literals at save time", async () => {
    const { db } = createFakeDb();

    for (const url of ["https://169.254.169.254/latest", "https://10.0.0.8/hook", "https://[::1]/hook"]) {
      await expect(
        setLogDomainWebhookRecord(db, adminAuth, { domainId: "domain-1", url, enabled: false }, { requestId: "req-test" })
      ).rejects.toMatchObject({ code: "VALIDATION_FAILED", details: { reason: "webhook-url-private-address" } });
    }
  });

  it("rejects enabling without a URL or without a signing secret", async () => {
    const { db } = createFakeDb([[domainRow]]);

    await expect(
      setLogDomainWebhookRecord(db, adminAuth, { domainId: "domain-1", url: null, enabled: true }, { requestId: "req-test" })
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED", details: { reason: "webhook-url-required" } });

    await expect(
      setLogDomainWebhookRecord(
        db,
        adminAuth,
        { domainId: "domain-1", url: "https://hooks.example.com/x", enabled: true },
        { requestId: "req-test" }
      )
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED", details: { reason: "webhook-secret-required" } });
  });

  it("saves the configuration, audits it, and never echoes the secret", async () => {
    const { db, txCalls } = createFakeDb([
      [domainRow],
      [configuredWebhookRow],
      []
    ]);

    const saved = await setLogDomainWebhookRecord(
      db,
      adminAuth,
      { domainId: "domain-1", url: "https://hooks.example.com/wiseeff", enabled: true, secret: secretValue },
      { requestId: "req-test" }
    );

    expect(saved.webhook).toEqual({
      enabled: true,
      url: "https://hooks.example.com/wiseeff",
      secretConfigured: true,
      secretLastFour: secretValue.slice(-4)
    });
    expect(JSON.stringify(saved)).not.toContain(secretValue);

    const auditCall = txCalls.find((call) => call.text.includes("insert into audit_events"));
    expect(auditCall?.values).toContain("log-domain-webhook-config");
    // The audit metadata records THAT the secret changed, never its value.
    expect(JSON.stringify(auditCall?.values)).toContain("secretChanged");
    expect(JSON.stringify(auditCall?.values)).not.toContain(secretValue);
  });

  it("keeps the stored secret when the update omits it", async () => {
    const { db, txCalls } = createFakeDb([
      [configuredWebhookRow],
      [configuredWebhookRow],
      []
    ]);

    const saved = await setLogDomainWebhookRecord(
      db,
      adminAuth,
      { domainId: "domain-1", url: "https://hooks.example.com/wiseeff", enabled: true },
      { requestId: "req-test" }
    );

    expect(saved.webhook.secretConfigured).toBe(true);
    const updateCall = txCalls.find((call) => call.text.includes("update log_domains"));
    // secret !== undefined flag must be false so the stored secret is preserved.
    expect(updateCall?.values).toContain(false);
  });

  it("allows http://127.0.0.1 only when the insecure-local flag is on", async () => {
    const blocked = createFakeDb();
    await expect(
      setLogDomainWebhookRecord(
        blocked.db,
        adminAuth,
        { domainId: "domain-1", url: "http://127.0.0.1:9999/hook", enabled: false },
        { requestId: "req-test" }
      )
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });

    const allowed = createFakeDb([[domainRow], [{ ...domainRow, webhook_url: "http://127.0.0.1:9999/hook" }], []]);
    const saved = await setLogDomainWebhookRecord(
      allowed.db,
      adminAuth,
      { domainId: "domain-1", url: "http://127.0.0.1:9999/hook", enabled: false },
      { requestId: "req-test" },
      { allowInsecureLocal: true }
    );
    expect(saved.webhook.url).toBe("http://127.0.0.1:9999/hook");
  });

  it("returns 404 for unknown domains", async () => {
    const { db } = createFakeDb([[]]);
    await expect(
      setLogDomainWebhookRecord(
        db,
        adminAuth,
        { domainId: "missing", url: "https://hooks.example.com/x", enabled: false },
        { requestId: "req-test" }
      )
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("listLogDomainWebhookDeliveryRecords", () => {
  it("requires logs:admin-domains", async () => {
    const { db } = createFakeDb();
    await expect(
      listLogDomainWebhookDeliveryRecords(db, makeAuth(["logs:view"]), { domainId: "domain-1" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("returns recent delivery attempts for the domain", async () => {
    const { db } = createFakeDb([
      [domainRow],
      [
        {
          id: "delivery-1",
          log_domain_id: "domain-1",
          log_record_id: "log-1",
          run_id: "run-1",
          kind: "result",
          attempt: 1,
          status: "delivered",
          http_status: 200,
          error: null,
          created_at: "2026-08-13T02:00:00.000Z"
        }
      ]
    ]);

    const result = await listLogDomainWebhookDeliveryRecords(db, adminAuth, { domainId: "domain-1", limit: 5 });

    expect(result.items).toEqual([
      expect.objectContaining({ id: "delivery-1", kind: "result", status: "delivered", httpStatus: 200 })
    ]);
  });

  it("returns 404 for unknown domains", async () => {
    const { db } = createFakeDb([[]]);
    await expect(listLogDomainWebhookDeliveryRecords(db, adminAuth, { domainId: "missing" })).rejects.toMatchObject({
      code: "NOT_FOUND"
    });
  });
});

describe("sendLogDomainWebhookTestDelivery", () => {
  const deliverer = {
    sendTestDelivery: async () => ({ status: "delivered" as const, attempts: 1, httpStatus: 200 })
  };

  it("requires logs:admin-domains", async () => {
    const { db } = createFakeDb();
    await expect(
      sendLogDomainWebhookTestDelivery(db, makeAuth(["logs:view"]), "domain-1", deliverer, { requestId: "req-test" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("sends through the deliverer and audits the outcome", async () => {
    const { db, txCalls } = createFakeDb([
      [domainRow],
      []
    ]);

    const outcome = await sendLogDomainWebhookTestDelivery(db, adminAuth, "domain-1", deliverer, { requestId: "req-test" });

    expect(outcome).toEqual({ status: "delivered", attempts: 1, httpStatus: 200 });
    const auditCall = txCalls.find((call) => call.text.includes("insert into audit_events"));
    expect(auditCall?.values).toContain("log-domain-webhook-test");
    const metadataValue = auditCall?.values.find((value) => typeof value === "string" && value.includes("attempts"));
    expect(JSON.parse(metadataValue as string)).toMatchObject({ status: "delivered", attempts: 1, httpStatus: 200 });
  });

  it("returns 404 for unknown domains", async () => {
    const { db } = createFakeDb([[]]);
    await expect(
      sendLogDomainWebhookTestDelivery(db, adminAuth, "missing", deliverer, { requestId: "req-test" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
