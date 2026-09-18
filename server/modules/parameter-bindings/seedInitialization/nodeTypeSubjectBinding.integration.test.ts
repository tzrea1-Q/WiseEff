/**
 * Issue #849: node-type subject resolution in canonical binding materialization.
 *
 * The published vendor successor carries 33 node-type subjects (33 of the 113 vendor
 * properties) that have no driver selector at all. `catalogProjectValueSync` used to
 * pass `nodeTypeFallback: { kind: "absent" }` unconditionally, so those properties
 * could never bind no matter what the source declared. This proves the fallback now
 * resolves them from the observed node name - and only them.
 *
 * The fixture supplies the one operator-curated driver module the reviewed source
 * currently lacks. Seed initialization registers subjects but never invents that
 * user-visible placement structure.
 */
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
import { curateReviewedSeedPlacementCapacity } from "./placementCapacity";

const databaseAvailable = await isTestDatabaseAvailable();
if (!databaseAvailable) {
  throw new Error(
    "node-type binding materialization requires a reachable real PostgreSQL server; skipping is forbidden",
  );
}

const ORG = "org-seed-nodetype";
const DIGEST = "sha256:seed-nodetype-1";
const REPO_ROOT = process.cwd();
const SEED_PROJECTS = ["atlas", "aurora", "nebula"] as const;

/** 2 node-type nodes x 5 typed properties. */
const NODE_TYPE_BINDINGS_PER_PROJECT = 10;
const NODE_TYPE_SUBJECTS = [
  { subjectId: "csub_nt_batt_l_v800", key: "batt_l_v800" },
  { subjectId: "csub_nt_batt", key: "batt" },
];

const realSeedSources = async (): Promise<SeedProjectSources[]> => {
  const out: SeedProjectSources[] = [];
  for (const projectId of SEED_PROJECTS) {
    const content = await readFile(
      path.join(REPO_ROOT, "src/config/seed-sources", projectId, "vendor-drivers.dts"),
      "utf8",
    );
    out.push({ projectId, files: [{ name: "vendor-drivers.dts", format: "dts", content }] });
  }
  return out;
};

describe("node-type subject resolution during seed materialization", () => {
  let database: EphemeralTestDatabase;
  let root: RootDatabase;
  let pool: pg.Pool;

  const adminAuth = makeTestAuthContext({
    userId: "user-seed-nodetype",
    organizationId: ORG,
    name: "Seed node-type admin",
    email: "seed-nodetype@example.com",
    permissions: [
      "parameter:view",
      "parameter:edit",
      "parameter:review",
      "admin:access",
      "parameter:file-admin",
    ],
  });

  beforeAll(async () => {
    database = await createEphemeralTestDatabase("seednt");
    root = createPostgresDatabase(database.url);
    pool = getRootPostgresPool(root)!;
    await pool.query(`insert into public.organizations (id, name) values ($1, 'Seed node type')`, [
      ORG,
    ]);
    await pool.query(
      `insert into public.users (id, organization_id, name, email, title, is_active)
       values ('user-seed-nodetype', $1, 'Seed node-type admin', 'seed-nodetype@example.com', 'Admin', true)`,
      [ORG],
    );
    await pool.query(
      `insert into public.projects (id, organization_id, name, code, status)
       values ('atlas', $1, 'Atlas 海外交付项目', 'ATL-Intl', 'initialized'),
              ('aurora', $1, 'Aurora 量产平台', 'AUR-Prod', 'initialized'),
              ('nebula', $1, 'Nebula 高频调试项目', 'NEB-RD', 'initialized')`,
      [ORG],
    );

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
    const advanced = await installPublishedRelease(pool, {
      mode: "advance",
      source: jsonCatalogReleaseSource(vendor.bundle),
      expectedTargetDigest: VENDOR_SUCCESSOR_AGGREGATE_DIGEST,
      expectedCurrent: {
        id: FIRST_ACME_RELEASE_ID,
        digest: FIRST_ACME_RELEASE_DIGEST,
      } as unknown as CatalogReleasePin,
    });
    expect(advanced.ok, JSON.stringify(advanced)).toBe(true);

    await curateReviewedSeedPlacementCapacity(root, { organizationId: ORG });

  }, 180_000);

  afterAll(async () => {
    await root?.close();
    await database?.drop();
  });

  it("binds node-type properties by node name after placement capacity is curated", async () => {
    // Node-type subjects have no driver selector, so the sync must resolve them from
    // the observed node name - and the seed now registers them itself through the
    // automatic/trusted-system path. The only extra module is operator-curated in
    // the fixture above; the seed itself never creates placement structure.
    const outcome = await materializeSeedSources(root, createMemoryObjectStore(), adminAuth, {
      organizationId: ORG,
      seedDigest: DIGEST,
      sources: await realSeedSources(),
    });

    expect(outcome.status).toBe("completed");
    for (const project of outcome.projects) {
      expect(
        project.canonicalBindingsWritten,
        `${project.projectId} bindings`,
      ).toBeGreaterThanOrEqual(NODE_TYPE_BINDINGS_PER_PROJECT);
      for (const subject of NODE_TYPE_SUBJECTS) {
        expect(
          project.registeredSubjectIds,
          `${project.projectId} registered ${subject.subjectId}`,
        ).toContain(subject.subjectId);
      }
    }

    const bindings = await pool.query<{ subject_id: string; count: string }>(
      `select subject_id, count(*)::text as count
         from parameter_catalog.project_parameter_bindings
        group by subject_id
        order by subject_id`,
    );
    // Both node-type subjects bind in all three seed projects. Registration is now
    // automatic, so other subjects may bind as well: this is a floor per subject.
    const bySubject = new Map(bindings.rows.map((row) => [row.subject_id, Number(row.count)]));
    for (const subject of NODE_TYPE_SUBJECTS) {
      expect(bySubject.get(subject.subjectId), subject.subjectId).toBeGreaterThanOrEqual(
        NODE_TYPE_BINDINGS_PER_PROJECT / 2,
      );
    }

    // Every binding must own a current value, and the value table holds a
    // stabilization row plus a writeback row per binding.
    const values = await pool.query<{ count: string; withCurrent: string; bindings: string }>(
      `select (select count(*)::text from parameter_catalog.project_parameter_values) as count,
              (select count(*)::text
                 from parameter_catalog.project_parameter_bindings
                where current_value_id is not null) as "withCurrent",
              (select count(*)::text from parameter_catalog.project_parameter_bindings) as bindings`,
    );
    expect(values.rows[0]?.withCurrent).toBe(values.rows[0]?.bindings);
    expect(Number(values.rows[0]?.count)).toBe(Number(values.rows[0]?.bindings) * 2);
  }, 180_000);
});
