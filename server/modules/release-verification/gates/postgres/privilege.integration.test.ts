import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createReleaseVerificationService } from "../../core/service";
import { digestOf } from "../../core/digest";
import type { PrepareVerificationInput } from "../../core/types";
import {
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type InMemoryTestDatabase,
} from "../../../../testing/testDatabase";
import {
  CATALOG_MIGRATION_OWNER,
  CATALOG_PUBLICATION_COORDINATOR_ROLE,
  CATALOG_SYNCHRONIZER_ROLE,
  PARAMETER_GOVERNANCE_WRITER_ROLE,
} from "../../../catalog-kernel/security/catalogRoleManifest";
import { createPostgresGateAdapters, loadPackagedMigrationInventory } from "./index";
import { DEFAULT_MIGRATIONS_DIR } from "./inventory";
import { catalogRelation, quoteIdent } from "./relations";
import { runP01, runP02 } from "./privilegeGates";

const databaseAvailable = await isTestDatabaseAvailable();
if (!databaseAvailable) {
  throw new Error(
    "S10-VMP privilege tests require a reachable real PostgreSQL server with pgvector; skipping is forbidden",
  );
}

const pgVectorInstalled = await (async () => {
  const probe = await createInMemoryTestDatabase();
  try {
    const result = await probe.query<{ installed: boolean }>(
      `select exists (
         select 1 from pg_catalog.pg_extension where extname = 'vector'
       ) as installed`,
    );
    return result.rows[0]?.installed === true;
  } finally {
    await probe.rollback();
  }
})();

if (!pgVectorInstalled) {
  throw new Error(
    "S10-VMP privilege tests require pgvector installed in the real PostgreSQL test database; skipping is forbidden",
  );
}

const emptySourceSnapshot = digestOf({
  archives: 0,
  identities: 0,
  ledger: 0,
  mappings: 0,
  registrations: 0,
});

const validPrepare = (
  inventoryDigest: string,
  schemaVersion: string,
  targetId: string,
): PrepareVerificationInput => ({
  subject: {
    targetId,
    deploymentClass: "self-hosted",
    environmentId: "env-isolated",
  },
  purpose: "pre-activation",
  mode: "fresh",
  lineage: {
    phaseSnapshot: "P11",
    predecessorReportDigests: [],
    p12State: "not-started",
    p13State: "not-started",
    writerRetirementFingerprint: null,
    runtimePinGeneration: null,
    pointerRollbackStatus: "open",
    trafficIsolationState: "isolated",
  },
  pins: {
    artifact: {
      gitSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      releaseTag: "v-s10-vmp",
      packageManifestDigest: "sha256:pkg",
      apiImageDigest: "sha256:api",
      workerImageDigest: "sha256:worker",
      webImageDigest: "sha256:web",
    },
    catalog: {
      releaseId: "",
      releaseDigest: "",
      compiledModelDigest: "",
      materializationFingerprint: "",
    },
    database: {
      targetIdentity: "pg-s10-vmp",
      schemaVersion,
      migrationInventoryDigest: inventoryDigest,
    },
    cutover: {
      planDigest: "sha256:cutover",
      contractVersion: "v1",
      sourceSnapshotFingerprint: emptySourceSnapshot,
    },
    mappingArchive: {
      mappingEpoch: "epoch-1",
      mappingHeadDigest: "sha256:map",
      archiveManifestDigest: "sha256:archive",
    },
    recovery: {
      recoveryPointId: "rp-1",
      recoveryPointDigest: "sha256:rp",
    },
    acceptance: {
      openApiDigest: "sha256:openapi",
      browserBundleSha: "sha256:browser",
    },
    target: {
      deploymentId: "deploy-1",
      hostFingerprint: "sha256:host",
    },
    verification: {
      contractVersion: "s10-vmp",
      verifierRole: "catalog_verifier",
    },
  },
  evidenceRequirements: {
    recoveryPointDigest: "sha256:rp",
    mappingEpoch: "epoch-1",
    cutoverPlanDigest: "sha256:cutover",
    acceptanceContractDigest: "sha256:accept",
  },
});

const expectOk = <T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T => {
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (!result.ok) {
    throw new Error("expected ok");
  }
  return result.value;
};

describe("P01/P02 SQLSTATE privilege gates", () => {
  let db: InMemoryTestDatabase;
  let inventoryDigest: string;
  let schemaVersion: string;

  beforeAll(async () => {
    db = await createInMemoryTestDatabase();
    const inventory = await loadPackagedMigrationInventory(DEFAULT_MIGRATIONS_DIR);
    inventoryDigest = inventory.digest;
    schemaVersion = inventory.schemaVersionPrefix;
  }, 60_000);

  afterAll(async () => {
    await db.rollback();
  });

  it("captures SQLSTATE 42501 for forbidden Catalog and legacy writes", async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx.query(`set local role ${quoteIdent(PARAMETER_GOVERNANCE_WRITER_ROLE)}`);
        await tx.query(`select * from ${catalogRelation("catalog_state")}`);
      }),
    ).rejects.toMatchObject({ code: "42501" } satisfies Partial<pg.DatabaseError>);

    const p01 = await runP01(db);
    expect(p01.status).toBe("passed");
    expect(p01.failureCode).toBeNull();
    const p02 = await runP02(db);
    expect(p02.status).toBe("passed");
    expect(p02.failureCode).toBeNull();

    const service = createReleaseVerificationService({
      db,
      adapters: createPostgresGateAdapters({ db }),
    });
    const plan = expectOk(
      await service.prepareVerification(
        validPrepare(inventoryDigest, schemaVersion, "target-s10-vmp-priv"),
      ),
    );
    const attempt = expectOk(await service.runVerification(plan.digest));
    expect(attempt.results.find((result) => result.gateId === "PCAT-DB-P01")?.status).toBe("passed");
    expect(attempt.results.find((result) => result.gateId === "PCAT-DB-P02")?.status).toBe("passed");
  }, 60_000);

  it("rejects reviewed tombstone definer body or grant drift", async () => {
    const identity = "parameter_catalog.insert_reviewed_member_tombstone(text,text,text,text,text,text,text,jsonb,text,jsonb,text)";
    const definition = await db.query<{ sql: string }>(
      `select pg_catalog.pg_get_functiondef($1::regprocedure) as sql`, [identity],
    );
    const original = definition.rows[0]!.sql;
    const edited = original.replace(
      "Reviewed member removal has no exact user audit receipt",
      "Altered reviewed member removal has no exact user audit receipt",
    );
    expect(edited).not.toBe(original);

    for (const drift of [
      edited,
      `grant execute on function ${identity} to public`,
    ]) {
      await db.query("savepoint p02_reviewed_definer_drift");
      try {
        await db.query(drift);
        const result = await runP02(db);
        expect(result.status).toBe("failed");
        expect(result.failureCode).toBe("PCAT-PRIV-LEGACY-WRITER-BYPASS");
      } finally {
        await db.query("rollback to savepoint p02_reviewed_definer_drift");
        await db.query("release savepoint p02_reviewed_definer_drift");
      }
    }
  }, 60_000);

  /**
   * The documented role model (`docs/SECURITY.md`) gives the API login a NOINHERIT
   * membership in `parameter_governance_writer_role` and the publication manager one in
   * `catalog_synchronizer_role`, precisely so the composition roots may `SET LOCAL ROLE`.
   * P01 must accept those and reject the two real bypass shapes: a login that *inherits*
   * a privileged role, and any login member of the schema-owning migration owner.
   */
  it("accepts documented NOINHERIT memberships and rejects inheritance and schema ownership", async () => {
    const token = (process.env.WISEEFF_TEST_RUN_TOKEN ?? `pid${process.pid}`).replace(/[^a-z0-9]/giu, "");
    const writerLogin = `p01_writer_${token}`;
    const managerLogin = `p01_manager_${token}`;
    const coordinatorLogin = `p01_coord_${token}`;
    const inheritingLogin = `p01_inherit_${token}`;
    const ownerLogin = `p01_owner_${token}`;
    const created: string[] = [];
    const createLogin = async (name: string, inherit: boolean) => {
      // Roles are cluster-global and do not roll back with this fixture, so a run killed
      // before its `finally` can leave the name behind; converge instead of failing.
      await db.query(`drop role if exists ${quoteIdent(name)}`).catch(() => undefined);
      await db.query(
        `create role ${quoteIdent(name)} login ${inherit ? "inherit" : "noinherit"}
         nosuperuser nocreatedb nocreaterole nobypassrls`,
      );
      created.push(name);
    };
    try {
      await createLogin(writerLogin, false);
      await db.query(`grant ${quoteIdent(PARAMETER_GOVERNANCE_WRITER_ROLE)} to ${quoteIdent(writerLogin)}`);
      await createLogin(managerLogin, false);
      await db.query(`grant ${quoteIdent(CATALOG_SYNCHRONIZER_ROLE)} to ${quoteIdent(managerLogin)}`);
      // The provisioner really does grant coordinator to the API login; P01 does not cover
      // it, and this asserts that boundary rather than leaving it implicit.
      await createLogin(coordinatorLogin, false);
      await db.query(
        `grant ${quoteIdent(CATALOG_PUBLICATION_COORDINATOR_ROLE)} to ${quoteIdent(coordinatorLogin)}`,
      );
      const documented = await runP01(db);
      expect(documented.status).toBe("passed");
      expect(documented.failureCode).toBeNull();

      await createLogin(inheritingLogin, true);
      await db.query(`grant ${quoteIdent(CATALOG_SYNCHRONIZER_ROLE)} to ${quoteIdent(inheritingLogin)}`);
      const inheriting = await runP01(db);
      expect(inheriting.status).toBe("failed");
      expect(inheriting.failureCode).toBe("PCAT-PRIV-CATALOG-IMMUTABILITY-BYPASS");

      await db.query(`revoke ${quoteIdent(CATALOG_SYNCHRONIZER_ROLE)} from ${quoteIdent(inheritingLogin)}`);
      const afterRevoke = await runP01(db);
      expect(afterRevoke.status).toBe("passed");

      // NOINHERIT is not enough for the schema owner: any login membership is an
      // assume path. Revoking it again proves that membership is the cause rather than
      // some unrelated cluster state.
      await createLogin(ownerLogin, false);
      await db.query(`grant ${quoteIdent(CATALOG_MIGRATION_OWNER)} to ${quoteIdent(ownerLogin)}`);
      const owner = await runP01(db);
      expect(owner.status).toBe("failed");
      expect(owner.failureCode).toBe("PCAT-PRIV-CATALOG-IMMUTABILITY-BYPASS");
      await db.query(`revoke ${quoteIdent(CATALOG_MIGRATION_OWNER)} from ${quoteIdent(ownerLogin)}`);
      const afterOwnerRevoke = await runP01(db);
      expect(afterOwnerRevoke.status).toBe("passed");
    } finally {
      for (const name of created) {
        await db.query(`drop role if exists ${quoteIdent(name)}`).catch(() => undefined);
      }
    }
  }, 60_000);
});
