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
import { openIndependentCatalogSessions } from "../../../testing/parameterCatalog/sessions";
import {
  createEphemeralTestDatabase,
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type EphemeralTestDatabase,
} from "../../../testing/testDatabase";
import { stabilizeCanonicalBinding, type Binding } from "../binding";

import { appendProjectValue } from "./index";

const databaseAvailable = await isTestDatabaseAvailable();
if (!databaseAvailable) {
  throw new Error(
    "S6-VAL concurrency tests require a reachable real PostgreSQL server with pgvector; skipping is forbidden",
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
    "S6-VAL concurrency tests require pgvector installed in the real PostgreSQL test database; skipping is forbidden",
  );
}

const ORG = "org-s6-val-cx";
const ATTR = "attr-s6-val-cx";
const MODULE = "pmod-s6-val-cx";
const PROJECT = "project-s6-val-cx";
const SUBJECT_ID = CatalogSubjectId("csub_acme_power");
const DEFINITION_ID = ParameterDefinitionId("pdef_acme_power_iin_max");
const REVISION_1 = DefinitionRevisionId("drev_acme_power_iin_max_1");
const NODE_RACE = "logical-node-cas-race";
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

describe("canonical ProjectValue independent-session races", () => {
  let database: EphemeralTestDatabase;
  let pool: pg.Pool;
  let snapshot: CatalogSnapshot;
  let registrationId: Binding["registrationId"];
  let binding: Binding;

  const registerCommand = (expectedRelease: CatalogReleasePin): RegisterSubjectCommand => ({
    kind: "register",
    organizationId: ORG,
    subjectId: SUBJECT_ID,
    subjectKind: "driver",
    expectedRelease,
    placement: { mode: "use-default" },
    destinationModuleId: MODULE,
    method: "explicit",
    proof: { reason: "s6-val-race" },
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

  beforeAll(async () => {
    database = await createEphemeralTestDatabase("s6valcx");
    pool = new pg.Pool({ connectionString: database.url, max: 4 });
    const first = compileOrThrow(firstReleaseBundle());
    const installed = await installPublishedRelease(pool, {
      mode: "bootstrap",
      source: jsonCatalogReleaseSource(firstReleaseBundle()),
      expectedTargetDigest: first.aggregateDigest,
    });
    expect(installed.ok).toBe(true);

    await pool.query(`insert into public.organizations (id, name) values ($1, 'S6 VAL CX')`, [ORG]);
    await pool.query(
      `insert into public.projects (id, organization_id, name, code) values ($1, $2, 'S6 VAL CX', 'S6VALCX')`,
      [PROJECT, ORG],
    );
    await pool.query(
      `insert into public.attribution_subjects (
         id, organization_id, subject_kind, display_name, source_key
       ) values ($1, $2, 'driver-registration', 'S6 VAL CX', 'compatible:acme,power')`,
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
       ) values ($1, $2, 'Driver CX', $1, 1, 'driver-group', 'curated', $3)`,
      [MODULE, ORG, ATTR],
    );

    const pin = { id: first.release.id, digest: first.release.digest };
    const registered = await seedRegistration(registerCommand(pin));
    expect(registered.ok).toBe(true);
    if (!registered.ok) {
      throw new Error("S4-REG writeGuardedRegistration failed in the race harness");
    }
    registrationId = registered.value.registrationId;

    const kernel = createCatalogKernel(pool);
    const loaded = await kernel.loadPinnedCatalog(pin);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) throw new Error("failed to load frozen snapshot");
    snapshot = loaded.value;

    const stabilized = await stabilizeCanonicalBinding(pool, {
      snapshot,
      organizationId: ORG,
      projectId: PROJECT,
      logicalNodeId: NODE_RACE,
      registrationId,
      definitionId: DEFINITION_ID,
      effectiveRevisionId: REVISION_1,
      expectedEffectiveRevisionId: null,
    });
    expect(stabilized.ok).toBe(true);
    if (!stabilized.ok) {
      throw new Error("S6-BND stabilizeCanonicalBinding failed in the race harness");
    }
    binding = stabilized.value.binding;
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    await database?.drop();
  });

  it("lets one CAS winner commit and the other refuse without mixing tips", async () => {
    const [leftSession, rightSession] = await openIndependentCatalogSessions(database.url);
    expect(leftSession.backendPid).not.toBe(rightSession.backendPid);
    await leftSession.close();
    await rightSession.close();

    const poolA = new pg.Pool({ connectionString: database.url, max: 1 });
    const poolB = new pg.Pool({ connectionString: database.url, max: 1 });
    try {
      const [left, right] = await Promise.all([
        appendProjectValue(poolA, {
          snapshot,
          binding,
          definitionRevisionId: REVISION_1,
          source: { sourceRef: "config-set:main", configRevisionId: "crev-left" },
          payload: { kind: "number", value: 101 },
          expectedTip: binding.currentValueId,
        }),
        appendProjectValue(poolB, {
          snapshot,
          binding,
          definitionRevisionId: REVISION_1,
          source: { sourceRef: "config-set:main", configRevisionId: "crev-right" },
          payload: { kind: "number", value: 202 },
          expectedTip: binding.currentValueId,
        }),
      ]);

      const outcomes = [left, right];
      const wins = outcomes.filter((result) => result.ok);
      const losses = outcomes.filter((result) => !result.ok);
      expect(wins).toHaveLength(1);
      expect(losses).toHaveLength(1);
      if (!wins[0] || !wins[0].ok || !losses[0] || losses[0].ok) return;
      expect(losses[0].error.kind).toBe("cas-mismatch");
      expect(wins[0].value.outcome).toBe("committed");

      const stored = await pool.query<{ current_value_id: string }>(
        `select current_value_id
           from parameter_catalog.project_parameter_bindings
          where id = $1`,
        [binding.id],
      );
      expect(stored.rows).toEqual([{ current_value_id: wins[0].value.currentTip }]);

      const values = await pool.query<{ id: string }>(
        `select id from parameter_catalog.${VALUES_RELATION}
          where binding_id = $1
            and source_ref <> 'canonical-binding-identity'`,
        [binding.id],
      );
      expect(values.rows).toEqual([{ id: wins[0].value.value.id }]);

      const events = await pool.query<{ count: string }>(
        `select count(*)::text as count
           from parameter_catalog.binding_history_events
          where binding_id = $1`,
        [binding.id],
      );
      expect(events.rows).toEqual([{ count: "1" }]);
    } finally {
      await poolA.end();
      await poolB.end();
    }
  });
});
