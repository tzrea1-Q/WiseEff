/**
 * Issue #849 B2/B6: the canonical source materialization pipeline and its
 * fail-closed registration gate.
 *
 * This drives the real chain - a real published release lineage (`crel_acme_1` ->
 * `crel_vendor_catalog_1`, acme retired), the real demonstration DTS slice read
 * from disk, and the real seed materializer. The reviewed slice currently lacks
 * one free driver module for `csub_drv_sc8562`; B6 requires the whole run to stop
 * before any canonical binding sync instead of completing partially.
 *
 * The observed-property assertions are the positive half: the source plane
 * (config set, resolved revision, per-property occurrence effects) is complete and
 * attributed to the vendor subjects, and the definitions the DTS names exist in
 * the installed release, so the gate really is placement capacity.
 */
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { compileCatalogRelease } from "../../catalog-kernel/compiler/index";
import { jsonCatalogReleaseSource } from "../../catalog-kernel/interface";
import { installPublishedRelease } from "../../catalog-kernel/install/installer";
import type { CatalogReleasePin } from "../../parameter-catalog-contract/index";
import {
  FIRST_ACME_RELEASE_DIGEST,
  FIRST_ACME_RELEASE_ID,
  VENDOR_SUCCESSOR_AGGREGATE_DIGEST,
  VENDOR_SUCCESSOR_RELEASE_ID,
  compileVendorCatalogSuccessor,
} from "../../../../scripts/compile-vendor-catalog-release";
import {
  createEphemeralTestDatabase,
  isTestDatabaseAvailable,
  type EphemeralTestDatabase,
} from "../../../testing/testDatabase";
import { makeTestAuthContext } from "../../../testing/authContext";
import {
  createPostgresDatabase,
  getRootPostgresPool,
  type RootDatabase,
} from "../../../shared/database/client";
import { createMemoryObjectStore } from "../../../testing/objectStore";
import { firstReleaseBundle } from "../../../testing/parameterCatalog/cutoverPopulatedFixture";
import { materializeSeedSources, type SeedProjectSources } from "./materialize";
import { getSeedInitializationRun } from "./plan";

const databaseAvailable = await isTestDatabaseAvailable();
if (!databaseAvailable) {
  throw new Error(
    "canonical binding materialization requires a reachable real PostgreSQL server; skipping is forbidden",
  );
}

const ORG = "org-seed-bindings";
const DIGEST = "sha256:seed-bindings-1";
const REPO_ROOT = process.cwd();
const SEED_PROJECTS = ["atlas", "aurora", "nebula"] as const;

/**
 * Expectations come from the reviewed reconciliation manifest, not from the
 * generated file or the release: the manifest declares which vendor inputs exist, so
 * this is an independent cross-check of the source plane. All 113 are expressed.
 *
 * The generator emits a node per subject. Driver nodes declare a `compatible`, which
 * the parser records as one extra observable property per node; node-type nodes
 * declare none.
 */
const manifestVendorInputs = () =>
  (
    JSON.parse(
      readFileSync(path.join(REPO_ROOT, "src/config/seed-reconciliation/manifest.json"), "utf8"),
    ) as {
      inputs: Array<{
        family: string;
        propertyKey: string;
        formalSubject: { kind: string; value: string };
        content: { valueShape?: string };
      }>;
    }
  ).inputs.filter((entry) => entry.family === "vendor");

const expectedSourcePlane = () => {
  const vendor = manifestVendorInputs();
  // Every reviewed vendor input is expressed; the value comes from the vendor
  // metadata's own exampleValue, so no shape is filtered out here.
  const expressible = vendor;
  const driverSubjects = new Set(
    expressible.filter((e) => e.formalSubject.kind === "driver").map((e) => e.formalSubject.value),
  );
  const nodeTypeSubjects = new Set(
    expressible.filter((e) => e.formalSubject.kind !== "driver").map((e) => e.formalSubject.value),
  );
  const nodeTypeProperties = expressible.filter((e) => e.formalSubject.kind !== "driver").length;
  return {
    propertyKeys: [...new Set(expressible.map((e) => e.propertyKey))],
    driverSubjects: driverSubjects.size,
    nodeTypeSubjects: nodeTypeSubjects.size,
    // Every node-type property row has no compatible; driver nodes additionally
    // contribute one `compatible` row each.
    nodeTypePropertyRows: nodeTypeProperties,
    observedPerProject: expressible.length + driverSubjects.size,
  };
};
const SLICE_PROPERTIES = [
  // huawei,wireless_charger
  "pmax",
  "rx_mode_para",
  "rx_mode_type_para",
  "sc_err_tx",
  "trx_plim",
  // huawei,wireless_sc
  "bat_para",
  "init_para",
  "init_para_col",
  "volt_para00",
  "volt_para01",
  // mt,mt5788
  "prevfod1_product_list",
  "rx_fod_cond",
  "rx_mod_cm_cfg",
  "rx_ploss_th0",
  "time_para",
  "time_para_group",
  "tx_current_fod_para",
  // sc8562
  "fcp_support",
  "ic_role",
  "scp_support",
  "sense_r_actual",
  "sense_r_config",
  "slave_mode",
  "vout_ovp_mv",
  "watchdog_time",
];

const realSeedSources = async (): Promise<SeedProjectSources[]> => {
  const out: SeedProjectSources[] = [];
  for (const projectId of SEED_PROJECTS) {
    const content = await readFile(
      path.join(REPO_ROOT, "src/config/seed-sources", projectId, "vendor-drivers.dts"),
      "utf8",
    );
    out.push({
      projectId,
      files: [{ name: "vendor-drivers.dts", format: "dts", content }],
    });
  }
  return out;
};

describe("canonical binding materialization from a published release", () => {
  let database: EphemeralTestDatabase;
  let root: RootDatabase;
  let pool: pg.Pool;

  const adminAuth = makeTestAuthContext({
    userId: "user-seed-bindings",
    organizationId: ORG,
    name: "Seed bindings admin",
    email: "seed-bindings@example.com",
    permissions: [
      "parameter:view",
      "parameter:edit",
      "parameter:review",
      "admin:access",
      "parameter:file-admin",
    ],
  });

  beforeAll(async () => {
    database = await createEphemeralTestDatabase("seedbind");
    root = createPostgresDatabase(database.url);
    pool = getRootPostgresPool(root)!;
    await pool.query(`insert into public.organizations (id, name) values ($1, 'Seed bindings')`, [
      ORG,
    ]);
    await pool.query(
      `insert into public.users (id, organization_id, name, email, title, is_active)
       values ('user-seed-bindings', $1, 'Seed bindings admin', 'seed-bindings@example.com', 'Admin', true)`,
      [ORG],
    );
    await pool.query(
      `insert into public.projects (id, organization_id, name, code, status)
       values ('atlas', $1, 'Atlas 海外交付项目', 'ATL-Intl', 'initialized'),
              ('aurora', $1, 'Aurora 量产平台', 'AUR-Prod', 'initialized'),
              ('nebula', $1, 'Nebula 高频调试项目', 'NEB-RD', 'initialized')`,
      [ORG],
    );

    // A real published release lineage, not a fixture.
    const acmeBundle = firstReleaseBundle();
    const acmeCompiled = compileCatalogRelease(acmeBundle);
    expect(acmeCompiled.ok).toBe(true);
    if (!acmeCompiled.ok) throw new Error(acmeCompiled.error.kind);
    const bootstrapped = await installPublishedRelease(pool, {
      mode: "bootstrap",
      source: jsonCatalogReleaseSource(acmeBundle),
      expectedTargetDigest: acmeCompiled.value.release.digest,
    });
    expect(bootstrapped.ok, JSON.stringify(bootstrapped)).toBe(true);

    const vendor = compileVendorCatalogSuccessor(REPO_ROOT);
    const expectedCurrent = {
      id: FIRST_ACME_RELEASE_ID,
      digest: FIRST_ACME_RELEASE_DIGEST,
    } as unknown as CatalogReleasePin;
    const advanced = await installPublishedRelease(pool, {
      mode: "advance",
      source: jsonCatalogReleaseSource(vendor.bundle),
      expectedTargetDigest: VENDOR_SUCCESSOR_AGGREGATE_DIGEST,
      expectedCurrent,
    });
    expect(advanced.ok, JSON.stringify(advanced)).toBe(true);
  }, 180_000);

  afterAll(async () => {
    // `root.close()` owns the pool obtained via getRootPostgresPool.
    await root?.close();
    await database?.drop();
  });

  it("stages the real DTS slice but writes no bindings when placement capacity is short", async () => {
    await expect(
      materializeSeedSources(root, createMemoryObjectStore(), adminAuth, {
        organizationId: ORG,
        seedDigest: DIGEST,
        sources: await realSeedSources(),
      }),
    ).rejects.toMatchObject({
      name: "SeedInitializationBlockedError",
      blocks: expect.arrayContaining([
        expect.objectContaining({
          projectId: "atlas",
          subjectId: "csub_drv_sc8562",
          reason: "missing-placement-module",
        }),
        expect.objectContaining({
          projectId: "aurora",
          subjectId: "csub_drv_sc8562",
          reason: "missing-placement-module",
        }),
        expect.objectContaining({
          projectId: "nebula",
          subjectId: "csub_drv_sc8562",
          reason: "missing-placement-module",
        }),
      ]),
    });

    const revisions = await pool.query<{ project_id: string; id: string }>(
      `select distinct on (project_id) project_id, id
         from dts_config_revisions
        where organization_id = $1
        order by project_id, revision_number desc`,
      [ORG],
    );
    expect(revisions.rows.map((revision) => revision.project_id).sort()).toEqual([
      "atlas",
      "aurora",
      "nebula",
    ]);

    for (const revisionRow of revisions.rows) {
      expect(revisionRow.id.length).toBeGreaterThan(0);

      const observed = await pool.query<{ property_name: string; compatible: string }>(
        `select oe.property_name, lnr.compatible
           from dts_occurrence_effects oe
           inner join dts_logical_node_revisions lnr on lnr.id = oe.logical_node_revision_id
          where oe.config_revision_id = $1
            and oe.effect_kind in ('set','override')
          order by oe.property_name`,
        [revisionRow.id],
      );
      const expected = expectedSourcePlane();
      expect(observed.rows.length, `${revisionRow.project_id} observed properties`).toBe(
        expected.observedPerProject,
      );
      const propertyNames = new Set(observed.rows.map((row) => row.property_name));
      for (const propertyKey of expected.propertyKeys) {
        expect(propertyNames, `${revisionRow.project_id} ${propertyKey}`).toContain(propertyKey);
      }
      // Driver rows carry their compatible; node-type rows carry none by design.
      const nodeTypeRows = observed.rows.filter((row) => row.compatible === null);
      expect(nodeTypeRows.length).toBe(expected.nodeTypePropertyRows);
      // Either way the slice is never attributed to the retired acme sample.
      for (const row of observed.rows) {
        expect(row.compatible ?? "").not.toContain("acme");
      }

      const revision = await pool.query<{ status: string }>(
        `select status from dts_config_revisions where id = $1`,
        [revisionRow.id],
      );
      expect(revision.rows.map((row) => row.status)).toEqual(["resolved"]);
    }

    // The definitions the slice names are present in the installed release, so the
    // remaining gate really is registration rather than a missing definition.
    const expected = expectedSourcePlane();
    const definitions = await pool.query<{ property_key: string }>(
      `select property_key
         from parameter_catalog.parameter_definitions`,
    );
    const available = new Set(definitions.rows.map((row) => row.property_key));
    for (const propertyKey of expected.propertyKeys) {
      expect(available, `definition ${propertyKey}`).toContain(propertyKey);
    }

    // Registration proceeds during preflight, but one missing placement blocks the
    // run before the second phase writes any canonical project value.
    const registrations = await pool.query<{ count: string }>(
      `select count(*)::text as count
         from parameter_catalog.organization_subject_registrations
        where organization_id = $1 and status = 'active'`,
      [ORG],
    );
    expect(Number(registrations.rows[0]?.count)).toBeGreaterThan(0);

    const bindings = await pool.query<{ count: string }>(
      `select count(*)::text as count
         from parameter_catalog.project_parameter_bindings
        where organization_id = $1`,
      [ORG],
    );
    expect(bindings.rows[0]?.count).toBe("0");

    const run = await getSeedInitializationRun(root, {
      organizationId: ORG,
      seedDigest: DIGEST,
    });
    expect(run?.status).toBe("failed");
    expect(run?.blocked).toHaveLength(3);

    const pointer = await pool.query<{ current_catalog_release_id: string }>(
      "select current_catalog_release_id from parameter_catalog.catalog_state",
    );
    expect(pointer.rows[0]?.current_catalog_release_id).toBe(VENDOR_SUCCESSOR_RELEASE_ID);
  }, 180_000);
});
