/**
 * Issue #849 PU-04: seed source materialization into the three target projects'
 * source plane, through the existing config-set / file / ingest owners.
 */
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { compileCatalogRelease } from "../../catalog-kernel/compiler/index";
import {
  refreshAuthoritativeSource,
  validCatalogReleaseBundle
} from "../../catalog-kernel/compiler/__fixtures__/catalogReleaseBundle";
import type {
  CatalogReleaseBundle,
  CatalogReleaseDefinitionDocument,
  CatalogReleaseSubjectDocument
} from "../../catalog-kernel/compiler/types";
import { jsonCatalogReleaseSource } from "../../catalog-kernel/interface";
import { installPublishedRelease } from "../../catalog-kernel/install/installer";
import { CatalogSubjectId } from "../../parameter-catalog-contract/index";
import { executeRegistration } from "../../parameter-governance/registration/service";
import { materializeSeedSources, type SeedProjectSources } from "./materialize";
import { getSeedInitializationRun, recordSeedInitializationRun } from "./plan";
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

const failClosedCatalogBundle = (): CatalogReleaseBundle => {
  const base = validCatalogReleaseBundle();
  const release = structuredClone(base.releases[0]!);
  const subject = release.documents.find(
    (document): document is CatalogReleaseSubjectDocument => document.kind === "subject"
  );
  const definition = release.documents.find(
    (document): document is CatalogReleaseDefinitionDocument => document.kind === "definition"
  );
  if (!subject || !definition) throw new Error("catalog fixture is incomplete");

  const earlierSubject: CatalogReleaseSubjectDocument = {
    ...structuredClone(subject),
    content: {
      ...structuredClone(subject.content),
      id: "csub_acme_charger",
      canonicalKey: "driver:acme,charger",
      selector: { ...structuredClone(subject.content.selector), value: "acme,charger" }
    }
  };
  const earlierDefinition: CatalogReleaseDefinitionDocument = {
    ...structuredClone(definition),
    content: {
      ...structuredClone(definition.content),
      id: "pdef_acme_charger_current_limit",
      subjectId: earlierSubject.content.id,
      propertyKey: "current_limit",
      revision: {
        ...structuredClone(definition.content.revision),
        id: "drev_acme_charger_current_limit_1",
        matching: {
          ...structuredClone(definition.content.revision.matching),
          sourceProperty: "current_limit"
        }
      }
    }
  };
  const occupyingSubject: CatalogReleaseSubjectDocument = {
    ...structuredClone(subject),
    content: {
      ...structuredClone(subject.content),
      id: "csub_acme_occupied",
      canonicalKey: "driver:acme,occupied",
      selector: { ...structuredClone(subject.content.selector), value: "acme,occupied" }
    }
  };
  const target = {
    ...release,
    documents: [...release.documents, earlierSubject, earlierDefinition, occupyingSubject]
  };
  refreshAuthoritativeSource(target as never);
  return {
    schemaVersion: base.schemaVersion,
    targetReleaseId: target.manifest.release.id,
    releases: [target]
  };
};

const stagedSources = (): SeedProjectSources[] => [
  {
    projectId: "aurora",
    files: [{ name: "charging-thermal.dts", format: "dts", content: dtsFor("aurora").replace("acme,power", "acme,charger").replace("iin_max", "current_limit") }]
  },
  {
    projectId: "nebula",
    files: [{ name: "charging-thermal.dts", format: "dts", content: dtsFor("nebula").replace("acme,power", "acme,charger").replace("iin_max", "current_limit") }]
  },
  { projectId: "atlas", files: [{ name: "charging-thermal.dts", format: "dts", content: dtsFor("atlas") }] }
];

describe("seed source materialization", () => {
  let database: EphemeralTestDatabase;
  let root: RootDatabase;
  let pool: pg.Pool;
  const persistentObjectStore = createMemoryObjectStore();

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

  it("rejects an organization id outside the authenticated organization", async () => {
    await expect(
      materializeSeedSources(root, createMemoryObjectStore(), adminAuth, {
        organizationId: "org-other",
        seedDigest: "sha256:seed-materialize-foreign-org",
        sources: sources()
      })
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      details: { reason: "organization-mismatch" }
    });
  });

  it("does not journal a run for an actor without parameter edit access", async () => {
    const seedDigest = "sha256:seed-materialize-viewer";
    const viewerAuth = makeTestAuthContext({
      userId: "user-seed-viewer",
      organizationId: ORG,
      name: "Seed viewer",
      email: "seed-viewer@example.com",
      permissions: ["parameter:view"]
    });

    await expect(
      materializeSeedSources(root, createMemoryObjectStore(), viewerAuth, {
        organizationId: ORG,
        seedDigest,
        sources: sources()
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getSeedInitializationRun(root, { organizationId: ORG, seedDigest })).resolves.toBeNull();

    const completedDigest = "sha256:seed-materialize-viewer-completed";
    await recordSeedInitializationRun(root, {
      organizationId: ORG,
      seedDigest: completedDigest,
      status: "completed",
      targetProjectIds: ["atlas", "aurora", "nebula"]
    });
    await expect(
      materializeSeedSources(root, createMemoryObjectStore(), viewerAuth, {
        organizationId: ORG,
        seedDigest: completedDigest,
        sources: sources()
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("materializes a real config set, file version and resolved config revision for every target", async () => {
    const outcome = await materializeSeedSources(root, persistentObjectStore, adminAuth, {
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

  it("rejects a concurrent materialization of the same seed digest", async () => {
    const seedDigest = "sha256:seed-materialize-concurrent";
    const objectStore = persistentObjectStore;
    const put = objectStore.put.bind(objectStore);
    let releaseFirstPut!: () => void;
    let announceFirstPut!: () => void;
    const firstPutStarted = new Promise<void>((resolve) => {
      announceFirstPut = resolve;
    });
    const firstPutReleased = new Promise<void>((resolve) => {
      releaseFirstPut = resolve;
    });
    let held = false;
    objectStore.put = async (input) => {
      if (!held) {
        held = true;
        announceFirstPut();
        await firstPutReleased;
      }
      return put(input);
    };

    const first = materializeSeedSources(root, objectStore, adminAuth, {
      organizationId: ORG,
      seedDigest,
      sources: sources()
    });
    await firstPutStarted;

    await expect(
      materializeSeedSources(root, createMemoryObjectStore(), adminAuth, {
        organizationId: ORG,
        seedDigest,
        sources: sources()
      })
    ).rejects.toThrow(/already in progress/);
    await expect(
      materializeSeedSources(root, createMemoryObjectStore(), adminAuth, {
        organizationId: ORG,
        seedDigest: `${seedDigest}-different`,
        sources: sources()
      })
    ).rejects.toThrow(/already in progress/);

    releaseFirstPut();
    await expect(first).resolves.toMatchObject({ status: "completed", seedDigest });
    objectStore.put = put;
  }, 120_000);

  it("preflights every target, journals every blocker, and performs no value sync when a later target is blocked", async () => {
    const seedDigest = "sha256:seed-materialize-blocked";
    const bundle = failClosedCatalogBundle();
    const compiled = compileCatalogRelease(bundle);
    expect(compiled.ok, JSON.stringify(compiled)).toBe(true);
    if (!compiled.ok) throw new Error(compiled.error.kind);
    const installed = await installPublishedRelease(pool, {
      mode: "bootstrap",
      source: jsonCatalogReleaseSource(bundle),
      expectedTargetDigest: compiled.value.release.digest
    });
    expect(installed.ok, JSON.stringify(installed)).toBe(true);

    await pool.query(
      `insert into public.attribution_subjects (
         id, organization_id, subject_kind, display_name, source_key
       ) values
         ('asub-seed-module-a', $1, 'driver-registration', 'Seed module A', 'compatible:seed,module-a'),
         ('asub-seed-module-b', $1, 'driver-registration', 'Seed module B', 'compatible:seed,module-b')`,
      [ORG]
    );
    await pool.query(
      `insert into public.driver_registrations (
         attribution_subject_id, driver_nature, instance_cardinality
       ) values
         ('asub-seed-module-a', 'physical-device', 'multiple'),
         ('asub-seed-module-b', 'physical-device', 'multiple')`
    );
    await pool.query(
      `insert into public.parameter_modules (
         id, organization_id, name, path, depth, kind, origin, attribution_subject_id
       ) values
         ('pmod-seed-module-a', $1, 'Seed module A', 'pmod-seed-module-a', 1, 'driver-group', 'curated', 'asub-seed-module-a'),
         ('pmod-seed-module-b', $1, 'Seed module B', 'pmod-seed-module-b', 1, 'driver-group', 'curated', 'asub-seed-module-b')`,
      [ORG]
    );
    const occupied = await executeRegistration(pool, {
      kind: "register",
      organizationId: ORG,
      subjectId: CatalogSubjectId("csub_acme_occupied"),
      subjectKind: "driver",
      expectedRelease: {
        id: compiled.value.release.id,
        digest: compiled.value.release.digest
      },
      placement: { mode: "use-default" },
      destinationModuleId: "pmod-seed-module-a",
      method: "explicit",
      proof: { reason: "reserve one of two modules for the fail-closed fixture" },
      idempotencyKey: "seed-materialize-blocked:occupy",
      context: { actorKind: "org-admin", principalId: "user-seed-admin" }
    });
    expect(occupied.ok, JSON.stringify(occupied)).toBe(true);

    await expect(
      materializeSeedSources(root, persistentObjectStore, adminAuth, {
        organizationId: ORG,
        seedDigest,
        sources: stagedSources()
      })
    ).rejects.toMatchObject({
      name: "SeedInitializationBlockedError",
      blocks: [
        {
          projectId: "atlas",
          subjectId: "csub_acme_power",
          reason: "missing-placement-module"
        }
      ]
    });

    expect(await getSeedInitializationRun(root, { organizationId: ORG, seedDigest })).toMatchObject({
      status: "failed",
      blocked: [
        {
          projectId: "atlas",
          subjectId: "csub_acme_power",
          reason: "missing-placement-module"
        }
      ]
    });
    const bindings = await pool.query<{ count: string }>(
      `select count(*)::text as count
         from parameter_catalog.project_parameter_bindings
        where organization_id = $1`,
      [ORG]
    );
    expect(bindings.rows[0]!.count).toBe("0");
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
