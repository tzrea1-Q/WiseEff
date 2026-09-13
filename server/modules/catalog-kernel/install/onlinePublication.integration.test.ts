import pg from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CATALOG_PUBLICATION_LOCK_ORDER } from "../../catalog-publication/authorization/types";
import {
  CATALOG_PUBLICATION_COORDINATOR_ROLE,
  CATALOG_SYNCHRONIZER_ROLE,
  quoteIdent,
} from "../security/catalogRoleManifest";
import { compileCatalogRelease } from "../compiler/index";
import { validCatalogReleaseBundle } from "../compiler/__fixtures__/catalogReleaseBundle";
import {
  createEphemeralTestDatabase,
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type EphemeralTestDatabase,
} from "../../../testing/testDatabase";
import { installCatalogRelease } from "../../../../scripts/install-catalog-release";
import { CATALOG_ACTIVATION_LOCK_ORDER } from "./lockProtocol";
import { installPublishedRelease, installPublishedReleaseForTests } from "./installer";
import {
  bootstrapFirstAcme,
  buildAuthorizedJob,
  connect,
  domainSnapshot,
  persistPredecessorArtifact,
  provisionOnlineActivation,
  PUBLISHER,
} from "./publicationTestHarness";
import { asCoordinator } from "../../catalog-publication/authorization/testHarness";
import { asQueryable } from "../../catalog-publication/persistence/integrationHarness";
import { updateJobExecution } from "../../catalog-publication/persistence/store";
import { CatalogReleaseDigest, CatalogReleaseId } from "../../parameter-catalog-contract/index";

const databaseAvailable = await isTestDatabaseAvailable();
if (!databaseAvailable) {
  throw new Error(
    "CP-05 online publication tests require a reachable real PostgreSQL server with pgvector; skipping is forbidden",
  );
}

const pgVectorInstalled = await (async () => {
  const probe = await createInMemoryTestDatabase();
  try {
    const result = await probe.query<{ installed: boolean }>(
      `select exists (select 1 from pg_catalog.pg_extension where extname = 'vector') as installed`,
    );
    return result.rows[0]?.installed === true;
  } finally {
    await probe.rollback();
  }
})();

if (!pgVectorInstalled) {
  throw new Error(
    "CP-05 online publication tests require pgvector installed in the real PostgreSQL test database; skipping is forbidden",
  );
}

describe("atomic online Catalog publication", () => {
  let database: EphemeralTestDatabase;
  let pool: pg.Pool;
  let observer: pg.Client;

  beforeEach(async () => {
    database = await createEphemeralTestDatabase("cp05onl");
    pool = new pg.Pool({ connectionString: database.url, max: 4 });
    observer = await connect(database.url);
  }, 60_000);

  afterEach(async () => {
    await observer?.end().catch(() => undefined);
    await pool?.end().catch(() => undefined);
    await database?.drop();
  });

  it("freezes exclusive pointer then publication-guard lock order", () => {
    expect(CATALOG_ACTIVATION_LOCK_ORDER).toEqual([
      "parameter_catalog.acquire_current_pointer_lock_exclusive()",
      "catalog_publication.acquire_publication_guard_lock()",
    ]);
    expect([...CATALOG_PUBLICATION_LOCK_ORDER]).toEqual([...CATALOG_ACTIVATION_LOCK_ORDER]);
  });

  it("activates a builder successor inside the kernel transaction", async () => {
    const prepared = await provisionOnlineActivation(pool, observer);
    const before = await domainSnapshot(observer);
    const result = await installPublishedRelease(pool, prepared.command);
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "installed") return;
    expect(result.value).toMatchObject({
      commandKind: "online-publication",
      currentness: "active",
      current: { id: prepared.compiled.release.id, digest: prepared.compiled.release.digest },
      previous: {
        id: prepared.candidate.expectedBaseReleaseId,
        digest: prepared.candidate.expectedBaseReleaseDigest,
      },
    });
    const after = await domainSnapshot(observer);
    expect(after.current).toBe(prepared.compiled.release.id);
    expect(after.receipts).toBe("1");
    expect(after.receiptKinds).toEqual(["online-publication"]);
    expect(after.jobStatuses).toEqual(["active"]);
    expect(after.activationAudits).toBe("1");
    expect(after.bindings).toBe(before.bindings);
    expect(after.projectValues).toBe(before.projectValues);
    expect(Number(after.releases)).toBe(Number(before.releases) + 1);
    expect(Number(after.revisions)).toBeGreaterThan(Number(before.revisions));
    const audit = await observer.query<{ kind: string; action: string; app: string }>(
      `select kind, action, app from public.audit_events where kind = 'catalog-activation'`,
    );
    expect(audit.rows).toEqual([
      { kind: "catalog-activation", action: "online-publication", app: "catalog-publication" },
    ]);
  });

  it.each(["subjects", "receipt", "pointer", "job-status"] as const)(
    "rolls back catalog and receipts when activation fails after %s",
    async (stage) => {
      const prepared = await provisionOnlineActivation(pool, observer);
      const before = await domainSnapshot(observer);
      const result = await installPublishedRelease(pool, prepared.command, { failAfter: stage });
      expect(result.ok).toBe(false);
      expect(await domainSnapshot(observer)).toEqual(before);
    },
  );

  it("rejects a tampered staged projection even when the writer fingerprint is intact", async () => {
    const prepared = await provisionOnlineActivation(pool, observer, "iin_tamp");
    const before = await domainSnapshot(observer);
    const result = await installPublishedReleaseForTests(pool, prepared.command, {
      afterMaterialize: async (client) => {
        await client.query(
          `insert into parameter_catalog.catalog_subjects (
             id, introduced_release_id, kind, canonical_key
           ) values ('csub_forged_cp05', $1, 'node-type', 'forged-cp05')`,
          [prepared.compiled.release.id],
        );
        await client.query(
          `insert into parameter_catalog.catalog_node_types (subject_id) values ('csub_forged_cp05')`,
        );
        await client.query(
          `insert into parameter_catalog.catalog_release_subjects (
             release_id, subject_id, lifecycle, selector_snapshot, selector_provenance, tombstone_provenance
           ) values (
             $1, 'csub_forged_cp05', 'active',
             '{"kind":"node-type-name","value":"forged-cp05"}'::jsonb,
             '{"source":"forged"}'::jsonb,
             null
           )`,
          [prepared.compiled.release.id],
        );
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("drift");
    }
    expect(await domainSnapshot(observer)).toEqual(before);
  });

  it("lets one of two same-predecessor candidates commit and returns needs-rebase for the other", async () => {
    const predecessor = await bootstrapFirstAcme(pool);
    await persistPredecessorArtifact(observer, predecessor);
    const first = await buildAuthorizedJob(observer, {
      predecessorDigest: predecessor.digest,
      propertyKey: "iin_min",
    });
    const second = await buildAuthorizedJob(observer, {
      predecessorDigest: predecessor.digest,
      propertyKey: "iin_nom",
      enablePolicy: false,
    });
    const poolB = new pg.Pool({ connectionString: database.url, max: 2 });
    try {
      const [left, right] = await Promise.all([
        installPublishedRelease(pool, first.command),
        installPublishedRelease(poolB, second.command),
      ]);
      const outcomes = [left, right];
      const installed = outcomes.filter(
        (outcome) => outcome.ok && outcome.value.status === "installed",
      );
      const rebased = outcomes.filter(
        (outcome) => !outcome.ok && outcome.error.kind === "needs-rebase",
      );
      expect(installed).toHaveLength(1);
      expect(rebased).toHaveLength(1);
      const current = await domainSnapshot(observer);
      expect(current.receipts).toBe("1");
      expect(["1", "2"]).toContain(current.releases);
      expect(current.receiptKinds).toEqual(["online-publication"]);
    } finally {
      await poolB.end();
    }
  });

  it("returns the matching receipt when the same job is submitted concurrently", async () => {
    const prepared = await provisionOnlineActivation(pool, observer, "iin_same");
    const poolB = new pg.Pool({ connectionString: database.url, max: 2 });
    try {
      const [left, right] = await Promise.all([
        installPublishedRelease(pool, prepared.command),
        installPublishedRelease(poolB, prepared.command),
      ]);
      expect(left.ok).toBe(true);
      expect(right.ok).toBe(true);
      if (!left.ok || !right.ok) return;
      const statuses = [left.value.status, right.value.status].sort();
      expect(statuses).toEqual(["already-recorded", "installed"].sort());
      const receipts = await observer.query(
        `select count(*)::text as count from parameter_catalog.catalog_activation_receipts`,
      );
      expect(receipts.rows[0]?.count).toBe("1");
      const revisions = await observer.query(
        `select count(*)::text as count from parameter_catalog.definition_revisions
          where catalog_release_id = $1`,
        [prepared.compiled.release.id],
      );
      expect(revisions.rows[0]?.count).toBe("1");
    } finally {
      await poolB.end();
    }
  });

  it("refuses a stale fencing token before catalog side effects", async () => {
    const prepared = await provisionOnlineActivation(pool, observer, "iin_fence");
    await asCoordinator(observer, async () =>
      updateJobExecution(asQueryable(observer), prepared.job.id, {
        fencingToken: 1,
        expectedFencingToken: 0,
        status: "running",
      }),
    );
    const before = await domainSnapshot(observer);
    const result = await installPublishedRelease(pool, prepared.command);
    expect(result).toMatchObject({
      ok: false,
      error: { kind: "fencing-token-mismatch", expected: 0, actual: 1 },
    });
    expect(await domainSnapshot(observer)).toEqual(before);
  });

  it("fail-closes omitted impact facts as high risk for a self-approver", async () => {
    const prepared = await provisionOnlineActivation(pool, observer, "iin_omit");
    const before = await domainSnapshot(observer);
    const { impactFacts: _ignored, ...withoutFacts } = prepared.command;
    const result = await installPublishedRelease(pool, withoutFacts);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatchObject({
        kind: "publication-not-authorized",
        reason: "publication-self-approval-forbidden",
      });
    }
    expect(await domainSnapshot(observer)).toEqual(before);
  });

  it("blocks unauthorized CLI advance after regime even when publication_enabled is false", async () => {
    const predecessor = await bootstrapFirstAcme(pool);
    await persistPredecessorArtifact(observer, predecessor);
    const adopted = await installPublishedRelease(pool, {
      mode: "adopted-preexisting",
      expectedCurrent: {
        id: CatalogReleaseId(predecessor.compiled.release.id),
        digest: CatalogReleaseDigest(predecessor.digest),
      },
      actorPrincipalId: PUBLISHER,
      adoptionEvidence: {
        source_bundle_digest: predecessor.digest,
        verification_digest: predecessor.compiled.materializationFingerprint,
        data_mode: "populated",
        collected_at: "2026-09-12T00:00:00.000Z",
        approved_by: PUBLISHER,
      },
    });
    expect(adopted.ok).toBe(true);

    const successor = compileCatalogRelease(validCatalogReleaseBundle());
    if (!successor.ok) throw new Error("successor fixture failed");
    await expect(
      installCatalogRelease(
        pool,
        {
          mode: "advance",
          filename: "-",
          expectedTargetDigest: successor.value.aggregateDigest,
          expectedCurrentId: predecessor.compiled.release.id,
          expectedCurrentDigest: predecessor.digest,
        },
        validCatalogReleaseBundle(),
      ),
    ).rejects.toThrow("catalog-install-publication-regime-required");

    await observer.query("begin");
    await observer.query(`set local role ${quoteIdent("catalog_migration_owner")}`);
    await observer.query(
      `select catalog_publication.revise_publication_policy(false, false, 'catalog-capability/v1', $1)`,
      [PUBLISHER],
    );
    await observer.query("commit");
    await observer.query("reset role");

    await expect(
      installCatalogRelease(
        pool,
        {
          mode: "advance",
          filename: "-",
          expectedTargetDigest: successor.value.aggregateDigest,
          expectedCurrentId: predecessor.compiled.release.id,
          expectedCurrentDigest: predecessor.digest,
        },
        validCatalogReleaseBundle(),
      ),
    ).rejects.toThrow("catalog-install-publication-regime-required");

    const pointer = await domainSnapshot(observer);
    expect(pointer.current).toBe(predecessor.compiled.release.id);
    expect(pointer.receiptKinds).toEqual(["adopted-preexisting"]);
  });

  it("commit-layer pointer guard rejects a receipt-less advance after regime", async () => {
    const predecessor = await bootstrapFirstAcme(pool);
    await persistPredecessorArtifact(observer, predecessor);
    await installPublishedRelease(pool, {
      mode: "adopted-preexisting",
      expectedCurrent: {
        id: CatalogReleaseId(predecessor.compiled.release.id),
        digest: CatalogReleaseDigest(predecessor.digest),
      },
      actorPrincipalId: PUBLISHER,
      adoptionEvidence: {
        source_bundle_digest: predecessor.digest,
        verification_digest: predecessor.compiled.materializationFingerprint,
        data_mode: "populated",
        collected_at: "2026-09-12T00:00:00.000Z",
        approved_by: PUBLISHER,
      },
    });
    const forged = await observer.query(
      `insert into parameter_catalog.catalog_releases (
         id, release_sequence, release_version, release_digest,
         compiled_model_digest, toolchain_digest, published_at
       ) values ('crel_forged_cp05', 99, '9.9.9', $1, $1, $1, '2026-09-12T00:00:00Z')
       returning id`,
      [CatalogReleaseDigest(`sha256:${"c".repeat(64)}`)],
    );
    await expect(
      observer.query(
        `update parameter_catalog.catalog_state
            set current_catalog_release_id = $1
          where singleton`,
        [forged.rows[0]!.id],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("grants mark_job_activated and activation audit append only to the synchronizer", async () => {
    const granted = await observer.query<{
      job_synchronizer: boolean;
      job_coordinator: boolean;
      job_public: boolean;
      audit_synchronizer: boolean;
      audit_coordinator: boolean;
      audit_public: boolean;
    }>(
      `select
         pg_catalog.has_function_privilege($1, 'catalog_publication.mark_job_activated(text,bigint)', 'execute') as job_synchronizer,
         pg_catalog.has_function_privilege($2, 'catalog_publication.mark_job_activated(text,bigint)', 'execute') as job_coordinator,
         pg_catalog.has_function_privilege('public', 'catalog_publication.mark_job_activated(text,bigint)', 'execute') as job_public,
         pg_catalog.has_function_privilege($1, 'catalog_publication.append_activation_success_audit(text,text,text,text,jsonb,text)', 'execute') as audit_synchronizer,
         pg_catalog.has_function_privilege($2, 'catalog_publication.append_activation_success_audit(text,text,text,text,jsonb,text)', 'execute') as audit_coordinator,
         pg_catalog.has_function_privilege('public', 'catalog_publication.append_activation_success_audit(text,text,text,text,jsonb,text)', 'execute') as audit_public`,
      [CATALOG_SYNCHRONIZER_ROLE, CATALOG_PUBLICATION_COORDINATOR_ROLE],
    );
    expect(granted.rows).toEqual([
      {
        job_synchronizer: true,
        job_coordinator: false,
        job_public: false,
        audit_synchronizer: true,
        audit_coordinator: false,
        audit_public: false,
      },
    ]);
  });
});
