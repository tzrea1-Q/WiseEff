/**
 * Issue #849 PU-04: seed source materialization into the three target projects'
 * source plane, through the existing config-set / file / ingest owners.
 */
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { materializeSeedSources, type SeedProjectSources } from "./materialize";
import { getSeedInitializationRun } from "./plan";
import {
  createEphemeralTestDatabase,
  isTestDatabaseAvailable,
  type EphemeralTestDatabase
} from "../../../testing/testDatabase";
import { makeTestAuthContext } from "../../../testing/authContext";
import {
  createPostgresDatabase,
  getRootPostgresPool,
  type RootDatabase
} from "../../../shared/database/client";
import { createMemoryObjectStore } from "../../../testing/objectStore";

const databaseAvailable = await isTestDatabaseAvailable();
if (!databaseAvailable) {
  throw new Error(
    "seed materialization requires a reachable real PostgreSQL server; skipping is forbidden",
  );
}

const ORG = "org-seed-materialize";
const DIGEST = "sha256:seed-materialize-1";

const dtsFor = (project: string) => `/dts-v1/;
/ {
	charger_${project} {
		compatible = "acme,power";
		iin_max = <1000>;
	};
};
`;

const sources = (): SeedProjectSources[] => [
  { projectId: "atlas", files: [{ name: "charging-thermal.dts", format: "dts", content: dtsFor("atlas") }] },
  { projectId: "aurora", files: [{ name: "charging-thermal.dts", format: "dts", content: dtsFor("aurora") }] },
  { projectId: "nebula", files: [{ name: "charging-thermal.dts", format: "dts", content: dtsFor("nebula") }] }
];

describe("seed source materialization", () => {
  let database: EphemeralTestDatabase;
  let root: RootDatabase;
  let pool: pg.Pool;

  const adminAuth = makeTestAuthContext({
    userId: "user-seed-admin",
    organizationId: ORG,
    name: "Seed admin",
    email: "seed-admin@example.com",
    permissions: [
      "parameter:view",
      "parameter:edit",
      "parameter:review",
      "admin:access",
      "parameter:file-admin"
    ]
  });

  beforeAll(async () => {
    database = await createEphemeralTestDatabase("seedmat");
    root = createPostgresDatabase(database.url);
    pool = getRootPostgresPool(root)!;
    await pool.query(`insert into public.organizations (id, name) values ($1, 'Seed materialize')`, [ORG]);
    await pool.query(
      `insert into public.users (id, organization_id, name, email, title, is_active)
       values ('user-seed-admin', $1, 'Seed admin', 'seed-admin@example.com', 'Admin', true)`,
      [ORG]
    );
    await pool.query(
      `insert into public.projects (id, organization_id, name, code, status)
       values ('atlas', $1, 'Atlas 海外交付项目', 'ATL-Intl', 'initialized'),
              ('aurora', $1, 'Aurora 量产平台', 'AUR-Prod', 'initialized'),
              ('nebula', $1, 'Nebula 高频调试项目', 'NEB-RD', 'initialized')`,
      [ORG]
    );
  }, 60_000);

  afterAll(async () => {
    await root?.close();
    await database?.drop();
  });

  it("materializes a real config set, file version and resolved config revision for every target", async () => {
    const objectStore = createMemoryObjectStore();
    const outcome = await materializeSeedSources(root, objectStore, adminAuth, {
      organizationId: ORG,
      seedDigest: DIGEST,
      sources: sources()
    });

    expect(outcome.status).toBe("completed");
    expect(outcome.projects.map((project) => project.projectId).sort()).toEqual([
      "atlas",
      "aurora",
      "nebula"
    ]);

    for (const project of outcome.projects) {
      expect(project.configSetId.length).toBeGreaterThan(0);
      expect(project.configRevisionId.length).toBeGreaterThan(0);
      expect(project.fileIds).toHaveLength(1);

      const membership = await pool.query<{ count: string }>(
        `select count(*)::text as count
           from project_parameter_files
          where config_set_id = $1`,
        [project.configSetId]
      );
      expect(Number(membership.rows[0]!.count)).toBe(1);

      const revision = await pool.query<{ status: string }>(
        `select status from dts_config_revisions where id = $1`,
        [project.configRevisionId]
      );
      expect(revision.rows.map((row) => row.status)).toEqual(["resolved"]);
    }

    const run = await getSeedInitializationRun(root, { organizationId: ORG, seedDigest: DIGEST });
    expect(run?.status).toBe("completed");
    expect(run?.targetProjectIds.sort()).toEqual(["atlas", "aurora", "nebula"]);
  }, 120_000);

  it("is a no-op when the same seed digest already completed", async () => {
    const before = await pool.query<{ count: string }>(
      `select count(*)::text as count from project_parameter_file_versions`
    );
    const objectStore = createMemoryObjectStore();
    const outcome = await materializeSeedSources(root, objectStore, adminAuth, {
      organizationId: ORG,
      seedDigest: DIGEST,
      sources: sources()
    });

    expect(outcome.status).toBe("already-complete");
    expect(outcome.projects).toEqual([]);
    const after = await pool.query<{ count: string }>(
      `select count(*)::text as count from project_parameter_file_versions`
    );
    expect(after.rows[0]!.count).toBe(before.rows[0]!.count);
  }, 120_000);

  it("refuses a JSON seed source explicitly instead of uploading an unresolvable member", async () => {
    const objectStore = createMemoryObjectStore();
    await expect(
      materializeSeedSources(root, objectStore, adminAuth, {
        organizationId: ORG,
        seedDigest: "sha256:seed-materialize-json",
        sources: [
          {
            projectId: "atlas",
            files: [{ name: "power-config.json", format: "json", content: "{}" }]
          },
          ...sources().slice(1)
        ]
      })
    ).rejects.toMatchObject({
      code: "UNSUPPORTED_FORMAT",
      details: { format: "json" }
    });
  }, 120_000);
});
