/**
 * T1.3: production vendor import + ConfigurationSchema successor + B2/B6
 * materialization of the reviewed DTS/JSON seed sources.
 */
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
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
import { createLocalObjectStore } from "../../logs/objectStore";
import { createCanonicalValueDraft } from "../drafts/service";
import { submitCanonicalValueChange } from "../drafts/changeService";
import { createUserInvocation } from "../../auth/trustedInvocation";
import { createTrustedRefusalAuditSink } from "../../audit/trustedRefusalSink";
import { materializeSeedSources } from "./materialize";
import { getSeedInitializationRun } from "./plan";
import { curateReviewedSeedPlacementCapacity } from "./placementCapacity";
import { canonicalSeedInitializationDigest } from "./digest";
import { reviewedSeedProjectSources } from "./seedSources";

await requirePgvectorTestDatabase();

const ORG = "org-seed-t13";
const REPO_ROOT = process.cwd();

type ReviewedBoardOccurrence = {
  readonly board: string;
  readonly scope: string;
  readonly nodePath: string;
  readonly propertyKey: string;
  readonly formalSubject: { readonly kind: string; readonly value: string };
};

const reviewedBoardOccurrences = (): readonly ReviewedBoardOccurrence[] => {
  const manifest = JSON.parse(
    readFileSync(path.join(REPO_ROOT, "src/config/seed-reconciliation/manifest.json"), "utf8"),
  ) as { readonly boardOccurrences: readonly ReviewedBoardOccurrence[] };
  return manifest.boardOccurrences;
};

const expectedSeedValues = {
  atlas: {
    "fast-charge-profile-matrix": {
      valueKind: "string-array",
      value: ["0", "5000", "1500", "40", "entry", "1", "9000", "3000", "43", "balanced", "2", "11000", "4200", "46", "burst"],
    },
    "battery-thermal-derate-curve": {
      valueKind: "number-array",
      value: [0, 38, 3800, 4350, 1, 42, 3200, 4320, 2, 45, 2600, 4280],
    },
    "charger.cv.limitMv": { valueKind: "json", value: 4300 },
    "battery.thermal.targetTempC": { valueKind: "json", value: 36 },
  },
  aurora: {
    "fast-charge-profile-matrix": {
      valueKind: "string-array",
      value: ["0", "5000", "1500", "40", "entry", "1", "9000", "3000", "43", "balanced", "2", "11000", "4200", "46", "burst"],
    },
    "battery-thermal-derate-curve": {
      valueKind: "number-array",
      value: [0, 38, 3800, 4350, 1, 42, 3200, 4320, 2, 45, 2600, 4280],
    },
    "charger.cv.limitMv": { valueKind: "json", value: 4350 },
    "battery.thermal.targetTempC": { valueKind: "json", value: 38 },
  },
  nebula: {
    "fast-charge-profile-matrix": {
      valueKind: "string-array",
      value: ["0", "5000", "1500", "40", "entry", "1", "9000", "3000", "43", "balanced", "2", "12000", "4300", "48", "boost"],
    },
    "battery-thermal-derate-curve": {
      valueKind: "number-array",
      value: [0, 38, 3800, 4350, 1, 42, 3000, 4300, 2, 45, 2400, 4260],
    },
    "charger.cv.limitMv": { valueKind: "json", value: 4380 },
    "battery.thermal.targetTempC": { valueKind: "json", value: 40 },
  },
} as const;

const canonicalSubjectKey = (kind: string, value: string): string =>
  `${kind === "driver" ? "driver" : "node-type"}:${value}`;

const canonicalDtsLocator = (fileName: string, nodePath: string): string =>
  `${fileName}!/${nodePath.replace(/^\/+/, "")}`;

const normalizedDtsSourceRef = (sourceRef: string): string => {
  const [fileName, nodePath = ""] = sourceRef.split("!", 2);
  return canonicalDtsLocator(fileName!, nodePath);
};

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
  let storageDirectory: string;
  let objectStore: ReturnType<typeof createLocalObjectStore>;

  const adminAuth = makeTestAuthContext({
    userId: "user-seed-t13",
    organizationId: ORG,
    name: "T13 seed admin",
    email: "seed-t13@example.com",
  });

  beforeAll(async () => {
    database = await createEphemeralTestDatabase("t13succ");
    storageDirectory = await mkdtemp(path.join(tmpdir(), "wiseeff-849-t13-"));
    objectStore = createLocalObjectStore(storageDirectory);
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
              ('nebula', $1, 'Nebula 高频调试项目', 'NEB-RD', 'initialized'),
              ('custom-sentinel', $1, 'Custom user project', 'CUS-User', 'initialized')`,
      [ORG],
    );
    await pool.query(
      `insert into user_role_bindings (id, user_id, organization_id, project_id, role_id)
       values ('urb-t13-custom', 'user-seed-t13', $1, 'custom-sentinel', 'software-user')`,
      [ORG],
    );
    await pool.query(
      `insert into public.users (id, organization_id, name, email, title, is_active)
       values ('user-seed-t13-reviewer', $1, 'T13 reviewer', 'seed-t13-reviewer@example.com', 'Committer', true)`,
      [ORG],
    );
    await pool.query(
      `insert into user_role_bindings (id, user_id, organization_id, project_id, role_id)
       values ('urb-t13-reviewer', 'user-seed-t13-reviewer', $1, 'atlas', 'software-committer')`,
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
    if (storageDirectory) await rm(storageDirectory, { recursive: true, force: true });
  });

  it("materializes 124 bindings per project including JSON after reviewed placement", async () => {
    const customBefore = await pool.query(
      `select project.id, project.organization_id, project.name, project.code, project.status,
              role.id as role_binding_id, role.user_id, role.role_id
         from public.projects project
         left join public.user_role_bindings role
           on role.organization_id = project.organization_id and role.project_id = project.id
        where project.id = 'custom-sentinel'
        order by role.id`,
    );
    expect(customBefore.rows).toHaveLength(1);
    expect(customBefore.rows[0]).toMatchObject({
      id: "custom-sentinel",
      organization_id: ORG,
      name: "Custom user project",
      code: "CUS-User",
      status: "initialized",
      role_binding_id: "urb-t13-custom",
      user_id: "user-seed-t13",
      role_id: "software-user",
    });
    const knowledgeBytes = Buffer.from("User knowledge attachment that predates the seed rebuild.\n");
    const knowledgeObject = await objectStore.put({
      organizationId: ORG, fileName: "preserved-knowledge.txt", contentType: "text/plain", bytes: knowledgeBytes,
    });
    const knowledgeEntryId = "84900000-0000-4000-8000-000000000001";
    const knowledgeFileId = "84900000-0000-4000-8000-000000000002";
    await pool.query(
      `insert into public.knowledge_entries(id,organization_id,title,content_form,created_by_user_id,tags)
       values ($1,$2,'Existing user knowledge','file',$3,array['preserve'])`,
      [knowledgeEntryId, ORG, adminAuth.user.id],
    );
    await pool.query(
      `insert into public.knowledge_files(id,entry_id,organization_id,storage_key,file_name,content_type,size_bytes,checksum)
       values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [knowledgeFileId, knowledgeEntryId, ORG, knowledgeObject.storageKey, knowledgeObject.fileName,
        knowledgeObject.contentType, knowledgeObject.fileSizeBytes, knowledgeObject.checksumSha256],
    );
    const captureNonParameterState = async () => ({
      entries: (await pool.query("select * from public.knowledge_entries where organization_id=$1 order by id", [ORG])).rows,
      files: (await pool.query("select * from public.knowledge_files where organization_id=$1 order by id", [ORG])).rows,
      objectBytes: await objectStore.get(knowledgeObject.storageKey),
    });
    const nonParameterBefore = await captureNonParameterState();
    expect(nonParameterBefore.entries).toHaveLength(1);
    expect(nonParameterBefore.files).toHaveLength(1);
    expect(nonParameterBefore.objectBytes).toEqual(knowledgeBytes);
    expect(createHash("sha256").update(nonParameterBefore.objectBytes).digest("hex"))
      .toBe(knowledgeObject.checksumSha256);
    await curateReviewedSeedPlacementCapacity(root, { organizationId: ORG });
    const sources = (await reviewedSeedProjectSources(REPO_ROOT, { board: true, json: true })).map((project) => ({
      ...project,
      // Deliberately exercise the order-independent materializer contract.
      files: project.files.slice().reverse(),
    }));
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
    const badSources = sources.map((project) => ({
      ...project,
      files: project.files.map((file) =>
        file.name === "power-config.json"
          ? { ...file, content: `{"charger.cv.limitMv":4300}` }
          : file,
      ),
    }));
    const badSeedDigest = canonicalSeedInitializationDigest({
      organizationId: ORG,
      files: badSources.flatMap((project) =>
        project.files.map((file) => ({
          projectId: project.projectId,
          name: file.name as "board.dts" | "charging-thermal.dts" | "power-config.json",
          content: file.content,
        })),
      ),
    });
    await expect(
      materializeSeedSources(root, objectStore, adminAuth, {
        organizationId: ORG,
        seedDigest: badSeedDigest,
        sources: badSources,
      }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "JSON source pointer does not exist.",
    });
    await expect(getSeedInitializationRun(root, {
      organizationId: ORG,
      seedDigest: badSeedDigest,
    })).resolves.toMatchObject({ status: "running" });
    const badStaged = await pool.query<{ project_id: string; files: string; revisions: string }>(
      `select project.id as project_id,
              (select count(*)::text from public.project_parameter_files file
                where file.organization_id = project.organization_id and file.project_id = project.id) as files,
              (select count(*)::text from public.dts_config_revisions revision
                where revision.organization_id = project.organization_id and revision.project_id = project.id) as revisions
         from public.projects project
        where project.organization_id = $1 and project.id = any($2::text[])
        order by project.id`,
      [ORG, ["atlas", "aurora", "nebula"]],
    );
    expect(badStaged.rows).toEqual([
      { project_id: "atlas", files: "3", revisions: "1" },
      { project_id: "aurora", files: "3", revisions: "1" },
      { project_id: "nebula", files: "3", revisions: "1" },
    ]);
    const badBindings = await pool.query<{ bindings: string; values: string }>(
      `select
         (select count(*)::text from parameter_catalog.project_parameter_bindings where organization_id = $1) as bindings,
         (select count(*)::text from parameter_catalog.project_parameter_values where binding_id in (
            select id from parameter_catalog.project_parameter_bindings where organization_id = $1
         )) as values`,
      [ORG],
    );
    expect(badBindings.rows).toEqual([{ bindings: "0", values: "0" }]);
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

    const archiveRows = await pool.query<{
      project_id: string;
      object_ref: string;
      content_digest: string;
      truncated: boolean;
    }>(
      `select project_id, object_ref, content_digest, truncated
         from public.project_parameter_plane_archives
        where organization_id = $1
        order by project_id, created_at, id`,
      [ORG],
    );
    expect(archiveRows.rows).toHaveLength(6);
    for (const archive of archiveRows.rows) {
      expect(archive.truncated).toBe(false);
      const bytes = await objectStore.get(archive.object_ref);
      expect(`sha256:${createHash("sha256").update(bytes).digest("hex")}`).toBe(archive.content_digest);
      expect(bytes.byteLength).toBeGreaterThan(0);
    }

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

    const reviewedBoard = reviewedBoardOccurrences();
    const expectedByProject = new Map<string, string[]>();
    for (const projectId of ["atlas", "aurora", "nebula"]) {
      const board = reviewedBoard
        .filter((entry) => entry.board === projectId && entry.scope === "current")
        .map((entry) => [
          projectId,
          "dts",
          canonicalDtsLocator("board.dts", entry.nodePath),
          entry.formalSubject.kind === "driver" ? "driver" : "node-type",
          canonicalSubjectKey(entry.formalSubject.kind, entry.formalSubject.value),
          entry.propertyKey,
        ].join("|"));
      expect(board).toHaveLength(120);
      expectedByProject.set(projectId, [
        ...board,
        `${projectId}|dts|${canonicalDtsLocator("charging-thermal.dts", "wiseeff_node_type_demo/charging_core")}|node-type|node-type:charging_core|fast-charge-profile-matrix`,
        `${projectId}|dts|${canonicalDtsLocator("charging-thermal.dts", "wiseeff_node_type_demo/charging_core")}|node-type|node-type:charging_core|battery-thermal-derate-curve`,
        `${projectId}|json|/charger.cv.limitMv|configuration-schema|configuration-schema:wiseeff.power-config|charger.cv.limitMv`,
        `${projectId}|json|/battery.thermal.targetTempC|configuration-schema|configuration-schema:wiseeff.power-config|battery.thermal.targetTempC`,
      ].sort());
    }

    const identityRows = await pool.query<{
      project_id: string;
      binding_id: string;
      occurrence_kind: "dts" | "json";
      logical_node_id: string | null;
      node_locator: string | null;
      source_ref: string;
      source_name: string;
      locator: unknown;
      subject_kind: string;
      subject_canonical_key: string;
      property_key: string;
      value_kind: string;
      value: unknown;
    }>(
      `select b.project_id, b.id as binding_id, occurrence.occurrence_kind,
              occurrence.logical_node_id, node.node_locator, value.source_ref,
              member.source_name, pin.locator,
              subject.kind as subject_kind, subject.canonical_key as subject_canonical_key,
              definition.property_key, value.value_kind, value.value
         from parameter_catalog.current_project_parameter_bindings b
         join parameter_catalog.project_parameter_source_occurrences occurrence
           on occurrence.id = b.source_occurrence_id
         join parameter_catalog.project_parameter_values value
           on value.id = b.current_value_id
         join parameter_catalog.project_value_source_pins pin
           on pin.binding_id = b.id and pin.project_value_id = b.current_value_id
         left join public.dts_logical_node_revisions node
           on node.logical_node_id = occurrence.logical_node_id
          and node.config_revision_id = pin.config_revision_id
         join parameter_catalog.catalog_subjects subject
           on subject.id = b.subject_id
         join parameter_catalog.parameter_definitions definition
           on definition.id = b.definition_id
         join public.dts_config_revision_members member
           on member.config_revision_id = pin.config_revision_id
          and member.file_id = pin.file_id
          and member.file_version_id = pin.file_version_id
        where b.organization_id = $1
        order by b.project_id, b.id`,
      [ORG],
    );
    const actualByProject = new Map<string, string[]>();
    const bindingIds = new Set<string>();
    const bindingIdsByTuple = new Map<string, string>();
    for (const row of identityRows.rows) {
      bindingIds.add(row.binding_id);
      const locator = (typeof row.locator === "string" ? JSON.parse(row.locator) : row.locator) as {
        readonly pointer?: string;
      } | null;
      const isJson = row.occurrence_kind === "json";
      const normalizedLocator = isJson
        ? locator?.pointer ?? ""
        : normalizedDtsSourceRef(row.source_ref);
      const tuple = [
        row.project_id,
        row.occurrence_kind,
        normalizedLocator,
        row.subject_kind,
        `${row.subject_kind}:${row.subject_canonical_key}`,
        row.property_key,
      ].join("|");
      expect(bindingIdsByTuple.has(tuple)).toBe(false);
      bindingIdsByTuple.set(tuple, row.binding_id);
      const projectRows = actualByProject.get(row.project_id) ?? [];
      projectRows.push(tuple);
      actualByProject.set(row.project_id, projectRows);
      const expected = expectedSeedValues[row.project_id as keyof typeof expectedSeedValues]?.[
        row.property_key as keyof (typeof expectedSeedValues)["atlas"]
      ];
      if (expected) {
        expect(row.value_kind).toBe(expected.valueKind);
        expect(row.value).toEqual(expected.value);
      }
      if (isJson) {
        expect(row.logical_node_id).toBeNull();
        expect(row.node_locator).toBeNull();
      } else {
        expect(row.logical_node_id).not.toBeNull();
        expect(row.node_locator).not.toBeNull();
        expect(normalizedDtsSourceRef(row.source_ref)).toBe(
          canonicalDtsLocator(row.source_name, row.node_locator!),
        );
      }
    }
    expect(bindingIds.size).toBe(372);
    expect(bindingIdsByTuple.size).toBe(372);
    for (const projectId of ["atlas", "aurora", "nebula"]) {
      expect(actualByProject.get(projectId)?.slice().sort()).toEqual(expectedByProject.get(projectId));
    }

    for (const project of outcome.projects) {
      const members = await pool.query<{
        file_name: string;
        config_set_role: string;
        config_set_sort_order: number;
      }>(
        `select file_name, config_set_role, config_set_sort_order
           from public.project_parameter_files
          where config_set_id = $1
          order by config_set_sort_order, file_name`,
        [project.configSetId],
      );
      expect(members.rows).toEqual([
        { file_name: "board.dts", config_set_role: "base", config_set_sort_order: 0 },
        { file_name: "charging-thermal.dts", config_set_role: "overlay", config_set_sort_order: 1 },
        { file_name: "power-config.json", config_set_role: "misc", config_set_sort_order: 102 },
      ]);
      const revision = await pool.query<{ entry_file: string; overlay_order: string[] }>(
        `select entry_file, overlay_order
           from public.dts_config_revisions
          where id = $1`,
        [project.configRevisionId],
      );
      expect(revision.rows).toEqual([{ entry_file: "board.dts", overlay_order: ["charging-thermal.dts"] }]);
    }

    const customSeedRows = await pool.query<{
      files: string;
      revisions: string;
      bindings: string;
      value_rows: string;
    }>(
      `select
         (select count(*)::text from public.project_parameter_files where project_id = 'custom-sentinel') as files,
         (select count(*)::text from public.dts_config_revisions where project_id = 'custom-sentinel') as revisions,
         (select count(*)::text from parameter_catalog.project_parameter_bindings where project_id = 'custom-sentinel') as bindings,
         (select count(*)::text
            from parameter_catalog.project_parameter_values value
            join parameter_catalog.project_parameter_bindings binding on binding.id = value.binding_id
           where binding.project_id = 'custom-sentinel') as value_rows`,
    );
    expect(customSeedRows.rows[0]).toEqual({ files: "0", revisions: "0", bindings: "0", value_rows: "0" });
    const customAfterFirstMaterialization = await pool.query(
      `select project.id, project.organization_id, project.name, project.code, project.status,
              role.id as role_binding_id, role.user_id, role.role_id
         from public.projects project
         left join public.user_role_bindings role
           on role.organization_id = project.organization_id and role.project_id = project.id
        where project.id = 'custom-sentinel'
        order by role.id`,
    );
    expect(customAfterFirstMaterialization.rows).toEqual(customBefore.rows);
    expect(await captureNonParameterState()).toEqual(nonParameterBefore);

    const beforeReplay = await pool.query(
      `select b.id, b.current_value_id, b.effective_revision_id
         from parameter_catalog.current_project_parameter_bindings b
        where b.organization_id = $1
        order by b.project_id, b.id`,
      [ORG],
    );
    await pool.query(
      `update public.projects
          set name = 'Custom user edit preserved through replay'
        where id = 'custom-sentinel' and organization_id = $1`,
      [ORG],
    );
    const customAfterEdit = await pool.query(
      `select project.id, project.organization_id, project.name, project.code, project.status,
              role.id as role_binding_id, role.user_id, role.role_id
         from public.projects project
         left join public.user_role_bindings role
           on role.organization_id = project.organization_id and role.project_id = project.id
        where project.id = 'custom-sentinel'
        order by role.id`,
    );
    const captureCanonicalReplayState = async () => {
      const query = async (sql: string) => (await pool.query(sql, [ORG, "atlas"])).rows;
      return {
        bindings: await query(
          `select * from parameter_catalog.project_parameter_bindings
            where organization_id = $1 and project_id = $2 order by id`,
        ),
        values: await query(
          `select value.* from parameter_catalog.project_parameter_values value
             join parameter_catalog.project_parameter_bindings binding on binding.id = value.binding_id
            where binding.organization_id = $1 and binding.project_id = $2 order by value.id`,
        ),
        sourceOccurrences: await query(
          `select * from parameter_catalog.project_parameter_source_occurrences
            where organization_id = $1 and project_id = $2 order by id`,
        ),
        sourcePins: await query(
          `select * from parameter_catalog.project_value_source_pins
            where organization_id = $1 and project_id = $2 order by id`,
        ),
        history: await query(
          `select history.* from parameter_catalog.binding_history_events history
             join parameter_catalog.project_parameter_bindings binding on binding.id = history.binding_id
            where binding.organization_id = $1 and binding.project_id = $2 order by history.id`,
        ),
        drafts: await query(
          `select * from public.project_parameter_value_drafts
            where organization_id = $1 and project_id = $2 order by id`,
        ),
        requests: await query(
          `select * from public.project_parameter_value_change_requests
            where organization_id = $1 and project_id = $2 order by id`,
        ),
        candidates: await query(
          `select * from public.project_parameter_file_candidates
            where organization_id = $1 and project_id = $2 order by id`,
        ),
        files: await query(
          `select * from public.project_parameter_files
            where organization_id = $1 and project_id = $2 order by id`,
        ),
        versions: await query(
          `select version.* from public.project_parameter_file_versions version
             join public.project_parameter_files file on file.id = version.file_id
            where file.organization_id = $1 and file.project_id = $2 order by version.id`,
        ),
        revisions: await query(
          `select * from public.dts_config_revisions
            where organization_id = $1 and project_id = $2 order by id`,
        ),
        members: await query(
          `select member.* from public.dts_config_revision_members member
             join public.dts_config_revisions revision on revision.id = member.config_revision_id
            where revision.organization_id = $1 and revision.project_id = $2 order by member.id`,
        ),
        audits: await query(
          `select * from public.audit_events
            where organization_id = $1 and project_id = $2 order by id`,
        ),
      };
    };
    const draftTarget = await pool.query<{
      binding_id: string;
      current_value_id: string;
      config_revision_id: string;
    }>(
      `select binding.id as binding_id, binding.current_value_id, pin.config_revision_id
         from parameter_catalog.current_project_parameter_bindings binding
         join parameter_catalog.project_value_source_pins pin
           on pin.binding_id = binding.id and pin.project_value_id = binding.current_value_id
         join parameter_catalog.project_parameter_values value
           on value.id = binding.current_value_id
        where binding.organization_id = $1 and binding.project_id = 'atlas'
          and value.value_kind = 'number'
        order by binding.id
        limit 1`,
      [ORG],
    );
    expect(draftTarget.rows).toHaveLength(1);
    const target = draftTarget.rows[0]!;
    const canonicalDraft = await createCanonicalValueDraft(
      root,
      adminAuth,
      {
        projectId: "atlas",
        bindingId: target.binding_id,
        action: "set",
        targetValue: {
          kind: "cells",
          bits: 32,
          groups: [[{ kind: "integer", raw: "12345", value: "12345" }]],
        },
        reason: "T13 replay preservation witness",
        baseRevisionId: target.config_revision_id,
        baseCurrentValueId: target.current_value_id,
      },
      {
        objectStore,
        invocation: createUserInvocation(adminAuth),
        requestId: "t13-canonical-draft",
        refusalSink: createTrustedRefusalAuditSink(root),
      },
    );
    const canonicalChange = await submitCanonicalValueChange(root, adminAuth, {
      projectId: "atlas",
      draftId: canonicalDraft.id,
      assignedToUserId: "user-seed-t13-reviewer",
      invocation: createUserInvocation(adminAuth),
      requestId: "t13-canonical-submit",
      refusalSink: createTrustedRefusalAuditSink(root),
    });
    expect(canonicalChange.status).toBe("pending");
    expect(canonicalChange.draftId).toBe(canonicalDraft.id);
    const beforeCanonicalUserChange = await captureCanonicalReplayState();
    const replaySources = sources.slice().reverse().map((project) => ({
      ...project,
      files: project.files.slice().reverse(),
    }));
    expect(canonicalSeedInitializationDigest({
      organizationId: ORG,
      files: replaySources.flatMap((project) => project.files.map((file) => ({
        projectId: project.projectId,
        name: file.name as "board.dts" | "charging-thermal.dts" | "power-config.json",
        content: file.content,
      }))),
    })).toBe(seedDigest);
    const replay = await materializeSeedSources(root, objectStore, adminAuth, {
      organizationId: ORG,
      seedDigest,
      sources: replaySources,
    });
    expect(replay).toEqual({ status: "already-complete", seedDigest, projects: [] });
    const afterCanonicalUserChange = await captureCanonicalReplayState();
    expect(afterCanonicalUserChange).toEqual(beforeCanonicalUserChange);
    const afterReplay = await pool.query<{ count: string }>(
      `select count(*)::text as count from parameter_catalog.project_parameter_bindings where organization_id = $1`,
      [ORG],
    );
    expect(afterReplay.rows[0]!.count).toBe("372");
    const afterReplayBindings = await pool.query(
      `select b.id, b.current_value_id, b.effective_revision_id
         from parameter_catalog.current_project_parameter_bindings b
        where b.organization_id = $1
        order by b.project_id, b.id`,
      [ORG],
    );
    expect(afterReplayBindings.rows).toEqual(beforeReplay.rows);
    const afterReplayIdentity = await pool.query<{
      project_id: string;
      binding_id: string;
      occurrence_kind: "dts" | "json";
      source_ref: string;
      locator: unknown;
      subject_kind: string;
      subject_canonical_key: string;
      property_key: string;
    }>(
      `select b.project_id, b.id as binding_id, occurrence.occurrence_kind, value.source_ref,
              pin.locator, subject.kind as subject_kind, subject.canonical_key as subject_canonical_key,
              definition.property_key
         from parameter_catalog.current_project_parameter_bindings b
         join parameter_catalog.project_parameter_source_occurrences occurrence
           on occurrence.id = b.source_occurrence_id
         join parameter_catalog.project_parameter_values value
           on value.id = b.current_value_id
         join parameter_catalog.project_value_source_pins pin
           on pin.binding_id = b.id and pin.project_value_id = b.current_value_id
         join parameter_catalog.catalog_subjects subject on subject.id = b.subject_id
         join parameter_catalog.parameter_definitions definition on definition.id = b.definition_id
        where b.organization_id = $1
        order by b.project_id, b.id`,
      [ORG],
    );
    const replayBindingIdsByTuple = new Map<string, string>();
    for (const row of afterReplayIdentity.rows) {
      const locator = (typeof row.locator === "string" ? JSON.parse(row.locator) : row.locator) as {
        readonly pointer?: string;
      } | null;
      const tuple = [
        row.project_id,
        row.occurrence_kind,
        row.occurrence_kind === "json" ? locator?.pointer ?? "" : normalizedDtsSourceRef(row.source_ref),
        row.subject_kind,
        `${row.subject_kind}:${row.subject_canonical_key}`,
        row.property_key,
      ].join("|");
      expect(replayBindingIdsByTuple.has(tuple)).toBe(false);
      replayBindingIdsByTuple.set(tuple, row.binding_id);
    }
    expect([...replayBindingIdsByTuple.entries()].sort()).toEqual([...bindingIdsByTuple.entries()].sort());
    const customAfterReplay = await pool.query(
      `select project.id, project.organization_id, project.name, project.code, project.status,
              role.id as role_binding_id, role.user_id, role.role_id
         from public.projects project
         left join public.user_role_bindings role
           on role.organization_id = project.organization_id and role.project_id = project.id
        where project.id = 'custom-sentinel'
        order by role.id`,
    );
    expect(customAfterReplay.rows).toEqual(customAfterEdit.rows);
    expect(await captureNonParameterState()).toEqual(nonParameterBefore);
  }, 240_000);
});
