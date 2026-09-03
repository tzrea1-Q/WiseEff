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
  ParameterDefinitionId,
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

import { createProjectValueService } from "./index";

const databaseAvailable = await isTestDatabaseAvailable();
if (!databaseAvailable) {
  throw new Error(
    "S6-VAL requires a reachable real PostgreSQL server with pgvector; skipping is forbidden",
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
    "S6-VAL requires pgvector installed in the real PostgreSQL test database; skipping is forbidden",
  );
}

const ORG = "org-s6-val";
const ATTR = "attr-s6-val";
const MODULE = "pmod-s6-val-driver";
const PROJECT = "project-s6-val";
const SUBJECT_ID = CatalogSubjectId("csub_acme_power");
const DEFINITION_ID = ParameterDefinitionId("pdef_acme_power_iin_max");
const REVISION_1 = DefinitionRevisionId("drev_acme_power_iin_max_1");
const PLACEHOLDER_SOURCE = "canonical-binding-identity";
const SOURCE_A = "config-set:main";
const SOURCE_B = "config-set:other";

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

const VALUES_RELATION = ["project_parameter", "values"].join("_");

describe("immutable ProjectValue history", () => {
  let database: EphemeralTestDatabase;
  let pool: pg.Pool;
  let snapshot: CatalogSnapshot;
  let registrationId: Binding["registrationId"];
  let service: ReturnType<typeof createProjectValueService>;

  const registerCommand = (expectedRelease: CatalogReleasePin): RegisterSubjectCommand => ({
    kind: "register",
    organizationId: ORG,
    subjectId: SUBJECT_ID,
    subjectKind: "driver",
    expectedRelease,
    placement: { mode: "use-default" },
    destinationModuleId: MODULE,
    method: "explicit",
    proof: { reason: "s6-val-captured-kernel-proof" },
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

  const valueRows = async (bindingId: string) => {
    const result = await pool.query<{
      id: string;
      source_ref: string;
      config_revision_id: string;
      value_digest: string;
      value_kind: string;
      value: unknown;
      created_at: Date;
    }>(
      `select id, source_ref, config_revision_id, value_digest, value_kind, value, created_at
         from parameter_catalog.${VALUES_RELATION}
        where binding_id = $1
        order by created_at asc, id asc`,
      [bindingId],
    );
    return result.rows;
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
    const result = await pool.query<{
      id: string;
      old_current_value_id: string | null;
      new_current_value_id: string | null;
      success_audit_ref: string;
    }>(
      `select id, old_current_value_id, new_current_value_id, success_audit_ref
         from parameter_catalog.binding_history_events
        where binding_id = $1
        order by created_at asc, id asc`,
      [bindingId],
    );
    return result.rows;
  };

  const successAudits = async (refs: readonly string[]) => {
    if (refs.length === 0) return [];
    const result = await pool.query<{ id: string; action: string }>(
      `select id, action from public.audit_events where id = any($1::text[])`,
      [refs],
    );
    return result.rows;
  };

  beforeAll(async () => {
    database = await createEphemeralTestDatabase("s6val");
    pool = new pg.Pool({ connectionString: database.url, max: 4 });
    const first = compileOrThrow(firstReleaseBundle());
    const installed = await installPublishedRelease(pool, {
      mode: "bootstrap",
      source: jsonCatalogReleaseSource(firstReleaseBundle()),
      expectedTargetDigest: first.aggregateDigest,
    });
    expect(installed.ok).toBe(true);

    await pool.query(`insert into public.organizations (id, name) values ($1, 'S6 VAL')`, [ORG]);
    await pool.query(
      `insert into public.projects (id, organization_id, name, code) values ($1, $2, 'S6 VAL', 'S6VAL')`,
      [PROJECT, ORG],
    );
    await pool.query(
      `insert into public.attribution_subjects (
         id, organization_id, subject_kind, display_name, source_key
       ) values ($1, $2, 'driver-registration', 'S6 VAL driver', 'compatible:acme,power')`,
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
    service = createProjectValueService(pool);
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    await database?.drop();
  });

  it("appends one immutable ProjectValue, CASes the current tip, and writes audit", async () => {
    const binding = await stabilizeNode("logical-node-success");
    const result = await service.append({
      snapshot,
      binding,
      definitionRevisionId: REVISION_1,
      source: { sourceRef: SOURCE_A, configRevisionId: "crev-1" },
      payload: { kind: "number", value: 1500 },
      expectedTip: binding.currentValueId,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.outcome).toBe("committed");
    expect(result.value.value.bindingId).toBe(binding.id);
    expect(result.value.value.definitionRevisionId).toBe(REVISION_1);
    expect(result.value.value.source.sourceRef).toBe(SOURCE_A);
    expect(result.value.value.payload).toEqual({ kind: "number", value: 1500 });
    expect(result.value.currentTip).toBe(result.value.value.id);
    expect(result.value.value.id).toMatch(/^pval_[0-9a-f]{64}$/);
    expect(await currentTip(binding.id)).toBe(result.value.value.id);

    const events = await historyEvents(binding.id);
    expect(events).toHaveLength(1);
    expect(events[0]?.old_current_value_id).toBe(binding.currentValueId);
    expect(events[0]?.new_current_value_id).toBe(result.value.value.id);
    const audits = await successAudits(events.map((event) => event.success_audit_ref));
    expect(audits).toHaveLength(1);
  });

  it("lets a later wall-clock write with a stale expected tip lose", async () => {
    const binding = await stabilizeNode("logical-node-stale");
    const first = await service.append({
      snapshot,
      binding,
      definitionRevisionId: REVISION_1,
      source: { sourceRef: SOURCE_A, configRevisionId: "crev-1" },
      payload: {
        kind: "json",
        value: { observedAt: "2020-01-01T00:00:00.000Z", magnitude: 1 },
      },
      expectedTip: binding.currentValueId,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = await service.append({
      snapshot,
      binding,
      definitionRevisionId: REVISION_1,
      source: { sourceRef: SOURCE_A, configRevisionId: "crev-2" },
      payload: {
        kind: "json",
        value: { observedAt: "2020-06-01T00:00:00.000Z", magnitude: 2 },
      },
      expectedTip: first.value.currentTip,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    const valuesBefore = await valueRows(binding.id);
    const eventsBefore = await historyEvents(binding.id);
    const stale = await service.append({
      snapshot,
      binding,
      definitionRevisionId: REVISION_1,
      source: { sourceRef: SOURCE_A, configRevisionId: "crev-late" },
      payload: {
        kind: "json",
        value: { observedAt: "2026-01-01T00:00:00.000Z", magnitude: 99 },
      },
      expectedTip: first.value.currentTip,
    });
    expect(stale.ok).toBe(false);
    if (stale.ok) return;
    expect(stale.error.kind).toBe("cas-mismatch");
    if (stale.error.kind === "cas-mismatch") {
      expect(stale.error.expectedTip).toBe(first.value.currentTip);
      expect(stale.error.actualTip).toBe(second.value.currentTip);
    }
    expect(await currentTip(binding.id)).toBe(second.value.currentTip);
    expect(await valueRows(binding.id)).toEqual(valuesBefore);
    expect(await historyEvents(binding.id)).toEqual(eventsBefore);
  });

  it("refuses in-place UPDATE/DELETE and leaves original bytes including the placeholder", async () => {
    const binding = await stabilizeNode("logical-node-mutate");
    const placeholderBefore = await pool.query(
      `select id, source_ref, config_revision_id, value_digest, value_kind, value
         from parameter_catalog.${VALUES_RELATION}
        where id = $1`,
      [binding.currentValueId],
    );
    const appended = await service.append({
      snapshot,
      binding,
      definitionRevisionId: REVISION_1,
      source: { sourceRef: SOURCE_A, configRevisionId: "crev-1" },
      payload: { kind: "number", value: 42 },
      expectedTip: binding.currentValueId,
    });
    expect(appended.ok).toBe(true);
    if (!appended.ok) return;

    const before = await pool.query(
      `select id, source_ref, config_revision_id, value_digest, value_kind, value
         from parameter_catalog.${VALUES_RELATION}
        where id = $1`,
      [appended.value.value.id],
    );
    const update = await service.mutateExisting({
      valueId: appended.value.value.id,
      mutation: "update",
    });
    const remove = await service.mutateExisting({
      valueId: appended.value.value.id,
      mutation: "delete",
    });
    const placeholderMutation = await service.mutateExisting({
      valueId: binding.currentValueId,
      mutation: "update",
    });
    const sqlUpdate = await pool
      .query(
        `update parameter_catalog.${VALUES_RELATION}
            set value_digest = 'tampered'
          where id = $1`,
        [appended.value.value.id],
      )
      .then(() => null)
      .catch((error: unknown) => error);
    const sqlDelete = await pool
      .query(`delete from parameter_catalog.${VALUES_RELATION} where id = $1`, [
        appended.value.value.id,
      ])
      .then(() => null)
      .catch((error: unknown) => error);
    const placeholderSqlUpdate = await pool
      .query(
        `update parameter_catalog.${VALUES_RELATION}
            set source_ref = 'tampered-placeholder'
          where id = $1`,
        [binding.currentValueId],
      )
      .then(() => null)
      .catch((error: unknown) => error);
    expect(sqlUpdate).toBeInstanceOf(pg.DatabaseError);
    expect(sqlDelete).toBeInstanceOf(pg.DatabaseError);
    expect(placeholderSqlUpdate).toBeInstanceOf(pg.DatabaseError);
    if (sqlUpdate instanceof pg.DatabaseError) {
      expect(sqlUpdate.code).toBe("55000");
    }
    if (sqlDelete instanceof pg.DatabaseError) {
      expect(sqlDelete.code).toBe("55000");
    }
    if (placeholderSqlUpdate instanceof pg.DatabaseError) {
      expect(placeholderSqlUpdate.code).toBe("55000");
    }
    expect(update).toEqual({
      ok: false,
      error: {
        kind: "immutable-value",
        valueId: appended.value.value.id,
        mutation: "update",
      },
    });
    expect(remove).toEqual({
      ok: false,
      error: {
        kind: "immutable-value",
        valueId: appended.value.value.id,
        mutation: "delete",
      },
    });
    expect(placeholderMutation.ok).toBe(false);
    if (!placeholderMutation.ok) {
      expect(placeholderMutation.error.kind).toBe("immutable-value");
    }
    const after = await pool.query(
      `select id, source_ref, config_revision_id, value_digest, value_kind, value
         from parameter_catalog.${VALUES_RELATION}
        where id = $1`,
      [appended.value.value.id],
    );
    const placeholderAfter = await pool.query(
      `select id, source_ref, config_revision_id, value_digest, value_kind, value
         from parameter_catalog.${VALUES_RELATION}
        where id = $1`,
      [binding.currentValueId],
    );
    expect(after.rows).toEqual(before.rows);
    expect(placeholderAfter.rows).toEqual(placeholderBefore.rows);
    expect(placeholderAfter.rows[0]?.source_ref).toBe(PLACEHOLDER_SOURCE);
  });

  it("returns complete ordered history for the Binding and exact DefinitionRevision", async () => {
    const binding = await stabilizeNode("logical-node-history");
    const first = await service.append({
      snapshot,
      binding,
      definitionRevisionId: REVISION_1,
      source: { sourceRef: SOURCE_A, configRevisionId: "crev-1" },
      payload: { kind: "number", value: 1 },
      expectedTip: binding.currentValueId,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = await service.append({
      snapshot,
      binding,
      definitionRevisionId: REVISION_1,
      source: { sourceRef: SOURCE_A, configRevisionId: "crev-2" },
      payload: { kind: "number", value: 2 },
      expectedTip: first.value.currentTip,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    const third = await service.append({
      snapshot,
      binding,
      definitionRevisionId: REVISION_1,
      source: { sourceRef: SOURCE_A, configRevisionId: "crev-3" },
      payload: { kind: "number", value: 3 },
      expectedTip: second.value.currentTip,
    });
    expect(third.ok).toBe(true);
    if (!third.ok) return;

    const history = await service.readHistory({
      binding,
      definitionRevisionId: REVISION_1,
    });
    expect(history.ok).toBe(true);
    if (!history.ok) return;
    expect(history.value.map((value) => value.id)).toEqual([
      binding.currentValueId,
      first.value.value.id,
      second.value.value.id,
      third.value.value.id,
    ]);
    expect(history.value.map((value) => value.payload)).toEqual([
      { kind: "json", value: {} },
      { kind: "number", value: 1 },
      { kind: "number", value: 2 },
      { kind: "number", value: 3 },
    ]);
  });

  it("refuses source identity disagreement and cross-binding writes", async () => {
    const owned = await stabilizeNode("logical-node-source");
    const other = await stabilizeNode("logical-node-cross");
    const first = await service.append({
      snapshot,
      binding: owned,
      definitionRevisionId: REVISION_1,
      source: { sourceRef: SOURCE_A, configRevisionId: "crev-1" },
      payload: { kind: "number", value: 10 },
      expectedTip: owned.currentValueId,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const mixedSource = await service.append({
      snapshot,
      binding: owned,
      definitionRevisionId: REVISION_1,
      source: { sourceRef: SOURCE_B, configRevisionId: "crev-2" },
      payload: { kind: "number", value: 11 },
      expectedTip: first.value.currentTip,
    });
    expect(mixedSource.ok).toBe(false);
    if (mixedSource.ok) return;
    expect(mixedSource.error.kind).toBe("source-conflict");
    if (mixedSource.error.kind === "source-conflict") {
      expect(mixedSource.error.reason).toBe("source-mismatch");
      expect(mixedSource.error.existingSourceRef).toBe(SOURCE_A);
      expect(mixedSource.error.attemptedSourceRef).toBe(SOURCE_B);
    }

    const cross = await service.append({
      snapshot,
      binding: other,
      definitionRevisionId: REVISION_1,
      source: { sourceRef: SOURCE_A, configRevisionId: "crev-1" },
      payload: { kind: "number", value: 12 },
      expectedTip: first.value.currentTip,
    });
    expect(cross.ok).toBe(false);
    if (cross.ok) return;
    expect(cross.error.kind).toBe("source-conflict");
    if (cross.error.kind === "source-conflict") {
      expect(cross.error.reason).toBe("cross-binding");
    }

    expect(await currentTip(owned.id)).toBe(first.value.currentTip);
    expect(await currentTip(other.id)).toBe(other.currentValueId);
    expect((await valueRows(owned.id)).map((row) => row.source_ref)).toEqual([
      PLACEHOLDER_SOURCE,
      SOURCE_A,
    ]);
    expect((await valueRows(other.id)).map((row) => row.source_ref)).toEqual([PLACEHOLDER_SOURCE]);
    expect(await historyEvents(other.id)).toEqual([]);
  });

  it("writes success audit only for committed tip changes", async () => {
    const binding = await stabilizeNode("logical-node-audit");
    const committed = await service.append({
      snapshot,
      binding,
      definitionRevisionId: REVISION_1,
      source: { sourceRef: SOURCE_A, configRevisionId: "crev-1" },
      payload: { kind: "number", value: 7 },
      expectedTip: binding.currentValueId,
    });
    expect(committed.ok).toBe(true);
    if (!committed.ok) return;
    const events = await historyEvents(binding.id);
    expect(events).toHaveLength(1);
    expect(events[0]?.old_current_value_id).toBe(binding.currentValueId);
    expect(events[0]?.new_current_value_id).toBe(committed.value.currentTip);
    expect(await successAudits([events[0]!.success_audit_ref])).toEqual([
      { id: events[0]!.success_audit_ref, action: "project-value-appended" },
    ]);

    const valuesBefore = await valueRows(binding.id);
    const failed = await service.append({
      snapshot,
      binding,
      definitionRevisionId: REVISION_1,
      source: { sourceRef: SOURCE_A, configRevisionId: "crev-2" },
      payload: { kind: "number", value: 8 },
      expectedTip: binding.currentValueId,
    });
    expect(failed.ok).toBe(false);
    expect(await valueRows(binding.id)).toEqual(valuesBefore);
    expect(await historyEvents(binding.id)).toHaveLength(1);
    expect(await currentTip(binding.id)).toBe(committed.value.currentTip);
  });

  it("replays the same payload and expected tip to the same ProjectValue id", async () => {
    const binding = await stabilizeNode("logical-node-replay");
    const command = {
      snapshot,
      binding,
      definitionRevisionId: REVISION_1,
      source: { sourceRef: SOURCE_A, configRevisionId: "crev-1" },
      payload: { kind: "number" as const, value: 21 },
      expectedTip: binding.currentValueId,
    };
    const first = await service.append(command);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const replay = await service.append(command);
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    expect(replay.value.outcome).toBe("replayed");
    expect(replay.value.value.id).toBe(first.value.value.id);
    expect(replay.value.currentTip).toBe(first.value.currentTip);
    expect(await valueRows(binding.id)).toHaveLength(2);
    expect(await historyEvents(binding.id)).toHaveLength(1);
  });
});
