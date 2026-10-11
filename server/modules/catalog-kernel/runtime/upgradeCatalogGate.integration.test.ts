import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runReconcileParameterDefinitions } from "../../../../scripts/reconcile-parameter-definitions";
import { createPostgresDatabase, getRootPostgresPool } from "../../../shared/database/client";
import { createManagedInstanceTestDatabase, withTestClusterRoleCatalogLock } from "../../../testing/testDatabase";
import { provisionPublicationRuntimeLogins } from "../../../testing/labRuntimeLogins";
import { seedPublishedCatalog } from "../../../testing/parameterCatalog/seedPublishedCatalog";
import { firstReleaseBundle } from "./catalogChain.fixture";
import { refreshReleaseAggregateDigest } from "../compiler/__fixtures__/catalogReleaseBundle";
import { compileCatalogRelease } from "../compiler";
import { jsonCatalogReleaseSource } from "../interface";
import { installPublishedRelease } from "../install/installer";

describe("parameter-definitions:check current Catalog gate", () => {
  let database: Awaited<ReturnType<typeof createManagedInstanceTestDatabase>>;
  let owner: ReturnType<typeof createPostgresDatabase>;
  let runtime: Awaited<ReturnType<typeof provisionPublicationRuntimeLogins>>;
  let adminUrl: string;
  const runToken = `gate${randomBytes(5).toString("hex")}`;

  beforeAll(async () => {
    database = await createManagedInstanceTestDatabase("gate");
    const admin = new URL(database.url);
    admin.pathname = "/postgres";
    adminUrl = admin.href;
    owner = createPostgresDatabase(database.url);
    runtime = await provisionPublicationRuntimeLogins(database.url, {
      mode: "lab", runToken,
      names: { api: "wiseeff_api", worker: `wiseeff_${runToken}_worker`, manager: `wiseeff_${runToken}_manager` },
    });
  });

  afterAll(async () => {
    await owner?.close();
    if (database) {
      await database.drop();
      await withTestClusterRoleCatalogLock(async () => {
        const admin = createPostgresDatabase(adminUrl);
        try {
          for (const role of ["wiseeff_api", `wiseeff_${runToken}_worker`, `wiseeff_${runToken}_manager`]) {
            const owned = await admin.query("select rolname from pg_roles where rolname=$1 and shobj_description(oid,'pg_authid')=$2", [
              role, `wiseeff-publication-runtime:lab:${runToken}`,
            ]);
            if (owned.rows.length) await admin.query(`drop role "${role}"`);
          }
        } finally {
          await admin.close();
        }
      });
    }
  });

  const check = (args: readonly string[] = ["--catalog-only"], url = runtime.apiUrl) =>
    runReconcileParameterDefinitions(["--verify", ...args], { ...process.env, DATABASE_URL: url });

  it("rejects an absent current release with a clear reason using wiseeff_api", async () => {
    const result = await check();
    expect(result.exitCode).toBe(1);
    expect(JSON.stringify(result.body)).toMatch(/current.*catalog.*(absent|missing)/i);
  });

  it("accepts a valid published crel_seed_* release using wiseeff_api", async () => {
    const bundle = structuredClone(firstReleaseBundle());
    const release = bundle.releases[0]!;
    Object.assign(release.manifest.release, { id: "crel_seed_upgrade_gate", version: "2.1.0-seed.upgrade-gate" });
    Object.assign(bundle, { targetReleaseId: "crel_seed_upgrade_gate" });
    refreshReleaseAggregateDigest(release as Parameters<typeof refreshReleaseAggregateDigest>[0]);
    const compiled = compileCatalogRelease(bundle);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) throw new Error("Seed fixture failed compilation");
    const installed = await installPublishedRelease(getRootPostgresPool(owner)!, {
      mode: "bootstrap", source: jsonCatalogReleaseSource(bundle), expectedTargetDigest: compiled.value.aggregateDigest,
    });
    expect(installed.ok).toBe(true);
    const result = await check();
    expect(result.exitCode).toBe(0);
    expect(result.body).toMatchObject({ status: "value", value: { releaseId: "crel_seed_upgrade_gate", digest: compiled.value.release.digest } });
  });

  it("rejects a missing required report in ordinary verification", async () => {
    const result = await check(["--report-id", "vreport_missing"], database.url);
    expect(result.exitCode).toBe(1);
    expect(result.body).toMatchObject({ status: "value", value: { kind: "absent", reason: "missing" } });
  });

  it("rejects a missing required report even with a valid current Catalog", async () => {
    const result = await check(["--catalog-only", "--report-id", "vreport_missing"], database.url);
    expect(result.exitCode).toBe(1);
    expect(result.body).toMatchObject({ status: "value", value: { kind: "absent", reason: "missing" } });
  });

  it("rejects invalid current materialization instead of accepting its pointer", async () => {
    await owner.transaction(async (transaction) => {
      await transaction.query("set local session_replication_role=replica");
      await transaction.query("delete from parameter_catalog.catalog_materializations where release_id=$1", ["crel_seed_upgrade_gate"]);
    });
    const result = await check();
    expect(result.exitCode).toBe(1);
    expect(JSON.stringify(result.body)).toMatch(/current.*catalog.*invalid/i);
  });

  it("accepts a valid vendor release using wiseeff_api", async () => {
    const vendorDatabase = await createManagedInstanceTestDatabase("vendor");
    const vendorOwner = createPostgresDatabase(vendorDatabase.url);
    try {
      const release = await seedPublishedCatalog(getRootPostgresPool(vendorOwner)!);
      await provisionPublicationRuntimeLogins(vendorDatabase.url, {
        mode: "lab", runToken,
        names: { api: "wiseeff_api", worker: `wiseeff_${runToken}_worker`, manager: `wiseeff_${runToken}_manager` },
      });
      const apiUrl = new URL(runtime.apiUrl);
      apiUrl.pathname = new URL(vendorDatabase.url).pathname;
      const result = await check(["--catalog-only"], apiUrl.href);
      expect(result.exitCode).toBe(0);
      expect(result.body).toMatchObject({ status: "value", value: { releaseId: release.id, digest: release.digest } });
    } finally {
      await vendorOwner.close();
      await vendorDatabase.drop();
    }
  });
});
