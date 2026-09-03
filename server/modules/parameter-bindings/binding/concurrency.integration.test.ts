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
  ParameterDefinitionId,
  serializeContract,
  type CatalogReleasePin,
  type ContractJsonValue,
} from "../../parameter-catalog-contract/index";
import type { RegisterSubjectCommand } from "../../parameter-governance/registration/command";
import { writeGuardedRegistration } from "../../parameter-governance/registration/internalGuardedRegistrationWriter";
import { openIndependentCatalogSessions } from "../../../testing/parameterCatalog/sessions";
import {
  createEphemeralTestDatabase,
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type EphemeralTestDatabase,
} from "../../../testing/testDatabase";

import { createBindingService } from "./index";

const databaseAvailable = await isTestDatabaseAvailable();
if (!databaseAvailable) {
  throw new Error(
    "S6-BND concurrency tests require a reachable real PostgreSQL server with pgvector; skipping is forbidden",
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
    "S6-BND concurrency tests require pgvector installed in the real PostgreSQL test database; skipping is forbidden",
  );
}

const ORG_A = "org-s6-bnd-cx-a";
const ORG_B = "org-s6-bnd-cx-b";
const ATTR_A = "attr-s6-bnd-cx-a";
const ATTR_B = "attr-s6-bnd-cx-b";
const MODULE_A = "pmod-s6-bnd-cx-a";
const MODULE_B = "pmod-s6-bnd-cx-b";
const PROJECT_A = "project-s6-bnd-cx-a";
const SUBJECT_ID = CatalogSubjectId("csub_acme_power");
const DEFINITION_ID = ParameterDefinitionId("pdef_acme_power_iin_max");
const REVISION_1 = DefinitionRevisionId("drev_acme_power_iin_max_1");
const REVISION_2 = DefinitionRevisionId("drev_acme_power_iin_max_2");
const NODE_RACE = "logical-node-race";
const NODE_CAS = "logical-node-cas";

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

describe("canonical Binding independent-session races", () => {
  let database: EphemeralTestDatabase;
  let pool: pg.Pool;
  let firstPin: CatalogReleasePin;
  let snapshot1: CatalogSnapshot;
  let snapshot2: CatalogSnapshot;
  let registrationA: string;
  let registrationB: string;
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
    proof: { reason: "s6-bnd-race" },
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

  beforeAll(async () => {
    database = await createEphemeralTestDatabase("s6bndcx");
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
      `insert into public.organizations (id, name) values ($1, 'CX A'), ($2, 'CX B')`,
      [ORG_A, ORG_B],
    );
    await pool.query(
      `insert into public.projects (id, organization_id, name, code)
       values ($1, $2, 'CX A', 'S6CXA')`,
      [PROJECT_A, ORG_A],
    );
    await pool.query(
      `insert into public.attribution_subjects (
         id, organization_id, subject_kind, display_name, source_key
       ) values
         ($1, $3, 'driver-registration', 'CX A', 'compatible:acme,power'),
         ($2, $4, 'driver-registration', 'CX B', 'compatible:acme,power')`,
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
    expect(registeredA.ok && registeredB.ok).toBe(true);
    if (!registeredA.ok || !registeredB.ok) {
      throw new Error("S4-REG writeGuardedRegistration failed in the race harness");
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
    const secondPin = { id: successor.release.id, digest: successor.release.digest };
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

  it("lets one composite winner replay and never mixes owners across independent sessions", async () => {
    const [left, right] = await openIndependentCatalogSessions(database.url);
    expect(left.backendPid).not.toBe(right.backendPid);
    await left.close();
    await right.close();

    const command = {
      snapshot: snapshot1,
      organizationId: ORG_A,
      projectId: PROJECT_A,
      logicalNodeId: NODE_RACE,
      registrationId: registrationA as never,
      definitionId: DEFINITION_ID,
      effectiveRevisionId: REVISION_1,
      expectedEffectiveRevisionId: null,
    } as const;

    const [first, second] = await Promise.all([
      service.stabilize(command),
      service.stabilize(command),
    ]);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(new Set([first.value.outcome, second.value.outcome])).toEqual(
      new Set(["committed", "replayed"]),
    );
    expect(first.value.binding.id).toBe(second.value.binding.id);
    expect(first.value.binding.organizationId).toBe(ORG_A);
    expect(second.value.binding.registrationId).toBe(registrationA);

    const [ownerA, ownerB] = await Promise.all([
      service.stabilize(command),
      service.stabilize({
        ...command,
        organizationId: ORG_B,
        registrationId: registrationB as never,
      }),
    ]);
    expect(ownerA.ok).toBe(true);
    expect(ownerB.ok).toBe(false);
    if (ownerB.ok) return;
    expect(ownerB.error).toEqual({
      kind: "agreement-conflict",
      reason: "project-owner-mismatch",
    });

    const stored = await pool.query<{
      count: string;
      organization_id: string;
      registration_id: string;
      subject_id: string;
    }>(
      `select count(*)::text as count, organization_id, registration_id, subject_id
         from parameter_catalog.project_parameter_bindings
        where project_id = $1 and logical_node_id = $2 and definition_id = $3
        group by organization_id, registration_id, subject_id`,
      [PROJECT_A, NODE_RACE, DEFINITION_ID],
    );
    expect(stored.rows).toEqual([
      {
        count: "1",
        organization_id: ORG_A,
        registration_id: registrationA,
        subject_id: SUBJECT_ID,
      },
    ]);
  });

  it("serializes effective-revision CAS so one session wins and the other refuses", async () => {
    const created = await service.stabilize({
      snapshot: snapshot1,
      organizationId: ORG_A,
      projectId: PROJECT_A,
      logicalNodeId: NODE_CAS,
      registrationId: registrationA as never,
      definitionId: DEFINITION_ID,
      effectiveRevisionId: REVISION_1,
      expectedEffectiveRevisionId: null,
    });
    expect(created.ok).toBe(true);

    const casCommand = {
      snapshot: snapshot2,
      organizationId: ORG_A,
      projectId: PROJECT_A,
      logicalNodeId: NODE_CAS,
      registrationId: registrationA as never,
      definitionId: DEFINITION_ID,
      effectiveRevisionId: REVISION_2,
      expectedEffectiveRevisionId: REVISION_1,
    } as const;

    const [left, right] = await Promise.all([
      service.stabilize(casCommand),
      service.stabilize(casCommand),
    ]);
    const outcomes = [left, right];
    const wins = outcomes.filter((result) => result.ok);
    const losses = outcomes.filter((result) => !result.ok);
    expect(wins).toHaveLength(1);
    expect(losses).toHaveLength(1);
    if (!losses[0] || losses[0].ok) return;
    expect(losses[0].error.kind).toBe("cas-mismatch");

    const stored = await pool.query<{
      effective_revision_id: string;
      organization_id: string;
    }>(
      `select effective_revision_id, organization_id
         from parameter_catalog.project_parameter_bindings
        where project_id = $1 and logical_node_id = $2 and definition_id = $3`,
      [PROJECT_A, NODE_CAS, DEFINITION_ID],
    );
    expect(stored.rows).toEqual([
      { effective_revision_id: REVISION_2, organization_id: ORG_A },
    ]);
  });
});
