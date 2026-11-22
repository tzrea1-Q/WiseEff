import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { makeTestAuthContext } from "../../../testing/authContext";
import { createUserInvocation } from "../../auth/trustedInvocation";
import { catalogReadTransaction } from "../../catalog-kernel/runtime/readTransaction";
import { encodeBundleBytes } from "../../catalog-publication/builder/bundleCodec";
import { buildCompleteSuccessor } from "../../catalog-publication/builder/completeSuccessor";
import {
  allocationFor,
  allocationForRevision,
  firstAcmePredecessor,
  frozenPageIdentity,
  integerContent,
  pageIntegerChange,
} from "../../catalog-publication/builder/predecessorHarness";

import { compileCatalogRelease } from "../../catalog-kernel/compiler/index";
import { validCatalogReleaseBundle } from "../../catalog-kernel/compiler/__fixtures__/catalogReleaseBundle";
import type { CatalogReleaseBundle } from "../../catalog-kernel/compiler/types";
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
  ProjectValueId,
  type CatalogReleasePin,
} from "../../parameter-catalog-contract/index";
import type { RegisterSubjectCommand } from "../../parameter-governance/registration/command";
import { writeGuardedRegistration } from "../../parameter-governance/registration/internalGuardedRegistrationWriter";
import {
  createEphemeralTestDatabase,
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type EphemeralTestDatabase,
} from "../../../testing/testDatabase";
import { type Binding } from "../binding";
import { createSourceBackedBindingService, appendSourceCommittedValue } from "../binding/__fixtures__/sourceBackedBinding";

import {
  createProtectedWorkflowAdapters,
  readProjectProtectedParameters,
  readProtectedReference,
  writebackProtectedReference,
} from "./index";
import { readListedCurrentValues } from "../values";
import { readListedProtectedReference } from "./readAdapter";

const databaseAvailable = await isTestDatabaseAvailable();
if (!databaseAvailable) {
  throw new Error(
    "S6-WFA requires a reachable real PostgreSQL server with pgvector; skipping is forbidden",
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
    "S6-WFA requires pgvector installed in the real PostgreSQL test database; skipping is forbidden",
  );
}

const ORG = "org-s6-wfa";
const ATTR = "attr-s6-wfa";
const MODULE = "pmod-s6-wfa-driver";
const PROJECT = "project-s6-wfa";
const SUBJECT_ID = CatalogSubjectId("csub_acme_power");
const DEFINITION_ID = ParameterDefinitionId("pdef_acme_power_iin_max");
const REVISION_1 = DefinitionRevisionId("drev_acme_power_iin_max_1");
const SOURCE_A = "config-set:main";
const SOURCE_B = "config-set:other";
const VALUES_RELATION = ["project_parameter", "values"].join("_");

const firstReleaseBundle = (): CatalogReleaseBundle => {
  const full = validCatalogReleaseBundle();
  const first = structuredClone(full.releases[0]!);
  return {
    schemaVersion: full.schemaVersion,
    targetReleaseId: first.manifest.release.id,
    releases: [first],
  };
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

describe("protected-reference adapters", () => {
  let database: EphemeralTestDatabase;
  let pool: pg.Pool;
  let snapshot: CatalogSnapshot;
  let registrationId: Binding["registrationId"];
  let adapters: ReturnType<typeof createProtectedWorkflowAdapters>;

  const registerCommand = (expectedRelease: CatalogReleasePin): RegisterSubjectCommand => ({
    kind: "register",
    organizationId: ORG,
    subjectId: SUBJECT_ID,
    subjectKind: "driver",
    expectedRelease,
    placement: { mode: "use-default" },
    destinationModuleId: MODULE,
    method: "explicit",
    proof: { reason: "s6-wfa-captured-kernel-proof" },
    idempotencyKey: `reg:${ORG}:${randomUUID()}`,
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

  const stabilizeNode = async (
    logicalNodeId: string,
    pin = { snapshot, projectId: PROJECT, definitionId: DEFINITION_ID, effectiveRevisionId: REVISION_1 },
  ): Promise<Binding> => {
    const result = await createSourceBackedBindingService(pool, { sourceRef: SOURCE_A }).stabilize({
      ...pin,
      organizationId: ORG,
      logicalNodeId,
      registrationId,
      expectedEffectiveRevisionId: null,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("S6-BND stabilizeCanonicalBinding failed to seed a Binding");
    }
    return result.value.binding;
  };

  const currentTip = async (bindingId: string) => {
    const result = await pool.query<{ current_value_id: string }>(
      `select current_value_id
         from parameter_catalog.project_parameter_bindings
        where id = $1`,
      [bindingId],
    );
    return result.rows[0]?.current_value_id;
  };

  const historyEvents = async (bindingId: string) => {
    const result = await pool.query<{ id: string }>(
      `select id
         from parameter_catalog.binding_history_events
        where binding_id = $1
        order by created_at asc, id asc`,
      [bindingId],
    );
    return result.rows;
  };

  const valueCount = async (bindingId: string) => {
    const result = await pool.query<{ count: string }>(
      `select count(*)::text as count
         from parameter_catalog.${VALUES_RELATION}
        where binding_id = $1`,
      [bindingId],
    );
    return Number(result.rows[0]?.count ?? "0");
  };

  beforeAll(async () => {
    database = await createEphemeralTestDatabase("s6wfa");
    pool = new pg.Pool({ connectionString: database.url, max: 4 });
    const first = compileOrThrow(firstReleaseBundle());
    const installed = await installPublishedRelease(pool, {
      mode: "bootstrap",
      source: jsonCatalogReleaseSource(firstReleaseBundle()),
      expectedTargetDigest: first.aggregateDigest,
    });
    expect(installed.ok).toBe(true);

    await pool.query(`insert into public.organizations (id, name) values ($1, 'S6 WFA')`, [ORG]);
    await pool.query(
      `insert into public.projects (id, organization_id, name, code) values ($1, $2, 'S6 WFA', 'S6WFA')`,
      [PROJECT, ORG],
    );
    await pool.query(
      `insert into public.attribution_subjects (
         id, organization_id, subject_kind, display_name, source_key
       ) values ($1, $2, 'driver-registration', 'S6 WFA driver', 'compatible:acme,power')`,
      [ATTR, ORG],
    );
    await pool.query(
      `insert into public.driver_registrations (
         attribution_subject_id, driver_nature, instance_cardinality
       ) values ($1, 'physical-device', 'multiple')`,
      [ATTR],
    );
    await pool.query(
      `insert into public.parameter_modules (
         id, organization_id, name, path, depth, kind, origin, attribution_subject_id
       ) values ($1, $2, 'Driver', $1, 1, 'business', 'curated', null)`,
      [MODULE, ORG],
    );

    const pin = { id: first.release.id, digest: first.release.digest };
    const registered = await seedRegistration(registerCommand(pin));
    expect(registered.ok).toBe(true);
    if (!registered.ok) {
      throw new Error("S4-REG writeGuardedRegistration failed to seed active Registration");
    }
    registrationId = registered.value.registrationId;

    const kernel = createCatalogKernel(pool);
    const loaded = await kernel.loadPinnedCatalog(pin);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) throw new Error("failed to load frozen snapshot");
    snapshot = loaded.value;
    adapters = createProtectedWorkflowAdapters(pool);
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    await database?.drop();
  });

  it("pins an exact canonical read from Binding, current ProjectValue, and DefinitionRevision", async () => {
    const binding = await stabilizeNode("logical-node-read");
    const appended = await appendSourceCommittedValue(pool, {
      snapshot,
      binding,
      definitionRevisionId: REVISION_1,
      source: { sourceRef: SOURCE_A, configRevisionId: "crev-1" },
      payload: { kind: "number", value: 1500 },
      expectedTip: binding.currentValueId,
    });
    expect(appended.ok).toBe(true);
    if (!appended.ok) return;

    const currentBinding: Binding = {
      ...binding,
      currentValueId: appended.value.currentTip,
    };
    const valuesBefore = await valueCount(binding.id);
    const tipBefore = await currentTip(binding.id);
    const read = await adapters.read({
      snapshot,
      binding: currentBinding,
      definitionRevisionId: REVISION_1,
    });
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.value.kind).toBe("canonical-pin");
    expect(read.value.bindingId).toBe(binding.id);
    expect(read.value.definitionId).toBe(DEFINITION_ID);
    expect(read.value.definitionRevisionId).toBe(REVISION_1);
    expect(read.value.currentValueId).toBe(appended.value.currentTip);
    expect(read.value.source.sourceRef).toBe(SOURCE_A);
    expect(read.value.payload).toEqual({ kind: "number", value: 1500 });
    expect(read.value.catalogRelease).toEqual(binding.catalogRelease);
    expect(read.value).not.toHaveProperty("parameterSpecId");
    expect(await currentTip(binding.id)).toBe(tipBefore);
    expect(await valueCount(binding.id)).toBe(valuesBefore);
  });

  it("refuses a value-only writeback on an established source-backed Binding", async () => {
    const binding = await stabilizeNode("logical-node-write");
    const tipBefore = await currentTip(binding.id);
    const valuesBefore = await valueCount(binding.id);
    const historyBefore = await historyEvents(binding.id);
    const written = await writebackProtectedReference(pool, {
      snapshot,
      binding,
      definitionRevisionId: REVISION_1,
      source: { sourceRef: SOURCE_A, configRevisionId: "crev-1" },
      payload: { kind: "number", value: 42 },
      expectedTip: binding.currentValueId,
    });
    expect(written).toEqual({
      ok: false,
      error: {
        kind: "typed-block",
        reason: "invalid-command",
        field: "owned-source-commit-required",
      },
    });
    expect(await currentTip(binding.id)).toBe(tipBefore);
    expect(await valueCount(binding.id)).toBe(valuesBefore);
    expect(await historyEvents(binding.id)).toEqual(historyBefore);
  });

  it("refuses parameterSpecId on a seeded Binding and leaves the tip unchanged", async () => {
    const binding = await stabilizeNode("logical-node-legacy");
    const tipBefore = await currentTip(binding.id);
    const valuesBefore = await valueCount(binding.id);
    const historyBefore = await historyEvents(binding.id);
    const refused = await writebackProtectedReference(pool, {
      snapshot,
      binding,
      definitionRevisionId: REVISION_1,
      source: { sourceRef: SOURCE_A, configRevisionId: "crev-1" },
      payload: { kind: "number", value: 7 },
      expectedTip: binding.currentValueId,
      parameterSpecId: "spec-legacy-seeded",
    } as never);
    expect(refused).toEqual({
      ok: false,
      error: { kind: "typed-block", reason: "legacy-parameter-spec-id" },
    });
    expect(await currentTip(binding.id)).toBe(tipBefore);
    expect(await valueCount(binding.id)).toBe(valuesBefore);
    expect(await historyEvents(binding.id)).toEqual(historyBefore);
  });

  it("blocks a missing Binding or missing current value without a pin", async () => {
    const binding = await stabilizeNode("logical-node-missing");
    const ghost: Binding = {
      ...binding,
      id: ParameterBindingId("pbind_s6_wfa_missing"),
    };
    const missingBinding = await readProtectedReference(pool, {
      snapshot,
      binding: ghost,
      definitionRevisionId: REVISION_1,
    });
    expect(missingBinding).toEqual({
      ok: false,
      error: { kind: "typed-block", reason: "missing-binding" },
    });

    const missingCurrentCommand = {
      snapshot,
      binding: {
        ...binding,
        currentValueId: ProjectValueId(`pval_${"0".repeat(64)}`),
      },
      definitionRevisionId: REVISION_1,
    };
    const missingCurrent = await readProtectedReference(pool, missingCurrentCommand);
    expect(missingCurrent).toEqual({
      ok: false,
      error: { kind: "typed-block", reason: "missing-current-value" },
    });
    const currentValues = await readListedCurrentValues(pool, [missingCurrentCommand.binding.currentValueId]);
    expect(readListedProtectedReference(missingCurrentCommand, currentValues)).toEqual(missingCurrent);
    expect(await currentTip(binding.id)).toBe(binding.currentValueId);
  });

  it("blocks revision disagreement with Binding.effectiveRevisionId", async () => {
    const binding = await stabilizeNode("logical-node-revision");
    const tipBefore = await currentTip(binding.id);
    const historyBefore = await historyEvents(binding.id);
    const other = DefinitionRevisionId("drev_not_the_effective_head");
    const read = await readProtectedReference(pool, {
      snapshot,
      binding,
      definitionRevisionId: other,
    });
    const write = await writebackProtectedReference(pool, {
      snapshot,
      binding,
      definitionRevisionId: other,
      source: { sourceRef: SOURCE_A, configRevisionId: "crev-1" },
      payload: { kind: "number", value: 9 },
      expectedTip: binding.currentValueId,
    });
    expect(read).toEqual({
      ok: false,
      error: { kind: "typed-block", reason: "revision-disagreement" },
    });
    expect(write).toEqual({
      ok: false,
      error: { kind: "typed-block", reason: "revision-disagreement" },
    });
    expect(await currentTip(binding.id)).toBe(tipBefore);
    expect(await historyEvents(binding.id)).toEqual(historyBefore);
  });

  it("refuses value-only CAS and preserves source-conflict blocking", async () => {
    const binding = await stabilizeNode("logical-node-conflict");
    const tipBefore = await currentTip(binding.id);
    const valuesBefore = await valueCount(binding.id);
    const historyBefore = await historyEvents(binding.id);
    const first = await writebackProtectedReference(pool, {
      snapshot,
      binding,
      definitionRevisionId: REVISION_1,
      source: { sourceRef: SOURCE_A, configRevisionId: "crev-1" },
      payload: { kind: "number", value: 10 },
      expectedTip: binding.currentValueId,
    });
    expect(first).toEqual({
      ok: false,
      error: {
        kind: "typed-block",
        reason: "invalid-command",
        field: "owned-source-commit-required",
      },
    });

    const stale = await writebackProtectedReference(pool, {
      snapshot,
      binding,
      definitionRevisionId: REVISION_1,
      source: { sourceRef: SOURCE_A, configRevisionId: "crev-stale" },
      payload: { kind: "number", value: 11 },
      expectedTip: binding.currentValueId,
    });
    expect(stale).toEqual({
      ok: false,
      error: {
        kind: "typed-block",
        reason: "invalid-command",
        field: "owned-source-commit-required",
      },
    });

    const mixedSource = await writebackProtectedReference(pool, {
      snapshot,
      binding,
      definitionRevisionId: REVISION_1,
      source: { sourceRef: SOURCE_B, configRevisionId: "crev-2" },
      payload: { kind: "number", value: 12 },
      expectedTip: binding.currentValueId,
    });
    expect(mixedSource).toEqual({
      ok: false,
      error: {
        kind: "typed-block",
        reason: "source-conflict",
        bindingId: binding.id,
        sourceReason: "source-mismatch",
        existingSourceRef: SOURCE_A,
        attemptedSourceRef: SOURCE_B,
      },
    });
    expect(await currentTip(binding.id)).toBe(tipBefore);
    expect(await valueCount(binding.id)).toBe(valuesBefore);
    expect(await historyEvents(binding.id)).toEqual(historyBefore);
  });

  it("lists exact pins across releases in a fixed query count, including a now-retired Definition", async () => {
    const projectId = `${PROJECT}-list`;
    await pool.query("insert into public.projects (id, organization_id, name, code) values ($1, $2, 'List', 'S6-LIST')",
      [projectId, ORG]);
    const oldPin = { snapshot, projectId, definitionId: DEFINITION_ID, effectiveRevisionId: REVISION_1 };
    const retiring = await stabilizeNode("list-0", oldPin);
    const bindings = [retiring];

    const predecessor = firstAcmePredecessor();
    const definition = predecessor.first.documents.find((document) => document.kind === "definition" && document.content.id === DEFINITION_ID);
    if (definition?.kind !== "definition") throw new Error("List fixture Definition is missing");
    const { displayName, documentation } = definition.content.revision;
    const next = allocationFor("list_current");
    const built = await buildCompleteSuccessor({
      predecessorArtifact: { digest: predecessor.digest, bytes: predecessor.bytes },
      productPath: "m2-core",
      changeSet: [pageIntegerChange(next.propertyKey, "List current")],
      frozenIdentity: frozenPageIdentity([next]),
    });
    if (!built.ok || built.value.kind !== "successor") throw new Error("List fixture successor failed");
    const source = built.value.artifact.bundle;
    const compiled = compileOrThrow(source);
    const installed = await installPublishedRelease(pool, {
      mode: "advance",
      source: jsonCatalogReleaseSource(source),
      expectedCurrent: snapshot.release,
      expectedTargetDigest: compiled.aggregateDigest,
    });
    if (!installed.ok) throw new Error(`List fixture installation failed: ${installed.error.kind}`);
    const kernel = createCatalogKernel(pool);
    const loaded = await kernel.loadPinnedCatalog({ id: compiled.release.id, digest: compiled.aggregateDigest });
    if (!loaded.ok) throw new Error(`List fixture snapshot failed: ${loaded.error.kind}`);
    const newPin = {
      snapshot: loaded.value,
      projectId,
      definitionId: ParameterDefinitionId(next.definitionId),
      effectiveRevisionId: DefinitionRevisionId(next.revisionId),
    };
    const snapshots = new Map([snapshot, loaded.value].map((release) => [release.release.id, release]));
    const invocation = createUserInvocation(makeTestAuthContext({ organizationId: ORG, roleId: "hardware-user" }));
    const client = await pool.connect();
    const query = vi.spyOn(client, "query");
    const compare = async () => {
      await client.query("begin isolation level repeatable read read only");
      try {
        query.mockClear();
        const listed = await readProjectProtectedParameters(catalogReadTransaction(client), { invocation, projectId });
        const queryCount = query.mock.calls.length;
        const priorPins = [];
        for (const binding of bindings.sort((left, right) => left.id < right.id ? -1 : 1)) {
          const prior = await readProtectedReference(client, {
            snapshot: snapshots.get(binding.catalogRelease.id)!,
            binding,
            definitionRevisionId: binding.effectiveRevisionId,
          });
          if (!prior.ok) throw new Error(prior.error.reason);
          priorPins.push(prior.value);
        }
        expect(listed.map(({ pin }) => pin)).toEqual(priorPins);
        return queryCount;
      } finally {
        await client.query("rollback");
      }
    };
    try {
      for (let index = 1; index < 3; index++) bindings.push(await stabilizeNode(`list-${index}`, newPin));
      const small = await compare();
      for (let index = 3; index < 30; index++) bindings.push(await stabilizeNode(`list-${index}`, newPin));
      expect(await compare()).toBe(small);

      const retirement = await buildCompleteSuccessor({
        predecessorArtifact: { digest: compiled.aggregateDigest, bytes: encodeBundleBytes(source) },
        productPath: "m2-core",
        changeSet: [{ op: "retire-definition", definitionId: DEFINITION_ID, content: integerContent(displayName, documentation) }],
        frozenIdentity: {
          ...frozenPageIdentity([allocationForRevision(definition.content.propertyKey, 2)], "retired", "1.2.0"),
          publishedAt: "2026-09-13T00:00:00Z",
        },
      });
      if (!retirement.ok || retirement.value.kind !== "successor") throw new Error("List fixture retirement failed");
      const retiredSource = retirement.value.artifact.bundle;
      const retiredRelease = compileOrThrow(retiredSource);
      const retired = await installPublishedRelease(pool, {
        mode: "advance",
        source: jsonCatalogReleaseSource(retiredSource),
        expectedCurrent: loaded.value.release,
        expectedTargetDigest: retiredRelease.aggregateDigest,
      });
      if (!retired.ok) throw new Error(`List fixture retirement installation failed: ${retired.error.kind}`);
      bindings.splice(bindings.indexOf(retiring), 1);
      await compare();
      await expect(readProtectedReference(pool, { snapshot, binding: retiring, definitionRevisionId: REVISION_1 }))
        .resolves.toMatchObject({ ok: true, value: { bindingId: retiring.id } });
      await expect(readProjectProtectedParameters(pool, {
        invocation: createUserInvocation(makeTestAuthContext({ organizationId: "foreign-org", roleId: "hardware-user" })),
        projectId,
      })).rejects.toMatchObject({ code: "NOT_FOUND" });
    } finally {
      query.mockRestore();
      client.release();
    }
  }, 120_000);
});
