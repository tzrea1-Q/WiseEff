/**
 * T1.3: production vendor import + ConfigurationSchema successor + B2/B6
 * materialization of the reviewed DTS/JSON seed sources.
 */
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { jsonCatalogReleaseSource } from "../../catalog-kernel/interface";
import { installPublishedRelease } from "../../catalog-kernel/install/installer";
import {
  AUTHOR,
  REVIEWER,
  bootstrapFirstAcme,
  connect,
  persistPredecessorArtifact,
  reviewerPermissions,
  userActor,
} from "../../catalog-kernel/install/publicationTestHarness";
import { authorizePublish } from "../../catalog-publication/authorization/authorize";
import { asCoordinator, enablePublicationPolicy } from "../../catalog-publication/authorization/testHarness";
import { createJob, persistCandidate } from "../../catalog-publication/persistence/store";
import {
  asQueryable,
  requirePgvectorTestDatabase,
  sha256Digest,
  uniqueToken,
} from "../../catalog-publication/persistence/integrationHarness";
import { importVendorCatalog, type VendorIdKind } from "../../catalog-publication/import/vendorAdapter";
import {
  buildPowerConfigSuccessor,
  powerConfigFrozenIdentity,
  powerConfigImpactFacts,
} from "../../catalog-publication/import/configurationSchemaSuccessor";
import { PublicationJobId } from "../../parameter-catalog-contract/index";
import {
  createDatabase,
  createPostgresDatabase,
  getRootPostgresPool,
  type RootDatabase,
} from "../../../shared/database/client";
import {
  createEphemeralTestDatabase,
  type EphemeralTestDatabase,
} from "../../../testing/testDatabase";
import { makeTestAuthContext } from "../../../testing/authContext";
import { createMemoryObjectStore } from "../../../testing/objectStore";
import { materializeSeedSources } from "./materialize";
import { curateReviewedSeedPlacementCapacity } from "./placementCapacity";
import { canonicalSeedInitializationDigest } from "./digest";
import { reviewedSeedProjectSources } from "./seedSources";

await requirePgvectorTestDatabase();

const ORG = "org-seed-t13";
const REPO_ROOT = process.cwd();

const sequentialIds = (label: string) => {
  const counts: Partial<Record<VendorIdKind, number>> = {};
  return (kind: VendorIdKind): string => {
    counts[kind] = (counts[kind] ?? 0) + 1;
    return `${kind}_${label}_${counts[kind]}`;
  };
};

describe("T1.3 complete successor and B2 materialization", () => {
  let database: EphemeralTestDatabase;
  let root: RootDatabase;
  let pool: pg.Pool;
  let client: pg.Client;

  const adminAuth = makeTestAuthContext({
    userId: "user-seed-t13",
    organizationId: ORG,
    name: "T13 seed admin",
    email: "seed-t13@example.com",
  });

  beforeAll(async () => {
    database = await createEphemeralTestDatabase("t13succ");
    root = createPostgresDatabase(database.url);
    pool = getRootPostgresPool(root)!;
    client = await connect(database.url);
    await pool.query(`insert into public.organizations (id, name) values ($1, 'T13 seed')`, [ORG]);
    await pool.query(
      `insert into public.users (id, organization_id, name, email, title, is_active)
       values ('user-seed-t13', $1, 'T13 seed admin', 'seed-t13@example.com', 'Admin', true)`,
      [ORG],
    );
    await pool.query(
      `insert into public.projects (id, organization_id, name, code, status)
       values ('atlas', $1, 'Atlas 海外交付项目', 'ATL-Intl', 'initialized'),
              ('aurora', $1, 'Aurora 量产平台', 'AUR-Prod', 'initialized'),
              ('nebula', $1, 'Nebula 高频调试项目', 'NEB-RD', 'initialized')`,
      [ORG],
    );

    const predecessor = await bootstrapFirstAcme(pool);
    await persistPredecessorArtifact(client, predecessor);
    const label = uniqueToken("t13v");
    const imported = await importVendorCatalog({
      predecessorArtifact: { digest: predecessor.digest, bytes: predecessor.bytes },
      schemasRoot: path.join(REPO_ROOT, "schemas/dts"),
      identity: {
        publishedAt: "2026-09-17T12:00:00Z",
        releaseVersion: "1.2.0",
        candidateId: `ccand_${label}`,
        artifactId: `cart_${label}`,
        releaseId: `crel_${label}`,
        allocateId: sequentialIds(label),
      },
      authorPrincipalId: AUTHOR,
      authorOrganizationId: ORG,
      persist: { db: createDatabase(asQueryable(client)) },
    });
    expect(imported.ok, JSON.stringify(imported)).toBe(true);
    if (!imported.ok || imported.value.kind !== "successor" || imported.value.built.kind !== "successor") {
      throw new Error("vendor import failed");
    }
    if (imported.value.built.persistence.kind !== "persisted") {
      throw new Error("vendor candidate not persisted");
    }
    const vendorCandidate = imported.value.built.persistence.candidate;
    const policyRevision = await enablePublicationPolicy(client, {
      publicationEnabled: true,
      lowRiskSingleActorPublish: true,
    });
    const authorizeCandidate = async (
      candidate: typeof vendorCandidate,
      facts: typeof imported.value.impactFacts,
      scope: string,
    ) => {
      const authorized = await asCoordinator(client, async () => {
        const capability = await client.query<{ digest: string }>(
          `select catalog_publication.digest_jsonb(capability_contract) as digest
             from catalog_publication.candidates where id = $1`,
          [candidate.id],
        );
        return authorizePublish(asQueryable(client), {
          trustedActor: userActor(REVIEWER, reviewerPermissions),
          candidate: {
            candidateId: candidate.id,
            artifactDigest: candidate.artifactDigest,
            expectedBaseReleaseId: candidate.expectedBaseReleaseId,
            expectedBaseReleaseDigest: candidate.expectedBaseReleaseDigest,
            proposalRevisionId: candidate.proposalRevisionId,
            impactReportDigest: candidate.impactReportDigest,
            capabilityContractDigest: capability.rows[0]!.digest,
          },
          impactFacts: facts,
          policyRevision,
        });
      });
      expect(authorized.ok, JSON.stringify(authorized)).toBe(true);
      if (!authorized.ok) throw new Error("authorize failed");
      const token = uniqueToken(scope);
      const job = await asCoordinator(client, () =>
        createJob(asQueryable(client), {
          id: PublicationJobId(`cjob_${token}`),
          candidateId: candidate.id,
          authorizationId: authorized.value.authorization.id,
          requestScope: `instance:${scope}`,
          idempotencyKey: `key-${token}`,
          requestDigest: sha256Digest(`req-${token}`),
        }),
      );
      expect(job.ok, JSON.stringify(job)).toBe(true);
      if (!job.ok) throw new Error("job failed");
      const current = await client.query<{ id: string; digest: string }>(
        `select release.id, release.release_digest as digest
           from parameter_catalog.catalog_state state
           join parameter_catalog.catalog_releases release
             on release.id = state.current_catalog_release_id`,
      );
      const installed = await installPublishedRelease(pool, {
        mode: "online-publication",
        jobId: job.value.id,
        candidateId: candidate.id,
        authorizationId: authorized.value.authorization.id,
        expectedCurrent: {
          id: current.rows[0]!.id,
          digest: current.rows[0]!.digest,
        },
        fencingToken: job.value.fencingToken,
        trustedActor: userActor(REVIEWER, reviewerPermissions),
        impactFacts: facts,
      });
      expect(installed.ok, JSON.stringify(installed)).toBe(true);
    };

    await authorizeCandidate(vendorCandidate, imported.value.impactFacts, "t13-vendor");

    const cfgLabel = uniqueToken("t13c");
    const cfg = await buildPowerConfigSuccessor({
      predecessorArtifact: {
        digest: imported.value.built.artifact.artifactDigest,
        bytes: imported.value.built.artifact.artifactBytes,
      },
      frozenIdentity: powerConfigFrozenIdentity({
        candidateId: `ccand_${cfgLabel}`,
        artifactId: `cart_${cfgLabel}`,
        releaseId: `crel_${cfgLabel}`,
        releaseVersion: "1.3.0",
        publishedAt: "2026-09-17T12:05:00Z",
        toolchain: imported.value.frozenIdentity.toolchain,
        subjectId: `csub_${cfgLabel}_power`,
        cvDefinitionId: `pdef_${cfgLabel}_cv`,
        cvRevisionId: `drev_${cfgLabel}_cv_1`,
        thermalDefinitionId: `pdef_${cfgLabel}_th`,
        thermalRevisionId: `drev_${cfgLabel}_th_1`,
      }),
      persist: {
        db: createDatabase(asQueryable(client)),
        ports: {
          persistCandidate: async (db, candidateInput) =>
            persistCandidate(db, {
              ...candidateInput,
              identityAllocation: {
                ...candidateInput.identityAllocation,
                authorPrincipalId: AUTHOR,
                authorOrganizationId: ORG,
                impactFacts: powerConfigImpactFacts(AUTHOR),
                impactSummary: candidateInput.identityAllocation.impactSummary,
              },
            }),
        },
      },
    });
    expect(cfg.ok, JSON.stringify(cfg)).toBe(true);
    if (!cfg.ok || cfg.value.kind !== "successor" || cfg.value.persistence.kind !== "persisted") {
      throw new Error("configuration-schema successor failed");
    }
    await authorizeCandidate(cfg.value.persistence.candidate, powerConfigImpactFacts(AUTHOR), "t13-cfg");
  }, 240_000);

  afterAll(async () => {
    await client?.end().catch(() => undefined);
    await root?.close();
    await database?.drop();
  });

  it("materializes 124 bindings per project including JSON after reviewed placement", async () => {
    const objectStore = createMemoryObjectStore();
    await curateReviewedSeedPlacementCapacity(root, { organizationId: ORG });
    const sources = await reviewedSeedProjectSources(REPO_ROOT, { board: true, json: true });
    const seedDigest = canonicalSeedInitializationDigest({
      organizationId: ORG,
      files: sources.flatMap((project) =>
        project.files.map((file) => ({
          projectId: project.projectId,
          name: file.name as "board.dts" | "charging-thermal.dts" | "power-config.json",
          content: file.content,
        })),
      ),
    });
    const outcome = await materializeSeedSources(root, objectStore, adminAuth, {
      organizationId: ORG,
      seedDigest,
      sources,
    });
    expect(outcome.status).toBe("completed");
    expect(outcome.projects).toHaveLength(3);
    const written = Object.fromEntries(
      outcome.projects.map((project) => [project.projectId, project.canonicalBindingsWritten]),
    );
    expect(
      written,
      JSON.stringify({
        written,
        registered: outcome.projects.map((project) => ({
          projectId: project.projectId,
          registered: project.registeredSubjectIds.length,
          unregistered: project.unregisteredSubjectIds,
        })),
      }),
    ).toEqual({ atlas: 124, aurora: 124, nebula: 124 });

    const counts = await pool.query<{ project_id: string; count: string }>(
      `select project_id, count(*)::text as count
         from parameter_catalog.project_parameter_bindings
        where organization_id = $1
        group by project_id
        order by project_id`,
      [ORG],
    );
    expect(counts.rows.map((row) => [row.project_id, Number(row.count)])).toEqual([
      ["atlas", 124],
      ["aurora", 124],
      ["nebula", 124],
    ]);
    const total = await pool.query<{ count: string }>(
      `select count(*)::text as count from parameter_catalog.project_parameter_bindings where organization_id = $1`,
      [ORG],
    );
    expect(total.rows[0]!.count).toBe("372");

    const jsonBindings = await pool.query<{ count: string }>(
      `select count(*)::text as count
         from parameter_catalog.project_parameter_bindings b
         join parameter_catalog.project_parameter_source_occurrences o
           on o.id = b.source_occurrence_id
        where b.organization_id = $1 and o.occurrence_kind = 'json'`,
      [ORG],
    );
    expect(jsonBindings.rows[0]!.count).toBe("6");

    const replay = await materializeSeedSources(root, objectStore, adminAuth, {
      organizationId: ORG,
      seedDigest,
      sources,
    });
    expect(replay).toEqual({ status: "already-complete", seedDigest, projects: [] });
    const afterReplay = await pool.query<{ count: string }>(
      `select count(*)::text as count from parameter_catalog.project_parameter_bindings where organization_id = $1`,
      [ORG],
    );
    expect(afterReplay.rows[0]!.count).toBe("372");
  }, 240_000);
});
