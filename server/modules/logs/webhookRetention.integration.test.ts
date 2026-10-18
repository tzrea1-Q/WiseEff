import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type InMemoryTestDatabase
} from "../../testing/testDatabase";
import { pruneLogWebhookDeliveries, pruneLogWebhookOutbox } from "./webhookRetention";

const databaseAvailable = await isTestDatabaseAvailable();

describe.skipIf(!databaseAvailable)("log webhook delivery retention (integration)", () => {
  let db: InMemoryTestDatabase;

  beforeEach(async () => {
    db = await createInMemoryTestDatabase();
    await db.query(
      `insert into organizations (id, name)
       values ('retention-org-a', 'Retention A'), ('retention-org-b', 'Retention B')`
    );
    await db.query(
      `insert into log_domains (id, organization_id, name)
       values
         ('retention-domain-a1', 'retention-org-a', 'domain-a1'),
         ('retention-domain-a2', 'retention-org-a', 'domain-a2'),
         ('retention-domain-b1', 'retention-org-b', 'domain-b1')`
    );
  });

  afterEach(async () => {
    await db.rollback();
  });

  async function seedDeliveries(domainId: string, organizationId: string, ids: string[]) {
    for (const id of ids) {
      await db.query(
        `insert into log_webhook_deliveries (
           id, organization_id, log_domain_id, kind, attempt, status, created_at
         ) values ($1, $2, $3, 'test', 1, 'delivered', '2026-08-23T01:00:00.000Z')`,
        [id, organizationId, domainId]
      );
    }
  }

  async function deliveryIds(domainId: string) {
    const result = await db.query<{ id: string }>(
      `select id
       from log_webhook_deliveries
       where log_domain_id = $1
       order by created_at desc, id desc`,
      [domainId]
    );
    return result.rows.map((row) => row.id);
  }

  it("rejects unsafe retention bounds at the prune seam", async () => {
    await expect(
      pruneLogWebhookDeliveries(db, { keepPerDomain: 0, batchLimit: 1 })
    ).rejects.toThrow("keepPerDomain must be an integer between 1 and 1000000");
    await expect(
      pruneLogWebhookDeliveries(db, { keepPerDomain: 1_000_001, batchLimit: 1 })
    ).rejects.toThrow("keepPerDomain must be an integer between 1 and 1000000");
    await expect(
      pruneLogWebhookDeliveries(db, { keepPerDomain: 1, batchLimit: 0 })
    ).rejects.toThrow("batchLimit must be a positive integer");
    await expect(
      pruneLogWebhookDeliveries(db, { keepPerDomain: 1, batchLimit: 1001 })
    ).rejects.toThrow("batchLimit must be a positive integer");
  });

  it("has a stable composite retention-order index", async () => {
    const result = await db.query<{ indexdef: string }>(
      `select indexdef
       from pg_indexes
       where schemaname = 'public'
         and tablename = 'log_webhook_deliveries'
         and indexname = 'log_webhook_deliveries_domain_recent_idx'`
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].indexdef.replace(/\s+/g, " ")).toContain(
      "(organization_id, log_domain_id, created_at DESC, id DESC)"
    );
  });

  it("keeps the latest N independently per domain and converges through bounded batches", async () => {
    await seedDeliveries("retention-domain-a1", "retention-org-a", ["a1-01", "a1-02", "a1-03", "a1-04"]);
    await seedDeliveries("retention-domain-a2", "retention-org-a", ["a2-01", "a2-02", "a2-03", "a2-04"]);
    await seedDeliveries("retention-domain-b1", "retention-org-b", ["b1-01", "b1-02", "b1-03", "b1-04"]);

    expect(await pruneLogWebhookDeliveries(db, { keepPerDomain: 2, batchLimit: 2 })).toBe(6);
    const remainingAfterOneCycle = await db.query<{ count: number }>(
      `select count(*)::int as count from log_webhook_deliveries`
    );
    expect(remainingAfterOneCycle.rows[0].count).toBe(6);

    expect(await pruneLogWebhookDeliveries(db, { keepPerDomain: 2, batchLimit: 2 })).toBe(0);

    expect(await deliveryIds("retention-domain-a1")).toEqual(["a1-04", "a1-03"]);
    expect(await deliveryIds("retention-domain-a2")).toEqual(["a2-04", "a2-03"]);
    expect(await deliveryIds("retention-domain-b1")).toEqual(["b1-04", "b1-03"]);
  });

  it("retains the newest terminal outbox rows per organization/domain without pruning live work", async () => {
    for (const [domainId, organizationId] of [
      ["retention-domain-a1", "retention-org-a"],
      ["retention-domain-a2", "retention-org-a"],
      ["retention-domain-b1", "retention-org-b"]
    ]) {
      await db.query(`insert into log_file_objects
        (id, organization_id, storage_key, file_name, content_type, file_size_bytes, checksum_sha256)
        values ($1, $2, $1, 'retention.log', 'text/plain', 1, 'checksum')`, [`${domainId}-file`, organizationId]);
      await db.query(`insert into log_records (id, organization_id, file_object_id, file_name, source, status, log_domain_id)
        values ($1, $2, $3, 'retention.log', 'api', 'complete', $4)`, [`${domainId}-log`, organizationId, `${domainId}-file`, domainId]);
      for (const [suffix, status] of [
        ["01", "delivered"], ["02", "failed"], ["03", "delivered"], ["04", "failed"],
        ["05", "pending"], ["06", "retry"], ["07", "processing"]
      ]) {
        const id = `${domainId}-${suffix}`;
        await db.query(`insert into log_webhook_outbox
          (id, organization_id, log_domain_id, log_record_id, run_id, payload, status, created_at)
          values ($1, $2, $3, $4, $1, '{}'::jsonb, $5, '2026-08-23T01:00:00.000Z')`,
        [id, organizationId, domainId, `${domainId}-log`, status]);
      }
    }
    expect(await pruneLogWebhookOutbox(db, { keepPerDomain: 2, batchLimit: 1 })).toBe(6);
    expect(await pruneLogWebhookOutbox(db, { keepPerDomain: 2, batchLimit: 1 })).toBe(0);
    const remaining = await db.query<{ id: string; status: string }>(`select id, status from log_webhook_outbox order by id`);
    expect(remaining.rows).toEqual(["retention-domain-a1", "retention-domain-a2", "retention-domain-b1"].flatMap((domainId) => [
      { id: `${domainId}-03`, status: "delivered" }, { id: `${domainId}-04`, status: "failed" },
      { id: `${domainId}-05`, status: "pending" }, { id: `${domainId}-06`, status: "retry" },
      { id: `${domainId}-07`, status: "processing" }
    ]));
  });
});
