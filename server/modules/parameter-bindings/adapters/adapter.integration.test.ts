import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

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
import { stabilizeCanonicalBinding, type Binding } from "../binding";
import { appendProjectValue } from "../values";

import {
  createProtectedWorkflowAdapters,
  readProtectedReference,
  writebackProtectedReference,
} from "./index";

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

  const stabilizeNode = async (logicalNodeId: string): Promise<Binding> => {
    const result = await stabilizeCanonicalBinding(pool, {
      snapshot,
      organizationId: ORG,
      projectId: PROJECT,
      logicalNodeId,
      registrationId,
      definitionId: DEFINITION_ID,
      effectiveRevisionId: REVISION_1,
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
       ) values ($1, $2, 'Driver', $1, 1, 'driver-group', 'curated', $3)`,
      [MODULE, ORG, ATTR],
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
    const appended = await appendProjectValue(pool, {
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

  it("writeback uses S6-VAL append/CAS and returns a typed pin of the new tip", async () => {
    const binding = await stabilizeNode("logical-node-write");
    const written = await writebackProtectedReference(pool, {
      snapshot,
      binding,
      definitionRevisionId: REVISION_1,
      source: { sourceRef: SOURCE_A, configRevisionId: "crev-1" },
      payload: { kind: "number", value: 42 },
      expectedTip: binding.currentValueId,
    });
    expect(written.ok).toBe(true);
    if (!written.ok) return;
    expect(written.value.outcome).toBe("committed");
    expect(written.value.pin.kind).toBe("canonical-pin");
    expect(written.value.pin.currentValueId).toBe(written.value.currentTip);
    expect(written.value.pin.definitionRevisionId).toBe(REVISION_1);
    expect(written.value.pin.source.sourceRef).toBe(SOURCE_A);
    expect(written.value.pin).not.toHaveProperty("parameterSpecId");
    expect(await currentTip(binding.id)).toBe(written.value.currentTip);
    expect(await historyEvents(binding.id)).toHaveLength(1);

    const refreshed: Binding = { ...binding, currentValueId: written.value.currentTip };
    const read = await readProtectedReference(pool, {
      snapshot,
      binding: refreshed,
      definitionRevisionId: REVISION_1,
    });
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.value).toEqual(written.value.pin);
  });

  it("refuses parameterSpecId on a seeded Binding and leaves the tip unchanged", async () => {
    const binding = await stabilizeNode("logical-node-legacy");
    const tipBefore = await currentTip(binding.id);
    const valuesBefore = await valueCount(binding.id);
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
    expect(await historyEvents(binding.id)).toEqual([]);
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

    const missingCurrent = await readProtectedReference(pool, {
      snapshot,
      binding: {
        ...binding,
        currentValueId: ProjectValueId(`pval_${"0".repeat(64)}`),
      },
      definitionRevisionId: REVISION_1,
    });
    expect(missingCurrent).toEqual({
      ok: false,
      error: { kind: "typed-block", reason: "missing-current-value" },
    });
    expect(await currentTip(binding.id)).toBe(binding.currentValueId);
  });

  it("blocks revision disagreement with Binding.effectiveRevisionId", async () => {
    const binding = await stabilizeNode("logical-node-revision");
    const tipBefore = await currentTip(binding.id);
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
    expect(await historyEvents(binding.id)).toEqual([]);
  });

  it("maps S6-VAL CAS and source conflicts to typed blocks with no mixed pin", async () => {
    const binding = await stabilizeNode("logical-node-conflict");
    const first = await writebackProtectedReference(pool, {
      snapshot,
      binding,
      definitionRevisionId: REVISION_1,
      source: { sourceRef: SOURCE_A, configRevisionId: "crev-1" },
      payload: { kind: "number", value: 10 },
      expectedTip: binding.currentValueId,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const stale = await writebackProtectedReference(pool, {
      snapshot,
      binding,
      definitionRevisionId: REVISION_1,
      source: { sourceRef: SOURCE_A, configRevisionId: "crev-stale" },
      payload: { kind: "number", value: 11 },
      expectedTip: binding.currentValueId,
    });
    expect(stale.ok).toBe(false);
    if (stale.ok) return;
    expect(stale.error.kind).toBe("typed-block");
    expect(stale.error.reason).toBe("cas-conflict");
    if (stale.error.reason === "cas-conflict") {
      expect(stale.error.expectedTip).toBe(binding.currentValueId);
      expect(stale.error.actualTip).toBe(first.value.currentTip);
    }
    expect(stale).not.toHaveProperty("value");
    expect(await currentTip(binding.id)).toBe(first.value.currentTip);

    const mixedSource = await writebackProtectedReference(pool, {
      snapshot,
      binding: { ...binding, currentValueId: first.value.currentTip },
      definitionRevisionId: REVISION_1,
      source: { sourceRef: SOURCE_B, configRevisionId: "crev-2" },
      payload: { kind: "number", value: 12 },
      expectedTip: first.value.currentTip,
    });
    expect(mixedSource.ok).toBe(false);
    if (mixedSource.ok) return;
    expect(mixedSource.error.reason).toBe("source-conflict");
    if (mixedSource.error.reason === "source-conflict") {
      expect(mixedSource.error.sourceReason).toBe("source-mismatch");
      expect(mixedSource.error.existingSourceRef).toBe(SOURCE_A);
      expect(mixedSource.error.attemptedSourceRef).toBe(SOURCE_B);
    }
    expect(await currentTip(binding.id)).toBe(first.value.currentTip);
    expect(await historyEvents(binding.id)).toHaveLength(1);
  });
});
