/**
 * Issue #849 PU-04 (decision 17) / testing decision 9: the seed initialization
 * target plan must be narrow, explicit and fail closed.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  assertSeedInitializationPlanApplicable,
  getSeedInitializationRun,
  recordSeedInitializationRun,
  resolveSeedInitializationPlan,
  seedInitializationRunIsComplete,
  SeedInitializationBlockedError,
  SEED_PROJECT_IDENTITIES,
  SEED_PROJECT_IDS
} from "./plan";
import {
  createEphemeralTestDatabase,
  isTestDatabaseAvailable,
  type EphemeralTestDatabase
} from "../../../testing/testDatabase";
import { createPostgresDatabase, getRootPostgresPool, type RootDatabase } from "../../../shared/database/client";

const databaseAvailable = await isTestDatabaseAvailable();
if (!databaseAvailable) {
  throw new Error(
    "seed initialization plan requires a reachable real PostgreSQL server; skipping is forbidden",
  );
}

const ORG = "org-seed-plan";
const OTHER_ORG = "org-seed-plan-other";
const CUSTOM_PROJECT = "project-custom";

describe("seed initialization target plan", () => {
  let database: EphemeralTestDatabase;
  let root: RootDatabase;
  let pool: pg.Pool;

  const seed = async (copy: {
    auroraCode?: string;
    withAtlas?: boolean;
    withCustom?: boolean;
    otherOrgAtlas?: boolean;
  }) => {
    await pool.query(`delete from public.projects where organization_id in ($1, $2)`, [ORG, OTHER_ORG]);
    await pool.query(
      `insert into public.organizations (id, name) values ($1, 'Seed plan'), ($2, 'Other org')
       on conflict (id) do nothing`,
      [ORG, OTHER_ORG],
    );
    await pool.query(
      `insert into public.projects (id, organization_id, name, code, status)
       values ('aurora', $1, 'Aurora 量产平台', $2, 'initialized'),
              ('nebula', $1, 'Nebula 高频调试项目', 'NEB-RD', 'initialized')`,
      [ORG, copy.auroraCode ?? "AUR-Prod"],
    );
    if (copy.withAtlas !== false) {
      await pool.query(
        `insert into public.projects (id, organization_id, name, code, status)
         values ('atlas', $1, 'Atlas 海外交付项目', 'ATL-Intl', 'initialized')`,
        [ORG],
      );
    }
    if (copy.withCustom) {
      await pool.query(
        `insert into public.projects (id, organization_id, name, code, status)
         values ($1, $2, 'Custom project', 'CUS-1', 'initialized')`,
        [CUSTOM_PROJECT, ORG],
      );
    }
    if (copy.otherOrgAtlas) {
      await pool.query(
        `insert into public.projects (id, organization_id, name, code, status)
         values ('atlas', $1, 'Atlas elsewhere', 'ATL-Intl', 'initialized')`,
        [OTHER_ORG],
      );
    }
  };

  beforeAll(async () => {
    database = await createEphemeralTestDatabase("seedplan");
    root = createPostgresDatabase(database.url);
    pool = getRootPostgresPool(root)!;
  }, 60_000);

  afterAll(async () => {
    await root?.close();
    await database?.drop();
  });

  it("keeps the reviewed seed identities in step with the repository seed configuration", () => {
    const configuration = JSON.parse(
      readFileSync(join(process.cwd(), "src/config/power-management.json"), "utf8"),
    ) as { projects: Array<{ id: string; name: string; code: string }> };
    expect([...configuration.projects].sort((a, b) => (a.id < b.id ? -1 : 1))).toEqual(
      [...SEED_PROJECT_IDENTITIES].sort((a, b) => (a.id < b.id ? -1 : 1)),
    );
    expect([...SEED_PROJECT_IDS].sort()).toEqual(["atlas", "aurora", "nebula"]);
  });

  it("resolves exactly the three reviewed projects and excludes every other project", async () => {
    await seed({ withCustom: true });
    const plan = await resolveSeedInitializationPlan(root, { organizationId: ORG, seedDigest: "sha256:seed-1" });

    expect(plan.blocked).toEqual([]);
    expect(plan.targets.map((target) => target.projectId).sort()).toEqual(["atlas", "aurora", "nebula"]);
    expect(plan.targets.every((target) => target.parameterState === "empty")).toBe(true);
    // A custom project is reported as excluded and is never a target.
    expect(plan.excludedProjectIds).toEqual([CUSTOM_PROJECT]);
    assertSeedInitializationPlanApplicable(plan);
  });

  it("blocks on a missing project instead of creating one", async () => {
    await seed({ withAtlas: false });
    const plan = await resolveSeedInitializationPlan(root, { organizationId: ORG, seedDigest: "sha256:seed-2" });

    expect(plan.targets.map((target) => target.projectId).sort()).toEqual(["aurora", "nebula"]);
    expect(plan.blocked).toEqual([
      { projectId: "atlas", reason: "missing-project", detail: expect.any(String) }
    ]);
    expect(() => assertSeedInitializationPlanApplicable(plan)).toThrow(SeedInitializationBlockedError);
    // No project was created by planning.
    const created = await pool.query<{ count: string }>(
      `select count(*)::text as count from public.projects where organization_id = $1 and id = 'atlas'`,
      [ORG],
    );
    expect(created.rows[0]!.count).toBe("0");
  });

  it("blocks when a stable id resolves to a project in another organization", async () => {
    await seed({ withAtlas: false, otherOrgAtlas: true });
    const plan = await resolveSeedInitializationPlan(root, { organizationId: ORG, seedDigest: "sha256:seed-3" });
    // `atlas` exists, but for another organization: the plan blocks rather than
    // adopting a foreign project, and never creates one here.
    expect(plan.blocked).toEqual([
      { projectId: "atlas", reason: "organization-mismatch", detail: expect.any(String) }
    ]);
    expect(plan.targets.map((target) => target.projectId).sort()).toEqual(["aurora", "nebula"]);
    expect(() => assertSeedInitializationPlanApplicable(plan)).toThrow(SeedInitializationBlockedError);
    const here = await pool.query<{ count: string }>(
      `select count(*)::text as count from public.projects where organization_id = $1 and id = 'atlas'`,
      [ORG],
    );
    expect(here.rows[0]!.count).toBe("0");
  });

  it("blocks when the stored project code disagrees with the reviewed seed identity", async () => {
    await seed({ auroraCode: "WRONG-CODE" });
    const plan = await resolveSeedInitializationPlan(root, { organizationId: ORG, seedDigest: "sha256:seed-4" });
    expect(plan.blocked.some((block) => block.reason === "identity-ambiguous")).toBe(true);
    expect(() => assertSeedInitializationPlanApplicable(plan)).toThrow(SeedInitializationBlockedError);
  });

  it("treats a repeated completed run as a no-op and a new digest as a new run", async () => {
    await seed({});
    const digest = "sha256:seed-run";
    expect(await seedInitializationRunIsComplete(root, { organizationId: ORG, seedDigest: digest })).toBe(false);

    await recordSeedInitializationRun(root, {
      organizationId: ORG,
      seedDigest: digest,
      status: "running",
      targetProjectIds: ["atlas", "aurora", "nebula"]
    });
    expect(await seedInitializationRunIsComplete(root, { organizationId: ORG, seedDigest: digest })).toBe(false);

    await recordSeedInitializationRun(root, {
      organizationId: ORG,
      seedDigest: digest,
      status: "completed",
      targetProjectIds: ["atlas", "aurora", "nebula"]
    });
    expect(await seedInitializationRunIsComplete(root, { organizationId: ORG, seedDigest: digest })).toBe(true);
    expect((await getSeedInitializationRun(root, { organizationId: ORG, seedDigest: digest }))?.targetProjectIds).toEqual([
      "atlas",
      "aurora",
      "nebula"
    ]);

    // Recording again is idempotent: one run per (organization, digest).
    await recordSeedInitializationRun(root, {
      organizationId: ORG,
      seedDigest: digest,
      status: "completed",
      targetProjectIds: ["atlas", "aurora", "nebula"]
    });
    const runs = await pool.query<{ count: string }>(
      `select count(*)::text as count from seed_initialization_runs where organization_id = $1 and seed_digest = $2`,
      [ORG, digest],
    );
    expect(runs.rows[0]!.count).toBe("1");

    await recordSeedInitializationRun(root, {
      organizationId: ORG,
      seedDigest: digest,
      status: "running",
      targetProjectIds: ["atlas", "aurora", "nebula"]
    });
    expect(await seedInitializationRunIsComplete(root, { organizationId: ORG, seedDigest: digest })).toBe(true);

    expect(
      await seedInitializationRunIsComplete(root, { organizationId: ORG, seedDigest: "sha256:other" })
    ).toBe(false);
  });

  it("keeps failed blockers visible while a retry is running and clears them only on completion", async () => {
    await seed({});
    const seedDigest = "sha256:seed-retry-blocker";
    const blocked = [{
      projectId: "atlas",
      subjectId: "csub_acme_power",
      reason: "missing-placement-module" as const,
      detail: "Operator curation is required."
    }];

    await recordSeedInitializationRun(root, {
      organizationId: ORG,
      seedDigest,
      status: "failed",
      targetProjectIds: ["atlas", "aurora", "nebula"],
      blocked
    });
    await recordSeedInitializationRun(root, {
      organizationId: ORG,
      seedDigest,
      status: "running",
      targetProjectIds: ["atlas", "aurora", "nebula"]
    });
    expect(await getSeedInitializationRun(root, { organizationId: ORG, seedDigest })).toMatchObject({
      status: "running",
      blocked
    });

    await recordSeedInitializationRun(root, {
      organizationId: ORG,
      seedDigest,
      status: "completed",
      targetProjectIds: ["atlas", "aurora", "nebula"]
    });
    expect(await getSeedInitializationRun(root, { organizationId: ORG, seedDigest })).toMatchObject({
      status: "completed",
      blocked: []
    });
  });
});
