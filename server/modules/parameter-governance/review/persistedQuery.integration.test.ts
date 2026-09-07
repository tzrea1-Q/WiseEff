import { randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertOwnedUpgradeTestTarget } from "../../../../scripts/upgrade-test-target";
import { createMigratedSelfHostedPg16Database } from "../../../testing/selfHostedUpgrade/database";
import { compileCatalogRelease } from "../../catalog-kernel/compiler";
import { validCatalogReleaseBundle } from "../../catalog-kernel/compiler/__fixtures__/catalogReleaseBundle";
import { installPublishedRelease } from "../../catalog-kernel/install/installer";
import { jsonCatalogReleaseSource, type CatalogReleasePin } from "../../catalog-kernel/interface";
import { createEvidenceIngest } from "../evidence";
import { createPersistedReviewQueueReader, createReviewQueueReader } from "./index";
import { cleanupPersistedReviewFixture } from "./persistedQuery.fixture";

// This selector intentionally uses cluster-global test logins. It requires the
// parent's owned target and must not be run in the ambient backend worker lane.
assertOwnedUpgradeTestTarget();
describe("actual persisted Review Queue projection", () => {
  let database: Awaited<ReturnType<typeof createMigratedSelfHostedPg16Database>>;
  let admin: pg.Pool;
  let readerPool: pg.Pool;
  let pin: CatalogReleasePin;
  const login = `review_projection_${randomBytes(8).toString("hex")}`;
  const password = randomBytes(24).toString("hex");
  let roleCreated = false;
  const query = () => ({ organizationId: "persisted-review-org", capturedRelease: pin,
    context: { actorKind: "org-admin" as const, organizationId: "persisted-review-org", principalId: "persisted-review-admin" } });
  async function state() {
    const results = await Promise.all([
      admin.query("select * from parameter_catalog.parameter_review_items order by id"),
      admin.query("select * from parameter_catalog.parameter_review_evidence order by id"),
    ]);
    return JSON.stringify(results.map(result => result.rows));
  }
  beforeAll(async () => {
    database = await createMigratedSelfHostedPg16Database("reviewpersisted");
    admin = new pg.Pool({ connectionString: database.url, max: 2 });
    const bundle = validCatalogReleaseBundle();
    const compiled = compileCatalogRelease(bundle);
    if (!compiled.ok) throw new Error("review-fixture-compile-failed");
    const installed = await installPublishedRelease(admin, { mode: "bootstrap", source: jsonCatalogReleaseSource(bundle),
      expectedTargetDigest: compiled.value.aggregateDigest });
    if (!installed.ok) throw new Error(`review-fixture-install-failed:${installed.error.kind}`);
    pin = { id: compiled.value.release.id, digest: compiled.value.release.digest };
    await admin.query("insert into public.organizations(id,name) values('persisted-review-org','Synthetic review organization')");
    // Test-only login uses two existing 0138 capabilities; no capability role or
    // table grant is changed. This identity is not approved for API startup.
    await admin.query(`create role ${pg.escapeIdentifier(login)} login nosuperuser nobypassrls nocreatedb nocreaterole noreplication password ${pg.escapeLiteral(password)}`);
    roleCreated = true;
    await admin.query(`grant catalog_synchronizer_role, parameter_governance_writer_role to ${pg.escapeIdentifier(login)} with inherit true, set false, admin false`);
    await admin.query(`alter role ${pg.escapeIdentifier(login)} set default_transaction_read_only=on`);
    const url = new URL(database.url);
    url.username = login; url.password = password;
    readerPool = new pg.Pool({ connectionString: url.toString(), max: 1 });
  });
  afterAll(async () => {
    await cleanupPersistedReviewFixture([
      ["reader-pool", async () => { await readerPool?.end(); }],
      ["reader-role", async () => { if (roleCreated) await admin.query(`drop role ${pg.escapeIdentifier(login)}`); }],
      ["admin-pool", async () => { await admin?.end(); }],
      ["database", async () => { await database?.close(); }],
    ]);
  });
  it("uses a real restricted login and returns a genuinely empty prepared state", async () => {
    const facts = (await readerPool.query("select current_user as name, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole from pg_catalog.pg_roles where rolname=current_user")).rows[0];
    expect(facts).toEqual({ name: login, rolsuper: false, rolbypassrls: false, rolcreatedb: false, rolcreaterole: false });
    expect(await createPersistedReviewQueueReader(readerPool).list(query())).toMatchObject({ ok: true, value: { items: [], emptyReason: "no-review-work" } });
  });
  it("refuses unprepared evidence, then matches the real prepared list and detail without writes", async () => {
    const ingested = await createEvidenceIngest(admin).ingest({ organizationId: query().organizationId,
      sourceIdentity: "persisted-source", catalogReleaseId: pin.id, matcherRevision: "persisted-matcher",
      matcherOutput: { status: "unknown" }, evidence: { propertyKey: "persisted-key", note: "private-review-marker" }, provenance: null });
    expect(ingested.ok).toBe(true);
    const before = await state();
    const reader = createPersistedReviewQueueReader(readerPool);
    await expect(reader.list(query())).rejects.toMatchObject({ code: "review-queue-projection-unavailable" });
    expect(await state()).toBe(before);
    const prepared = await createReviewQueueReader(admin).list(query());
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const preparedState = await state();
    const projected = await reader.list(query());
    expect(projected).toEqual(prepared);
    const detail = await reader.get({ ...query(), reviewItemId: prepared.value.items[0]!.id });
    expect(detail).toEqual({ ok: true, value: prepared.value.items[0] });
    expect(JSON.stringify(projected)).not.toContain("private-review-marker");
    expect(await state()).toBe(preparedState);
  });
  it("refuses cross-organization, Agent and stale-pin calls without changing rows", async () => {
    const reader = createPersistedReviewQueueReader(readerPool);
    const before = await state();
    expect(await reader.list({ ...query(), organizationId: "foreign" })).toMatchObject({ ok: false, error: { kind: "permission-denied" } });
    expect(await reader.list({ ...query(), context: { actorKind: "agent", principalId: "agent" } })).toMatchObject({ ok: false, error: { kind: "permission-denied" } });
    expect(await reader.list({ ...query(), capturedRelease: { ...pin, digest: `sha256:${"f".repeat(64)}` as CatalogReleasePin["digest"] } })).toMatchObject({ ok: false, error: { kind: "stale-candidate" } });
    expect(await state()).toBe(before);
  });
  it("does not replace missing Review SELECT capability with an empty queue", async () => {
    const before = await state();
    await admin.query(`revoke parameter_governance_writer_role from ${pg.escapeIdentifier(login)}`);
    try {
      await expect(createPersistedReviewQueueReader(readerPool).list(query())).rejects.toMatchObject({ code: "review-queue-projection-unavailable" });
      expect(await state()).toBe(before);
    } finally {
      await admin.query(`grant parameter_governance_writer_role to ${pg.escapeIdentifier(login)} with inherit true, set false, admin false`);
    }
  });
  it("the unchanged 0140 reader capability cannot read Review rows or create groups", async () => {
    const limitedLogin = `${login}_limited`;
    let limitedPool: pg.Pool | undefined;
    let created = false;
    let operationFailed = false;
    let operationFailure: unknown;
    const before = await state();
    try {
      await admin.query(`create role ${pg.escapeIdentifier(limitedLogin)} login nosuperuser nobypassrls nocreatedb nocreaterole noreplication password ${pg.escapeLiteral(password)}`);
      created = true;
      await admin.query(`grant catalog_runtime_reader_role to ${pg.escapeIdentifier(limitedLogin)} with inherit true, set false, admin false`);
      const url = new URL(database.url); url.username = limitedLogin; url.password = password;
      limitedPool = new pg.Pool({ connectionString: url.toString(), max: 1 });
      await expect(createPersistedReviewQueueReader(limitedPool).list(query())).rejects.toMatchObject({ code: "review-queue-projection-unavailable" });
      expect(await state()).toBe(before);
    } catch (error) {
      operationFailed = true;
      operationFailure = error;
      throw error;
    } finally {
      try {
        await cleanupPersistedReviewFixture([
          ["reader-pool", async () => { await limitedPool?.end(); }],
          ["reader-role", async () => { if (created) await admin.query(`drop role ${pg.escapeIdentifier(limitedLogin)}`); }],
        ]);
      } catch (cleanupFailure) {
        if (operationFailed) {
          throw new AggregateError([operationFailure, cleanupFailure], "review-fixture-operation-and-cleanup-failed");
        }
        throw cleanupFailure;
      }
    }
  });
});
