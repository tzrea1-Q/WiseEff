import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AuthContext } from "../auth/types";
import { ApiError } from "../../shared/http/errors";
import { makeTestAuthContext } from "../../testing/authContext";
import {
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type InMemoryTestDatabase
} from "../../testing/testDatabase";
import { seedCoreGraph } from "../../testing/fixtures";
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

const databaseAvailable = await isTestDatabaseAvailable();

const context = { requestId: "req-test" };

function makeAuth(permissions: string[], organizationId = "org-1"): AuthContext {
  return makeTestAuthContext({
    userId: organizationId === "org-1" ? "u-1" : "u-2",
    organizationId,
    permissions
  });
}

const adminAuth = makeAuth(["logs:view", "logs:admin-domains"]);

const ENTRY_PUBLISHED = "5f3a1f8e-52f2-4a11-9a53-0f2a5a4c1a01";
const ENTRY_SECOND = "5f3a1f8e-52f2-4a11-9a53-0f2a5a4c1a02";
const ENTRY_DRAFT = "5f3a1f8e-52f2-4a11-9a53-0f2a5a4c1a03";
const ENTRY_FOREIGN = "5f3a1f8e-52f2-4a11-9a53-0f2a5a4c1a04";

describe.skipIf(!databaseAvailable)("log domains service", () => {
  let db: InMemoryTestDatabase;

  beforeEach(async () => {
    db = await createInMemoryTestDatabase();
    await seedCoreGraph(db, {
      organization: { id: "org-1", name: "ChargeLab" },
      users: [{ id: "u-1", name: "Log Admin" }]
    });
    await seedCoreGraph(db, {
      organization: { id: "org-2", name: "OtherOrg" },
      users: [{ id: "u-2", name: "Other Admin" }]
    });
  });

  afterEach(async () => {
    await db?.rollback();
  });

  async function seedKnowledgeEntry(input: {
    id: string;
    organizationId?: string;
    title: string;
    status: "draft" | "published" | "archived";
    tags?: string[];
  }) {
    await db.query(
      `insert into knowledge_entries (
         id, organization_id, title, content_form, status, tags, source_type,
         created_by_user_id, head_revision_number, search_text, published_at
       ) values ($1::uuid, $2, $3, 'markdown', $4, $5::text[], 'human', $6, 1, $3,
                 case when $4 = 'published' then now() else null end)`,
      [
        input.id,
        input.organizationId ?? "org-1",
        input.title,
        input.status,
        input.tags ?? [],
        (input.organizationId ?? "org-1") === "org-1" ? "u-1" : "u-2"
      ]
    );
  }

  async function createDomain(name = "charging-power", description = "Charging subsystem") {
    return createLogDomainRecord(db, adminAuth, { name, description }, context);
  }

  async function domainRow(domainId: string) {
    const result = await db.query<{
      name: string;
      description: string | null;
      status: string;
      model_override: string | null;
      webhook_url: string | null;
      webhook_secret: string | null;
      webhook_enabled: boolean;
    }>(`select * from log_domains where organization_id = 'org-1' and id = $1`, [domainId]);
    return result.rows[0];
  }

  async function auditRows(kind: string) {
    const result = await db.query<{ target_id: string | null; metadata: Record<string, unknown> }>(
      `select target_id, metadata from audit_events where organization_id = 'org-1' and kind = $1 order by created_at asc, id asc`,
      [kind]
    );
    return result.rows;
  }

  describe("listLogDomainRecords", () => {
    it("requires logs:view", async () => {
      await expect(listLogDomainRecords(db, makeAuth([]), {})).rejects.toBeInstanceOf(ApiError);
    });

    it("lists active domains by default and archived ones only on request", async () => {
      const active = await createDomain("charging-power");
      const archived = await createDomain("legacy-domain");
      await archiveLogDomainRecord(db, adminAuth, archived.id, context);

      const defaults = await listLogDomainRecords(db, adminAuth, {});
      expect(defaults.items.map((item) => item.id)).toEqual([active.id]);
      expect(defaults.items[0]).toMatchObject({ name: "charging-power", status: "active" });

      const all = await listLogDomainRecords(db, adminAuth, { includeArchived: true });
      expect(all.items.map((item) => item.id).sort()).toEqual([active.id, archived.id].sort());
    });
  });

  describe("createLogDomainRecord", () => {
    it("requires logs:admin-domains", async () => {
      await expect(
        createLogDomainRecord(db, makeAuth(["logs:view"]), { name: "charging-power" }, context)
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("creates a domain and writes a log-domain-create audit event", async () => {
      const created = await createDomain();

      expect(created).toMatchObject({ name: "charging-power", description: "Charging subsystem", status: "active" });
      expect(await domainRow(created.id)).toMatchObject({
        name: "charging-power",
        description: "Charging subsystem",
        status: "active"
      });
      const audits = await auditRows("log-domain-create");
      expect(audits).toHaveLength(1);
      expect(audits[0].target_id).toBe(created.id);
      expect(audits[0].metadata).toMatchObject({ name: "charging-power", hasFormatProfile: false });
    });

    it("rejects duplicate names inside the organization with 409", async () => {
      // Same name in another tenant is legal: uniqueness is org-scoped.
      await createLogDomainRecord(db, makeAuth(["logs:view", "logs:admin-domains"], "org-2"), { name: "charging-power" }, context);
      await createDomain("charging-power");

      await expect(createDomain("charging-power")).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
    });

    it("rejects an invalid format profile with readable issues", async () => {
      await expect(
        createLogDomainRecord(
          db,
          adminAuth,
          { name: "charging-power", formatProfile: { timestampPattern: "([" } },
          context
        )
      ).rejects.toMatchObject({ code: "VALIDATION_FAILED", status: 400 });

      const rows = await db.query(`select id from log_domains where organization_id = 'org-1'`);
      expect(rows.rows).toHaveLength(0);
    });
  });

  describe("updateLogDomainRecord", () => {
    it("updates fields and audits the change", async () => {
      const domain = await createDomain();

      const updated = await updateLogDomainRecord(db, adminAuth, { domainId: domain.id, description: "updated" }, context);

      expect(updated.description).toBe("updated");
      expect((await domainRow(domain.id)).description).toBe("updated");
      const audits = await auditRows("log-domain-update");
      expect(audits).toHaveLength(1);
      expect(audits[0].target_id).toBe(domain.id);
    });

    it("rejects renaming onto an existing domain name", async () => {
      const domain = await createDomain("charging-power");
      await createDomain("other");

      await expect(
        updateLogDomainRecord(db, adminAuth, { domainId: domain.id, name: "other" }, context)
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect((await domainRow(domain.id)).name).toBe("charging-power");
    });

    it("returns 404 for unknown domains", async () => {
      await expect(
        updateLogDomainRecord(db, adminAuth, { domainId: "missing", description: "x" }, context)
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("validates a replacement format profile", async () => {
      const domain = await createDomain();

      await expect(
        updateLogDomainRecord(db, adminAuth, { domainId: domain.id, formatProfile: { unknownKey: true } }, context)
      ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    });
  });

  describe("listLogDomainKnowledgeLinkRecords", () => {
    it("requires logs:admin-domains", async () => {
      await expect(listLogDomainKnowledgeLinkRecords(db, makeAuth(["logs:view"]), "domain-1")).rejects.toMatchObject({
        code: "FORBIDDEN"
      });
    });

    it("lists links with the current entry status", async () => {
      const domain = await createDomain();
      await seedKnowledgeEntry({
        id: ENTRY_PUBLISHED,
        title: "E_THERMAL_FOLDBACK handbook",
        status: "published",
        tags: ["charging"]
      });
      await setLogDomainKnowledgeLinkRecords(
        db,
        adminAuth,
        { domainId: domain.id, knowledgeEntryIds: [ENTRY_PUBLISHED] },
        context
      );
      // Archive after linking: the stale link stays visible with the CURRENT status.
      await db.query(`update knowledge_entries set status = 'archived' where id = $1::uuid`, [ENTRY_PUBLISHED]);

      const result = await listLogDomainKnowledgeLinkRecords(db, adminAuth, domain.id);

      expect(result.items).toEqual([
        expect.objectContaining({
          knowledgeEntryId: ENTRY_PUBLISHED,
          entryTitle: "E_THERMAL_FOLDBACK handbook",
          entryStatus: "archived",
          entryTags: ["charging"]
        })
      ]);
    });

    it("returns 404 for unknown domains", async () => {
      await expect(listLogDomainKnowledgeLinkRecords(db, adminAuth, "missing")).rejects.toMatchObject({
        code: "NOT_FOUND"
      });
    });
  });

  describe("setLogDomainKnowledgeLinkRecords", () => {
    it("requires logs:admin-domains", async () => {
      await expect(
        setLogDomainKnowledgeLinkRecords(db, makeAuth(["logs:view"]), { domainId: "domain-1", knowledgeEntryIds: [] }, context)
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("replaces the link set with published entries and audits the change", async () => {
      const domain = await createDomain();
      await seedKnowledgeEntry({ id: ENTRY_PUBLISHED, title: "First handbook", status: "published" });
      await seedKnowledgeEntry({ id: ENTRY_SECOND, title: "Second handbook", status: "published" });
      await setLogDomainKnowledgeLinkRecords(
        db,
        adminAuth,
        { domainId: domain.id, knowledgeEntryIds: [ENTRY_PUBLISHED] },
        context
      );

      const result = await setLogDomainKnowledgeLinkRecords(
        db,
        adminAuth,
        { domainId: domain.id, knowledgeEntryIds: [ENTRY_SECOND] },
        context
      );

      expect(result.items).toEqual([expect.objectContaining({ knowledgeEntryId: ENTRY_SECOND })]);
      // Replacement semantics: the first link is gone from the table, not just the DTO.
      const stored = await db.query<{ knowledge_entry_id: string }>(
        `select knowledge_entry_id::text as knowledge_entry_id from log_domain_knowledge_links
         where organization_id = 'org-1' and log_domain_id = $1`,
        [domain.id]
      );
      expect(stored.rows.map((row) => row.knowledge_entry_id)).toEqual([ENTRY_SECOND]);
      // created_at is transaction-stable, so pick the replacement audit by content.
      const audits = await auditRows("log-domain-knowledge-links-update");
      expect(audits).toHaveLength(2);
      expect(audits.map((row) => row.metadata)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ linkedCount: 1, addedCount: 1, removedCount: 0 }),
          expect.objectContaining({ linkedCount: 1, addedCount: 1, removedCount: 1 })
        ])
      );
    });

    it("rejects non-published entries — publishing stays the single trust gate", async () => {
      const domain = await createDomain();
      await seedKnowledgeEntry({ id: ENTRY_DRAFT, title: "Draft notes", status: "draft" });

      await expect(
        setLogDomainKnowledgeLinkRecords(
          db,
          adminAuth,
          { domainId: domain.id, knowledgeEntryIds: [ENTRY_DRAFT] },
          context
        )
      ).rejects.toMatchObject({ code: "VALIDATION_FAILED", status: 400 });

      const stored = await db.query(
        `select id from log_domain_knowledge_links where organization_id = 'org-1' and log_domain_id = $1`,
        [domain.id]
      );
      expect(stored.rows).toHaveLength(0);
    });

    it("rejects entries missing from the organization with 404", async () => {
      const domain = await createDomain();
      // Published in ANOTHER org: tenancy makes it invisible, not just unpublished.
      await seedKnowledgeEntry({
        id: ENTRY_FOREIGN,
        organizationId: "org-2",
        title: "Foreign handbook",
        status: "published"
      });

      await expect(
        setLogDomainKnowledgeLinkRecords(
          db,
          adminAuth,
          { domainId: domain.id, knowledgeEntryIds: [ENTRY_FOREIGN] },
          context
        )
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("returns 404 for unknown domains", async () => {
      await expect(
        setLogDomainKnowledgeLinkRecords(db, adminAuth, { domainId: "missing", knowledgeEntryIds: [] }, context)
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  describe("archiveLogDomainRecord", () => {
    it("archives and audits", async () => {
      const domain = await createDomain();

      const archived = await archiveLogDomainRecord(db, adminAuth, domain.id, context);

      expect(archived.status).toBe("archived");
      expect((await domainRow(domain.id)).status).toBe("archived");
      const audits = await auditRows("log-domain-archive");
      expect(audits).toHaveLength(1);
      expect(audits[0].target_id).toBe(domain.id);
    });

    it("requires logs:admin-domains", async () => {
      await expect(archiveLogDomainRecord(db, makeAuth(["logs:view"]), "domain-1", context)).rejects.toMatchObject({
        code: "FORBIDDEN"
      });
    });
  });

  describe("updateLogDomainRecord model override", () => {
    it("saves the per-domain model override and audits the change", async () => {
      const domain = await createDomain();

      const updated = await updateLogDomainRecord(db, adminAuth, { domainId: domain.id, modelOverride: "gpt-4o" }, context);

      expect(updated.modelOverride).toBe("gpt-4o");
      expect((await domainRow(domain.id)).model_override).toBe("gpt-4o");
      const audits = await auditRows("log-domain-update");
      expect(audits[0].metadata).toMatchObject({ modelOverrideChanged: true, modelOverride: "gpt-4o" });
    });

    it("clears the override back to the global model with null or blank", async () => {
      const domain = await createDomain();
      await updateLogDomainRecord(db, adminAuth, { domainId: domain.id, modelOverride: "gpt-4o" }, context);

      const updated = await updateLogDomainRecord(db, adminAuth, { domainId: domain.id, modelOverride: "   " }, context);

      expect(updated.modelOverride).toBeUndefined();
      // Blank input is normalized to SQL NULL (clear), never stored as whitespace.
      expect((await domainRow(domain.id)).model_override).toBeNull();
    });
  });

  const secretValue = "webhook-secret-with-enough-entropy";

  describe("setLogDomainWebhookRecord", () => {
    it("requires logs:admin-domains", async () => {
      await expect(
        setLogDomainWebhookRecord(
          db,
          makeAuth(["logs:view"]),
          { domainId: "domain-1", url: "https://hooks.example.com/x", enabled: false },
          context
        )
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("rejects plain-http URLs with an explicit error code before any write", async () => {
      const domain = await createDomain();

      await expect(
        setLogDomainWebhookRecord(
          db,
          adminAuth,
          { domainId: domain.id, url: "http://hooks.example.com/x", enabled: false },
          context
        )
      ).rejects.toMatchObject({ code: "VALIDATION_FAILED", details: { reason: "webhook-url-scheme" } });

      // Nothing was written: no webhook state and no webhook-config audit row.
      expect(await domainRow(domain.id)).toMatchObject({ webhook_url: null, webhook_enabled: false });
      expect(await auditRows("log-domain-webhook-config")).toHaveLength(0);
    });

    it("rejects private/loopback/metadata address literals at save time", async () => {
      const domain = await createDomain();

      for (const url of ["https://169.254.169.254/latest", "https://10.0.0.8/hook", "https://[::1]/hook"]) {
        await expect(
          setLogDomainWebhookRecord(db, adminAuth, { domainId: domain.id, url, enabled: false }, context)
        ).rejects.toMatchObject({ code: "VALIDATION_FAILED", details: { reason: "webhook-url-private-address" } });
      }
    });

    it("rejects enabling without a URL or without a signing secret", async () => {
      const domain = await createDomain();

      await expect(
        setLogDomainWebhookRecord(db, adminAuth, { domainId: domain.id, url: null, enabled: true }, context)
      ).rejects.toMatchObject({ code: "VALIDATION_FAILED", details: { reason: "webhook-url-required" } });

      await expect(
        setLogDomainWebhookRecord(
          db,
          adminAuth,
          { domainId: domain.id, url: "https://hooks.example.com/x", enabled: true },
          context
        )
      ).rejects.toMatchObject({ code: "VALIDATION_FAILED", details: { reason: "webhook-secret-required" } });

      // The secret gate fires inside the transaction: the URL write rolled back too.
      expect(await domainRow(domain.id)).toMatchObject({ webhook_url: null, webhook_enabled: false });
    });

    it("saves the configuration, audits it, and never echoes the secret", async () => {
      const domain = await createDomain();

      const saved = await setLogDomainWebhookRecord(
        db,
        adminAuth,
        { domainId: domain.id, url: "https://hooks.example.com/wiseeff", enabled: true, secret: secretValue },
        context
      );

      expect(saved.webhook).toEqual({
        enabled: true,
        url: "https://hooks.example.com/wiseeff",
        secretConfigured: true,
        secretLastFour: secretValue.slice(-4)
      });
      expect(JSON.stringify(saved)).not.toContain(secretValue);

      // The secret lives only in the row; responses never carry it.
      expect(await domainRow(domain.id)).toMatchObject({
        webhook_url: "https://hooks.example.com/wiseeff",
        webhook_secret: secretValue,
        webhook_enabled: true
      });

      const audits = await auditRows("log-domain-webhook-config");
      expect(audits).toHaveLength(1);
      // The audit metadata records THAT the secret changed, never its value.
      expect(audits[0].metadata).toMatchObject({ secretChanged: true, enabled: true });
      expect(JSON.stringify(audits[0].metadata)).not.toContain(secretValue);
    });

    it("keeps the stored secret when the update omits it", async () => {
      const domain = await createDomain();
      await setLogDomainWebhookRecord(
        db,
        adminAuth,
        { domainId: domain.id, url: "https://hooks.example.com/wiseeff", enabled: true, secret: secretValue },
        context
      );

      const saved = await setLogDomainWebhookRecord(
        db,
        adminAuth,
        { domainId: domain.id, url: "https://hooks.example.com/wiseeff", enabled: true },
        context
      );

      expect(saved.webhook.secretConfigured).toBe(true);
      expect((await domainRow(domain.id)).webhook_secret).toBe(secretValue);
      // created_at is transaction-stable, so pick each audit by content.
      const audits = await auditRows("log-domain-webhook-config");
      expect(audits).toHaveLength(2);
      expect(audits.filter((row) => row.metadata.secretChanged === false)).toHaveLength(1);
      expect(audits.filter((row) => row.metadata.secretChanged === true)).toHaveLength(1);
    });

    it("allows http://127.0.0.1 only when the insecure-local flag is on", async () => {
      const domain = await createDomain();

      await expect(
        setLogDomainWebhookRecord(
          db,
          adminAuth,
          { domainId: domain.id, url: "http://127.0.0.1:9999/hook", enabled: false },
          context
        )
      ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });

      const saved = await setLogDomainWebhookRecord(
        db,
        adminAuth,
        { domainId: domain.id, url: "http://127.0.0.1:9999/hook", enabled: false },
        context,
        { allowInsecureLocal: true }
      );
      expect(saved.webhook.url).toBe("http://127.0.0.1:9999/hook");
      expect((await domainRow(domain.id)).webhook_url).toBe("http://127.0.0.1:9999/hook");
    });

    it("returns 404 for unknown domains", async () => {
      await expect(
        setLogDomainWebhookRecord(
          db,
          adminAuth,
          { domainId: "missing", url: "https://hooks.example.com/x", enabled: false },
          context
        )
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  describe("listLogDomainWebhookDeliveryRecords", () => {
    it("requires logs:admin-domains", async () => {
      await expect(
        listLogDomainWebhookDeliveryRecords(db, makeAuth(["logs:view"]), { domainId: "domain-1" })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("returns recent delivery attempts for the domain", async () => {
      const domain = await createDomain("charging-power");
      const otherDomain = await createDomain("other-domain");
      await db.query(
        `insert into log_webhook_deliveries (id, organization_id, log_domain_id, kind, attempt, status, http_status)
         values
           ('delivery-1', 'org-1', $1, 'result', 1, 'delivered', 200),
           ('delivery-other', 'org-1', $2, 'result', 1, 'failed', 500)`,
        [domain.id, otherDomain.id]
      );

      const result = await listLogDomainWebhookDeliveryRecords(db, adminAuth, { domainId: domain.id, limit: 5 });

      // The other domain's delivery is the scoping decoy.
      expect(result.items).toEqual([
        expect.objectContaining({ id: "delivery-1", kind: "result", status: "delivered", httpStatus: 200 })
      ]);
    });

    it("returns 404 for unknown domains", async () => {
      await expect(listLogDomainWebhookDeliveryRecords(db, adminAuth, { domainId: "missing" })).rejects.toMatchObject({
        code: "NOT_FOUND"
      });
    });
  });

  describe("sendLogDomainWebhookTestDelivery", () => {
    // The deliverer is an outbound HTTP port; it stays a test double.
    const deliverer = {
      sendTestDelivery: async () => ({ status: "delivered" as const, attempts: 1, httpStatus: 200 })
    };

    it("requires logs:admin-domains", async () => {
      await expect(
        sendLogDomainWebhookTestDelivery(db, makeAuth(["logs:view"]), "domain-1", deliverer, context)
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("sends through the deliverer and audits the outcome", async () => {
      const domain = await createDomain();

      const outcome = await sendLogDomainWebhookTestDelivery(db, adminAuth, domain.id, deliverer, context);

      expect(outcome).toEqual({ status: "delivered", attempts: 1, httpStatus: 200 });
      const audits = await auditRows("log-domain-webhook-test");
      expect(audits).toHaveLength(1);
      expect(audits[0].target_id).toBe(domain.id);
      expect(audits[0].metadata).toMatchObject({ status: "delivered", attempts: 1, httpStatus: 200 });
    });

    it("returns 404 for unknown domains", async () => {
      await expect(
        sendLogDomainWebhookTestDelivery(db, adminAuth, "missing", deliverer, context)
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });
});
