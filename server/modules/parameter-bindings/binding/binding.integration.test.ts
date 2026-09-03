import { Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { stringify } from "yaml";

import { compileCatalogRelease } from "../../catalog-kernel/compiler/index";
import {
  refreshReleaseAggregateDigest,
  validCatalogReleaseBundle,
} from "../../catalog-kernel/compiler/__fixtures__/catalogReleaseBundle";
import type {
  CatalogReleaseBundle,
  CatalogReleaseDefinitionDocument,
  CatalogReleaseNode,
} from "../../catalog-kernel/compiler/types";
import {
  createCatalogKernel,
  jsonCatalogReleaseSource,
  type CatalogSnapshot,
} from "../../catalog-kernel/interface";
import { installPublishedRelease } from "../../catalog-kernel/install/installer";
import {
  CatalogSubjectId,
  DefinitionRevisionId,
  ParameterBindingId,
  ParameterDefinitionId,
  serializeContract,
  SubjectRegistrationId,
  type CatalogReleasePin,
  type ContractJsonValue,
} from "../../parameter-catalog-contract/index";
import type { RegisterSubjectCommand } from "../../parameter-governance/registration/command";
import { writeGuardedRegistration } from "../../parameter-governance/registration/internalGuardedRegistrationWriter";
import {
  createEphemeralTestDatabase,
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type EphemeralTestDatabase,
} from "../../../testing/testDatabase";

import { createBindingService } from "./index";
import { mapLegacyBinding, loadLegacyBindingIdentity } from "./migrationAdapter";

const databaseAvailable = await isTestDatabaseAvailable();
if (!databaseAvailable) {
  throw new Error(
    "S6-BND requires a reachable real PostgreSQL server with pgvector; skipping is forbidden",
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
    "S6-BND requires pgvector installed in the real PostgreSQL test database; skipping is forbidden",
  );
}

const ORG_A = "org-s6-bnd";
const ORG_B = "org-s6-bnd-b";
const ATTR_A = "attr-s6-bnd";
const ATTR_B = "attr-s6-bnd-b";
const MODULE_A = "pmod-s6-bnd-driver";
const MODULE_B = "pmod-s6-bnd-driver-b";
const PROJECT_A = "project-s6-bnd";
const PROJECT_B = "project-s6-bnd-b";
const SUBJECT_ID = CatalogSubjectId("csub_acme_power");
const DEFINITION_ID = ParameterDefinitionId("pdef_acme_power_iin_max");
const REVISION_1 = DefinitionRevisionId("drev_acme_power_iin_max_1");
const REVISION_2 = DefinitionRevisionId("drev_acme_power_iin_max_2");
const NODE_SUCCESS = "logical-node-s6-bnd";
const NODE_LATEST = "logical-node-latest";
const NODE_MAP = "logical-node-map";

const sha256 = (bytes: string | Uint8Array): string =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

const firstReleaseBundle = (): CatalogReleaseBundle => {
  const full = validCatalogReleaseBundle();
  const first = structuredClone(full.releases[0]!);
  return {
    schemaVersion: full.schemaVersion,
    targetReleaseId: first.manifest.release.id,
    releases: [first],
  };
};

const refreshReleaseSource = (release: CatalogReleaseNode): void => {
  for (const document of release.documents) {
    if (document.kind === "definition") {
      const revision = document.content.revision;
      const model: Record<string, ContractJsonValue> = {
        "/lifecycle": revision.lifecycle,
        "/displayName": revision.displayName,
        "/documentation": revision.documentation,
        "/valueSchema": revision.valueSchema,
        "/matching": revision.matching,
      };
      if (revision.unit !== undefined) model["/unit"] = revision.unit;
      document.content.revision.contentDigest = sha256(serializeContract(model));
    }
    document.normalizedDigest = sha256(
      serializeContract(document.content as unknown as ContractJsonValue),
    );
  }
  const bytes = Buffer.from(
    stringify(
      {
        schemaVersion: "1.0.0",
        documents: release.documents.map((document) => ({
          kind: document.kind,
          content: document.content,
        })),
      },
      { lineWidth: 0 },
    ),
    "utf8",
  );
  const digest = sha256(bytes);
  const sourcePath = release.manifest.files[0]?.path ?? "schemas/dts/vendor/acme-power.yaml";
  release.sources = [
    {
      path: sourcePath,
      mediaType: "application/yaml",
      encoding: "base64",
      bytes: bytes.toString("base64"),
    },
  ];
  release.manifest.files = [{ path: sourcePath, mediaType: "application/yaml", digest }];
  for (const document of release.documents) {
    document.source = { path: sourcePath, mediaType: "application/yaml", digest };
  }
  release.manifest.documents = release.documents.map((document) => ({
    sourcePath: document.source.path,
    kind: document.kind,
    documentId: document.content.id,
    normalizedDigest: document.normalizedDigest,
  }));
  refreshReleaseAggregateDigest(release);
};

const successorWithNewRevisionBundle = (): CatalogReleaseBundle => {
  const bundle = structuredClone(validCatalogReleaseBundle());
  const current = bundle.releases.find(
    (release) => release.manifest.release.id === bundle.targetReleaseId,
  );
  if (!current) throw new Error("successor release missing");
  const definition = current.documents.find(
    (document): document is CatalogReleaseDefinitionDocument => document.kind === "definition",
  );
  if (!definition) throw new Error("successor definition missing");
  definition.content.revision.id = REVISION_2;
  definition.content.revision.number = 2;
  definition.content.revision.documentation = "Maximum accepted input current (raised).";
  refreshReleaseSource(current);
  return bundle;
};

const compileOrThrow = (bundle: CatalogReleaseBundle) => {
  const compiled = compileCatalogRelease(bundle);
  if (!compiled.ok) {
    throw new Error(
      `fixture failed to compile: ${compiled.error.kind} ${JSON.stringify(compiled.error.violations)}`,
    );
  }
  return compiled.value;
};

describe("canonical Binding identity", () => {
  let database: EphemeralTestDatabase;
  let pool: pg.Pool;
  let firstPin: CatalogReleasePin;
  let secondPin: CatalogReleasePin;
  let snapshot1: CatalogSnapshot;
  let snapshot2: CatalogSnapshot;
  let registrationA: SubjectRegistrationId;
  let registrationB: SubjectRegistrationId;
  let service: ReturnType<typeof createBindingService>;

  const registerCommand = (
    organizationId: string,
    moduleId: string,
    expectedRelease: CatalogReleasePin,
  ): RegisterSubjectCommand => ({
    kind: "register",
    organizationId,
    subjectId: SUBJECT_ID,
    subjectKind: "driver",
    expectedRelease,
    placement: { mode: "use-default" },
    destinationModuleId: moduleId,
    method: "explicit",
    proof: { reason: "s6-bnd-captured-kernel-proof" },
    idempotencyKey: `reg:${organizationId}:${randomUUID()}`,
    context: { actorKind: "org-admin", principalId: "user-org-admin" },
  });

  const seedRegistration = async (command: RegisterSubjectCommand) => {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("set constraints all deferred");
      const written = await writeGuardedRegistration(client, command);
      if (!written.ok) {
        await client.query("rollback");
        return written;
      }
      await client.query("set constraints all immediate");
      await client.query("commit");
      return written;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  };

  const catalogCounts = async () => {
    const result = await pool.query<{
      releases: string;
      subjects: string;
      bindings: string;
    }>(`
      select
        (select count(*)::text from parameter_catalog.catalog_releases) as releases,
        (select count(*)::text from parameter_catalog.catalog_subjects) as subjects,
        (select count(*)::text from parameter_catalog.project_parameter_bindings) as bindings
    `);
    return result.rows[0]!;
  };

  const bindingResidue = async (logicalNodeId: string) => {
    const result = await pool.query<{ count: string; owners: string }>(
      `
      select count(*)::text as count,
             coalesce(string_agg(organization_id || ':' || registration_id, ',' order by id), '') as owners
        from parameter_catalog.project_parameter_bindings
       where project_id = $1
         and logical_node_id = $2
         and definition_id = $3
      `,
      [PROJECT_A, logicalNodeId, DEFINITION_ID],
    );
    return result.rows[0]!;
  };

  beforeAll(async () => {
    database = await createEphemeralTestDatabase("s6bnd");
    pool = new pg.Pool({ connectionString: database.url, max: 4 });
    const first = compileOrThrow(firstReleaseBundle());
    const installed = await installPublishedRelease(pool, {
      mode: "bootstrap",
      source: jsonCatalogReleaseSource(firstReleaseBundle()),
      expectedTargetDigest: first.aggregateDigest,
    });
    expect(installed.ok).toBe(true);
    firstPin = { id: first.release.id, digest: first.release.digest };

    await pool.query(
      `insert into public.organizations (id, name) values ($1, 'S6 BND A'), ($2, 'S6 BND B')`,
      [ORG_A, ORG_B],
    );
    await pool.query(
      `insert into public.projects (id, organization_id, name, code) values
         ($1, $3, 'S6 BND A', 'S6BNDA'),
         ($2, $4, 'S6 BND B', 'S6BNDB')`,
      [PROJECT_A, PROJECT_B, ORG_A, ORG_B],
    );
    await pool.query(
      `insert into public.attribution_subjects (
         id, organization_id, subject_kind, display_name, source_key
       ) values
         ($1, $3, 'driver-registration', 'S6 BND driver A', 'compatible:acme,power'),
         ($2, $4, 'driver-registration', 'S6 BND driver B', 'compatible:acme,power')`,
      [ATTR_A, ATTR_B, ORG_A, ORG_B],
    );
    await pool.query(
      `insert into public.driver_registrations (
         attribution_subject_id, driver_nature, instance_cardinality
       ) values ($1, 'physical-device', 'multiple'), ($2, 'physical-device', 'multiple')`,
      [ATTR_A, ATTR_B],
    );
    await pool.query(
      `insert into public.parameter_modules (
         id, organization_id, name, path, depth, kind, origin, attribution_subject_id
       ) values
         ($1, $3, 'Driver A', $1, 1, 'driver-group', 'curated', $5),
         ($2, $4, 'Driver B', $2, 1, 'driver-group', 'curated', $6)`,
      [MODULE_A, MODULE_B, ORG_A, ORG_B, ATTR_A, ATTR_B],
    );

    const registeredA = await seedRegistration(registerCommand(ORG_A, MODULE_A, firstPin));
    const registeredB = await seedRegistration(registerCommand(ORG_B, MODULE_B, firstPin));
    expect(registeredA.ok).toBe(true);
    expect(registeredB.ok).toBe(true);
    if (!registeredA.ok || !registeredB.ok) {
      throw new Error("S4-REG writeGuardedRegistration failed to seed active Registration");
    }
    registrationA = registeredA.value.registrationId;
    registrationB = registeredB.value.registrationId;

    const kernel = createCatalogKernel(pool);
    const loaded1 = await kernel.loadPinnedCatalog(firstPin);
    expect(loaded1.ok).toBe(true);
    if (!loaded1.ok) throw new Error("failed to load frozen snapshot");
    snapshot1 = loaded1.value;

    const successor = compileOrThrow(successorWithNewRevisionBundle());
    const advanced = await installPublishedRelease(pool, {
      mode: "advance",
      source: jsonCatalogReleaseSource(successorWithNewRevisionBundle()),
      expectedCurrent: firstPin,
      expectedTargetDigest: successor.aggregateDigest,
    });
    expect(advanced.ok).toBe(true);
    secondPin = { id: successor.release.id, digest: successor.release.digest };
    const loaded2 = await kernel.loadCurrentCatalog(secondPin);
    expect(loaded2.ok).toBe(true);
    if (!loaded2.ok) throw new Error("failed to load current snapshot");
    snapshot2 = loaded2.value;

    service = createBindingService(pool);
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    await database?.drop();
  });

  it("stabilizes one Binding from snapshot+registration+revision+owner+project+node", async () => {
    const result = await service.stabilize({
      snapshot: snapshot1,
      organizationId: ORG_A,
      projectId: PROJECT_A,
      logicalNodeId: NODE_SUCCESS,
      registrationId: registrationA,
      definitionId: DEFINITION_ID,
      effectiveRevisionId: REVISION_1,
      expectedEffectiveRevisionId: null,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.outcome).toBe("committed");
    expect(result.value.binding.logicalNodeId).toBe(NODE_SUCCESS);
    expect(result.value.binding.registrationId).toBe(registrationA);
    expect(result.value.binding.effectiveRevisionId).toBe(REVISION_1);
    expect(result.value.binding.catalogRelease.id).toBe(firstPin.id);
    expect("moduleId" in result.value.binding).toBe(false);
    expect(result.value.binding.id).toMatch(/^pbind_[0-9a-f]{64}$/);

    const stored = await bindingResidue(NODE_SUCCESS);
    expect(stored.count).toBe("1");
    expect(stored.owners).toBe(`${ORG_A}:${registrationA}`);
  });

  it("refuses module identity and latest-head disagreement without writing a Binding", async () => {
    const latest = await service.stabilize({
      snapshot: snapshot1,
      organizationId: ORG_A,
      projectId: PROJECT_A,
      logicalNodeId: NODE_LATEST,
      registrationId: registrationA,
      definitionId: DEFINITION_ID,
      effectiveRevisionId: REVISION_2,
      expectedEffectiveRevisionId: null,
    });
    expect(latest.ok).toBe(false);
    if (latest.ok) return;
    expect(latest.error).toEqual({ kind: "agreement-conflict", reason: "latest-head" });
    expect(await bindingResidue(NODE_LATEST)).toEqual({ count: "0", owners: "" });

    const moduleMap = await mapLegacyBinding(pool, {
      snapshot: snapshot1,
      legacy: {
        id: "legacy-module-only",
        organizationId: ORG_A,
        projectId: PROJECT_A,
        logicalNodeId: null,
        moduleId: MODULE_A,
        parameterSpecId: "pspec-s6-bnd",
      },
      registrationId: registrationA,
      definitionId: DEFINITION_ID,
      effectiveRevisionId: REVISION_1,
    });
    expect(moduleMap.ok).toBe(false);
    if (moduleMap.ok) return;
    expect(moduleMap.error).toEqual({ kind: "agreement-conflict", reason: "module-identity" });
  });

  it("replays the same composite agreement to the same Binding ID", async () => {
    const first = await service.stabilize({
      snapshot: snapshot1,
      organizationId: ORG_A,
      projectId: PROJECT_A,
      logicalNodeId: NODE_SUCCESS,
      registrationId: registrationA,
      definitionId: DEFINITION_ID,
      effectiveRevisionId: REVISION_1,
      expectedEffectiveRevisionId: null,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const replay = await service.stabilize({
      snapshot: snapshot1,
      organizationId: ORG_A,
      projectId: PROJECT_A,
      logicalNodeId: NODE_SUCCESS,
      registrationId: registrationA,
      definitionId: DEFINITION_ID,
      effectiveRevisionId: REVISION_1,
      expectedEffectiveRevisionId: null,
    });
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    expect(replay.value.outcome).toBe("replayed");
    expect(replay.value.binding.id).toBe(first.value.binding.id);
    expect(await bindingResidue(NODE_SUCCESS)).toMatchObject({ count: "1" });
  });

  it("refuses a stale CAS token and does not overwrite the effective revision", async () => {
    const before = await pool.query<{
      effective_revision_id: string;
      catalog_release_id: string;
    }>(
      `select effective_revision_id, catalog_release_id
         from parameter_catalog.project_parameter_bindings
        where project_id = $1 and logical_node_id = $2 and definition_id = $3`,
      [PROJECT_A, NODE_SUCCESS, DEFINITION_ID],
    );
    const mismatch = await service.stabilize({
      snapshot: snapshot2,
      organizationId: ORG_A,
      projectId: PROJECT_A,
      logicalNodeId: NODE_SUCCESS,
      registrationId: registrationA,
      definitionId: DEFINITION_ID,
      effectiveRevisionId: REVISION_2,
      expectedEffectiveRevisionId: REVISION_2,
    });
    expect(mismatch.ok).toBe(false);
    if (mismatch.ok) return;
    expect(mismatch.error.kind).toBe("cas-mismatch");
    if (mismatch.error.kind === "cas-mismatch") {
      expect(mismatch.error.actualEffectiveRevisionId).toBe(REVISION_1);
    }
    const after = await pool.query<{
      effective_revision_id: string;
      catalog_release_id: string;
    }>(
      `select effective_revision_id, catalog_release_id
         from parameter_catalog.project_parameter_bindings
        where project_id = $1 and logical_node_id = $2 and definition_id = $3`,
      [PROJECT_A, NODE_SUCCESS, DEFINITION_ID],
    );
    expect(after.rows[0]).toEqual(before.rows[0]);
  });

  it("cuts over the effective revision when the expected token matches", async () => {
    const cutover = await service.stabilize({
      snapshot: snapshot2,
      organizationId: ORG_A,
      projectId: PROJECT_A,
      logicalNodeId: NODE_SUCCESS,
      registrationId: registrationA,
      definitionId: DEFINITION_ID,
      effectiveRevisionId: REVISION_2,
      expectedEffectiveRevisionId: REVISION_1,
    });
    expect(cutover.ok).toBe(true);
    if (!cutover.ok) return;
    expect(cutover.value.outcome).toBe("committed");
    expect(cutover.value.binding.id).toMatch(/^pbind_/);
    expect(cutover.value.binding.effectiveRevisionId).toBe(REVISION_2);
    expect(cutover.value.binding.catalogRelease.id).toBe(secondPin.id);
    const stored = await pool.query<{
      effective_revision_id: string;
      catalog_release_id: string;
      organization_id: string;
    }>(
      `select effective_revision_id, catalog_release_id, organization_id
         from parameter_catalog.project_parameter_bindings
        where project_id = $1 and logical_node_id = $2 and definition_id = $3`,
      [PROJECT_A, NODE_SUCCESS, DEFINITION_ID],
    );
    expect(stored.rows).toEqual([
      {
        effective_revision_id: REVISION_2,
        catalog_release_id: secondPin.id,
        organization_id: ORG_A,
      },
    ]);
  });

  it("maps one proven legacy identity onto the canonical Binding and refuses Catalog writes", async () => {
    await pool.query(
      `insert into public.parameter_specs (
         id, organization_id, source_kind, specification_key, definition_lifecycle
       ) values ($1, $2, 'manual', 's6-bnd-legacy', 'draft')`,
      ["pspec-s6-bnd", ORG_A],
    );
    await pool.query(
      `insert into public.project_parameter_bindings (
         id, organization_id, project_id, parameter_spec_id, module_id
       ) values ($1, $2, $3, $4, $5)`,
      ["legacy-unproven-s6", ORG_A, PROJECT_A, "pspec-s6-bnd", MODULE_A],
    );
    const loaded = await loadLegacyBindingIdentity(pool, "legacy-unproven-s6");
    expect(loaded?.logicalNodeId).toBeNull();
    const before = await catalogCounts();
    const refused = await mapLegacyBinding(pool, {
      snapshot: snapshot1,
      legacy: loaded!,
      registrationId: registrationA,
      definitionId: DEFINITION_ID,
      effectiveRevisionId: REVISION_1,
    });
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error).toEqual({ kind: "agreement-conflict", reason: "module-identity" });
    expect(await catalogCounts()).toEqual(before);

    const mapped = await mapLegacyBinding(pool, {
      snapshot: snapshot1,
      legacy: {
        id: "legacy-stable-s6",
        organizationId: ORG_A,
        projectId: PROJECT_A,
        logicalNodeId: NODE_MAP,
        moduleId: MODULE_A,
        parameterSpecId: "pspec-s6-bnd",
      },
      registrationId: registrationA,
      definitionId: DEFINITION_ID,
      effectiveRevisionId: REVISION_1,
    });
    expect(mapped.ok).toBe(true);
    if (!mapped.ok) return;
    expect(mapped.value.binding.id).toBe(ParameterBindingId("legacy-stable-s6"));
    expect(mapped.value.binding.logicalNodeId).toBe(NODE_MAP);
    expect("moduleId" in mapped.value.binding).toBe(false);
    const after = await catalogCounts();
    expect(after.releases).toBe(before.releases);
    expect(after.subjects).toBe(before.subjects);
    expect(Number(after.bindings)).toBe(Number(before.bindings) + 1);
  });

  it("refuses a cross-owner claim on another organization's project", async () => {
    const result = await service.stabilize({
      snapshot: snapshot1,
      organizationId: ORG_B,
      projectId: PROJECT_A,
      logicalNodeId: NODE_SUCCESS,
      registrationId: registrationB,
      definitionId: DEFINITION_ID,
      effectiveRevisionId: REVISION_1,
      expectedEffectiveRevisionId: null,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      kind: "agreement-conflict",
      reason: "project-owner-mismatch",
    });
    expect(await bindingResidue(NODE_SUCCESS)).toMatchObject({
      count: "1",
      owners: `${ORG_A}:${registrationA}`,
    });
  });
});
