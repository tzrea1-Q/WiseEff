import { Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

import { stabilizeCanonicalBinding } from "./index";
import {
  createSourceBackedBindingService,
  ensureSourceBackedBindingFixture,
  sourceBackedCommand,
} from "./__fixtures__/sourceBackedBinding";
import { mapLegacyBinding, loadLegacyBindingIdentity } from "./migrationAdapter";
import { createLocalObjectStore } from "../../logs/objectStore";

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
const NODE_LOCK = "logical-node-lock";

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
  let service: ReturnType<typeof createSourceBackedBindingService>;
  let storageDirectory: string;
  let objectStore: ReturnType<typeof createLocalObjectStore>;

  const mapLegacy = async (command: Parameters<typeof mapLegacyBinding>[2]) => {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("set constraints all deferred");
      const result = await mapLegacyBinding(client, objectStore, command);
      await client.query(result.ok ? "commit" : "rollback");
      return result;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  };

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
    storageDirectory = await mkdtemp(join(tmpdir(), "wiseeff-s6-bnd-"));
    objectStore = createLocalObjectStore(storageDirectory);
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

    service = createSourceBackedBindingService(pool, { objectStore });
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    await database?.drop();
    if (storageDirectory) await rm(storageDirectory, { recursive: true, force: true });
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

  it("rolls a joined-session stabilize back with the outer transaction", async () => {
    const logicalNodeId = "logical-node-s6-bnd-join";
    const client = await pool.connect();
    try {
      await client.query("begin");
      const result = await stabilizeCanonicalBinding(client, await sourceBackedCommand(client, {
        snapshot: snapshot1,
        organizationId: ORG_A,
        projectId: PROJECT_A,
        logicalNodeId,
        registrationId: registrationA,
        definitionId: DEFINITION_ID,
        effectiveRevisionId: REVISION_1,
        expectedEffectiveRevisionId: null,
      }));
      expect(result.ok).toBe(true);
      const inside = await client.query<{ c: string }>(
        `select count(*)::text as c from parameter_catalog.project_parameter_bindings where logical_node_id = $1`,
        [logicalNodeId],
      );
      expect(inside.rows[0]?.c).toBe("1");
      await client.query("rollback");
    } finally {
      client.release();
    }
    const residue = await bindingResidue(logicalNodeId);
    expect(residue.count).toBe("0");
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

    const moduleMap = await mapLegacy({
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
    const refused = await mapLegacy({
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

    const source = await (async () => {
      const fixture = await ensureSourceBackedBindingFixture(pool, {
        snapshot: snapshot1,
        organizationId: ORG_A,
        projectId: PROJECT_A,
        logicalNodeId: NODE_MAP,
        registrationId: registrationA,
        definitionId: DEFINITION_ID,
        effectiveRevisionId: REVISION_1,
        expectedEffectiveRevisionId: null,
      }, objectStore);
      const member = await pool.query<{ source_name: string; node_locator: string }>(
        `select member.source_name, revision.node_locator
           from public.dts_config_revision_members member
           join public.dts_logical_node_revisions revision
             on revision.config_revision_id = member.config_revision_id
          where member.config_revision_id = $1
            and member.file_id = $2
            and member.file_version_id = $3`,
        [fixture.configRevisionId, fixture.fileId, fixture.fileVersionId],
      );
      const exactMember = member.rows[0];
      if (!exactMember) throw new Error("source fixture member missing");
      const locator = {
        kind: "dts-property",
        propertyOccurrenceId: fixture.propertyOccurrenceId,
        nodeOccurrenceId: fixture.nodeOccurrenceId,
        fileVersionId: fixture.fileVersionId,
        propertyName: "iin_max",
      };
      return {
        sourceOccurrenceId: fixture.sourceOccurrenceId,
        sourceRef: `${exactMember.source_name}!${exactMember.node_locator}`,
        configRevisionId: fixture.configRevisionId,
        payload: { kind: "number" as const, value: 0 },
        pin: {
          id: "legacy-source-pin-s6",
          fileId: fixture.fileId,
          fileVersionId: fixture.fileVersionId,
          format: "dts" as const,
          propertyOccurrenceId: fixture.propertyOccurrenceId,
          locator,
          // Independent canonical byte oracle: fixed key order/spacing/LF, not the production serializer.
          locatorDigest: `sha256:${createHash("sha256").update(`{\n  "fileVersionId": ${JSON.stringify(locator.fileVersionId)},\n  "kind": "dts-property",\n  "nodeOccurrenceId": ${JSON.stringify(locator.nodeOccurrenceId)},\n  "propertyName": "iin_max",\n  "propertyOccurrenceId": ${JSON.stringify(locator.propertyOccurrenceId)}\n}\n`).digest("hex")}`,
        },
      };
    })();
    const missingLegacy = await mapLegacy({
      snapshot: snapshot1,
      legacy: {
        id: "legacy-missing-s6",
        organizationId: ORG_A,
        projectId: PROJECT_A,
        logicalNodeId: NODE_MAP,
        moduleId: MODULE_A,
        parameterSpecId: "pspec-s6-bnd",
      },
      registrationId: registrationA,
      definitionId: DEFINITION_ID,
      effectiveRevisionId: REVISION_1,
      source,
    });
    expect(missingLegacy).toEqual({
      ok: false,
      error: { kind: "agreement-conflict", reason: "legacy-unproven" },
    });
    await pool.query(
      `insert into public.project_parameter_bindings (
         id, organization_id, project_id, parameter_spec_id, module_id, logical_node_id
       ) values ($1, $2, $3, $4, $5, $6)`,
      ["legacy-stable-s6", ORG_A, PROJECT_A, "pspec-s6-bnd", MODULE_A, NODE_MAP],
    );
    const forgedSource = await mapLegacy({
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
      source: {
        ...source,
        pin: {
          ...source.pin,
          propertyOccurrenceId: "forged-property-occurrence",
        },
      },
    });
    expect(forgedSource).toEqual({
      ok: false,
      error: { kind: "agreement-conflict", reason: "legacy-unproven" },
    });
    const mapped = await mapLegacy({
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
      source,
    });
    // Red tracer: the persisted source says `<5>`, while the caller claims `0`.
    // A caller payload is not authoritative source proof and must not create a
    // canonical Binding/value/pin/history row.
    expect(mapped).toEqual({
      ok: false,
      error: { kind: "agreement-conflict", reason: "legacy-unproven" },
    });
    const after = await catalogCounts();
    expect(after.releases).toBe(before.releases);
    expect(after.subjects).toBe(before.subjects);
    expect(after.bindings).toBe(before.bindings);
    const validCommand = {
      snapshot: snapshot1,
      legacy: (await loadLegacyBindingIdentity(pool,"legacy-stable-s6"))!,
      registrationId: registrationA,definitionId: DEFINITION_ID,effectiveRevisionId: REVISION_1,
      source: { ...source,payload: { kind: "number" as const,value: 5 } },
    };
    expect(await mapLegacy(validCommand)).toMatchObject({ ok: true,value: { binding: { id: "legacy-stable-s6" } } });
    const persistedState = async () => (await pool.query(`select
      (select count(*) from parameter_catalog.project_parameter_bindings) as bindings,
      (select count(*) from parameter_catalog.project_parameter_values) as values,
      (select count(*) from parameter_catalog.project_value_source_pins) as pins,
      (select count(*) from parameter_catalog.binding_history_events) as histories`)).rows;
    const accepted = await persistedState();
    expect(await mapLegacy({ ...validCommand,source: { ...validCommand.source,pin: { ...source.pin,
      locatorDigest: `sha256:${createHash("sha256").update(JSON.stringify(source.pin.locator)).digest("hex")}`,
    } } })).toEqual({ ok: false,error: { kind: "agreement-conflict",reason: "legacy-unproven" } });
    expect(await persistedState()).toEqual(accepted);
    expect(await mapLegacy(validCommand)).toMatchObject({ ok: true });
    expect(await persistedState()).toEqual(accepted);
  });

  it("refuses a legacy mapping immediately when another transaction holds the legacy row", async () => {
    const fixture = await ensureSourceBackedBindingFixture(pool, {
      snapshot: snapshot1,
      organizationId: ORG_A,
      projectId: PROJECT_A,
      logicalNodeId: NODE_LOCK,
      registrationId: registrationA,
      definitionId: DEFINITION_ID,
      effectiveRevisionId: REVISION_1,
      expectedEffectiveRevisionId: null,
    }, objectStore);
    await pool.query(
      `insert into public.parameter_specs (
         id, organization_id, source_kind, specification_key, definition_lifecycle
       ) values ($1, $2, 'manual', $3, 'draft') on conflict (id) do nothing`,
      ["pspec-s6-bnd-lock", ORG_A, "s6-bnd-lock"],
    );
    const legacyId = "legacy-lock-s6";
    await pool.query(
      `insert into public.project_parameter_bindings (
         id, organization_id, project_id, parameter_spec_id, module_id, logical_node_id
       ) values ($1, $2, $3, $4, $5, $6) on conflict (id) do nothing`,
      [legacyId, ORG_A, PROJECT_A, "pspec-s6-bnd-lock", MODULE_A, NODE_LOCK],
    );
    const member = await pool.query<{ source_name: string; node_locator: string }>(
      `select member.source_name, revision.node_locator
         from public.dts_config_revision_members member
         join public.dts_logical_node_revisions revision
           on revision.config_revision_id = member.config_revision_id
        where member.config_revision_id = $1
          and member.file_id = $2
          and member.file_version_id = $3`,
      [fixture.configRevisionId, fixture.fileId, fixture.fileVersionId],
    );
    const exactMember = member.rows[0];
    if (!exactMember) throw new Error("source fixture member missing");
    const locator = {
      kind: "dts-property",
      propertyOccurrenceId: fixture.propertyOccurrenceId,
      nodeOccurrenceId: fixture.nodeOccurrenceId,
      fileVersionId: fixture.fileVersionId,
      propertyName: "iin_max",
    };
    const command = {
      snapshot: snapshot1,
      legacy: {
        id: legacyId,
        organizationId: ORG_A,
        projectId: PROJECT_A,
        logicalNodeId: NODE_LOCK,
        moduleId: MODULE_A,
        parameterSpecId: "pspec-s6-bnd-lock",
      },
      registrationId: registrationA,
      definitionId: DEFINITION_ID,
      effectiveRevisionId: REVISION_1,
      source: {
        sourceOccurrenceId: fixture.sourceOccurrenceId,
        sourceRef: `${exactMember.source_name}!${exactMember.node_locator}`,
        configRevisionId: fixture.configRevisionId,
        payload: { kind: "number" as const, value: 5 },
        pin: {
          id: "legacy-source-pin-s6-lock",
          fileId: fixture.fileId,
          fileVersionId: fixture.fileVersionId,
          format: "dts" as const,
          propertyOccurrenceId: fixture.propertyOccurrenceId,
          locator,
          locatorDigest: `sha256:${createHash("sha256").update(serializeContract(locator)).digest("hex")}`,
        },
      },
    } satisfies Parameters<typeof mapLegacyBinding>[2];
    const holder = await pool.connect();
    const contender = await pool.connect();
    try {
      await holder.query("begin");
      await holder.query(
        `select id from public.project_parameter_bindings where id = $1 for update`,
        [legacyId],
      );
      await contender.query("begin");
      await contender.query("set constraints all deferred");
      const before = await catalogCounts();
      const started = Date.now();
      const refused = await mapLegacyBinding(contender, objectStore, command);
      const elapsed = Date.now() - started;
      expect(refused).toEqual({
        ok: false,
        error: { kind: "agreement-conflict", reason: "legacy-unproven" },
      });
      expect(elapsed).toBeLessThan(2_000);
      await contender.query("rollback");
      await holder.query("rollback");
      expect(await catalogCounts()).toEqual(before);
      expect(await bindingResidue(NODE_LOCK)).toEqual({ count: "0", owners: "" });
    } finally {
      await contender.query("rollback").catch(() => undefined);
      await holder.query("rollback").catch(() => undefined);
      contender.release();
      holder.release();
    }
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
