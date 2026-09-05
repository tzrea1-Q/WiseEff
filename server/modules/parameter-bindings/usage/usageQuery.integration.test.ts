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
import { stabilizeCanonicalBinding } from "../binding/index";
import { createProjectValueService } from "../values/index";
import { IDENTITY_PLACEHOLDER_SOURCE } from "../values/repositories";

import { createUsageQueries } from "./index";

const databaseAvailable = await isTestDatabaseAvailable();
if (!databaseAvailable) {
  throw new Error(
    "CATFIX-QUERY usage requires a reachable real PostgreSQL server with pgvector; skipping is forbidden",
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
    "CATFIX-QUERY usage requires pgvector installed in the real PostgreSQL test database; skipping is forbidden",
  );
}

const ORG = "org-catfix-usage";
const ORG_B = "org-catfix-usage-b";
const ATTR = "attr-catfix-usage";
const MODULE = "pmod-catfix-usage-driver";
const PROJECT_A = "project-catfix-usage-a";
const PROJECT_B = "project-catfix-usage-b";
const SUBJECT_ID = CatalogSubjectId("csub_acme_power");
const DEFINITION_ID = ParameterDefinitionId("pdef_acme_power_iin_max");
const REVISION_1 = DefinitionRevisionId("drev_acme_power_iin_max_1");
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

describe("CATFIX-QUERY usage summaries", () => {
  let database: EphemeralTestDatabase;
  let pool: pg.Pool;
  let snapshot: CatalogSnapshot;
  let registrationId: string;

  beforeAll(async () => {
    database = await createEphemeralTestDatabase("catfixu");
    pool = new pg.Pool({ connectionString: database.url, max: 4 });
    const bundle = firstReleaseBundle();
    const first = compileOrThrow(bundle);
    const installed = await installPublishedRelease(pool, {
      mode: "bootstrap",
      source: jsonCatalogReleaseSource(bundle),
      expectedTargetDigest: first.aggregateDigest,
    });
    expect(installed.ok).toBe(true);
    const pin: CatalogReleasePin = { id: first.release.id, digest: first.release.digest };
    await pool.query(`insert into public.organizations (id, name) values ($1, 'USAGE A'), ($2, 'USAGE B')`, [
      ORG,
      ORG_B,
    ]);
    await pool.query(
      `insert into public.projects (id, organization_id, name, code) values
         ($1, $3, 'USAGE A', 'USA'),
         ($2, $3, 'USAGE B', 'USB')`,
      [PROJECT_A, PROJECT_B, ORG],
    );
    await pool.query(
      `insert into public.attribution_subjects (
         id, organization_id, subject_kind, display_name, source_key
       ) values ($1, $2, 'driver-registration', 'USAGE driver', 'compatible:acme,power')`,
      [ATTR, ORG],
    );
    await pool.query(
      `insert into public.driver_registrations (attribution_subject_id, driver_nature, instance_cardinality)
       values ($1, 'physical-device', 'multiple')`,
      [ATTR],
    );
    await pool.query(
      `insert into public.parameter_modules (
         id, organization_id, name, path, depth, kind, origin, attribution_subject_id
       ) values ($1, $2, 'Driver', $1, 1, 'driver-group', 'curated', $3)`,
      [MODULE, ORG, ATTR],
    );
    const command: RegisterSubjectCommand = {
      kind: "register",
      organizationId: ORG,
      subjectId: SUBJECT_ID,
      subjectKind: "driver",
      expectedRelease: pin,
      placement: { mode: "use-default" },
      destinationModuleId: MODULE,
      method: "explicit",
      proof: { reason: "catfix-usage" },
      idempotencyKey: `reg:${randomUUID()}`,
      context: { actorKind: "org-admin", principalId: "user-org-admin" },
    };
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("set constraints all deferred");
      const written = await writeGuardedRegistration(client, command);
      expect(written.ok).toBe(true);
      if (!written.ok) throw new Error("registration failed");
      registrationId = written.value.registrationId;
      await client.query("set constraints all immediate");
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    const kernel = createCatalogKernel(pool);
    const loaded = await kernel.loadPinnedCatalog(pin);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) throw new Error("failed to load snapshot");
    snapshot = loaded.value;
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    await database?.drop();
  });

  it("CATFIX-QUERY-05 counts two projects and current values without historical inflation", async () => {
    const values = createProjectValueService(pool);
    const seed = async (logicalNodeId: string, projectId: string) => {
      const binding = await stabilizeCanonicalBinding(pool, {
        snapshot,
        organizationId: ORG,
        projectId,
        logicalNodeId,
        registrationId: registrationId as never,
        definitionId: DEFINITION_ID,
        effectiveRevisionId: REVISION_1,
        expectedEffectiveRevisionId: null,
      });
      expect(binding.ok).toBe(true);
      if (!binding.ok) throw new Error("binding failed");
      let expectedTip = binding.value.binding.currentValueId;
      for (const magnitude of [1, 2]) {
        const appended = await values.append({
          snapshot,
          binding: binding.value.binding,
          definitionRevisionId: REVISION_1,
          source: { sourceRef: `config-set:${logicalNodeId}`, configRevisionId: `crev-${magnitude}` },
          payload: { kind: "number", value: 2000 + magnitude },
          expectedTip,
        });
        expect(appended.ok).toBe(true);
        if (!appended.ok) throw new Error("append failed");
        expectedTip = appended.value.currentTip;
      }
    };
    await seed("logical-usage-1", PROJECT_A);
    await seed("logical-usage-2", PROJECT_B);

    const oracle = await pool.query<{ project_count: string; current_value_count: string; history_count: string }>(
      `select
         (select count(distinct project_id)::text
            from parameter_catalog.project_parameter_bindings
           where organization_id = $1 and definition_id = $2) as project_count,
         (select count(*)::text
            from parameter_catalog.project_parameter_bindings binding
            join parameter_catalog.${VALUES_RELATION} value on value.id = binding.current_value_id
           where binding.organization_id = $1
             and binding.definition_id = $2
             and value.source_ref is distinct from $3) as current_value_count,
         (select count(*)::text
            from parameter_catalog.${VALUES_RELATION} value
            join parameter_catalog.project_parameter_bindings binding on binding.id = value.binding_id
           where binding.organization_id = $1
             and binding.definition_id = $2) as history_count`,
      [ORG, DEFINITION_ID, IDENTITY_PLACEHOLDER_SOURCE],
    );
    expect(oracle.rows[0]?.project_count).toBe("2");
    expect(oracle.rows[0]?.current_value_count).toBe("2");
    expect(Number(oracle.rows[0]?.history_count)).toBeGreaterThan(2);

    const summarized = await createUsageQueries(pool).summarize({
      organizationId: ORG,
      definitionIds: [DEFINITION_ID],
      projectScope: { kind: "all" },
      authScope: { organizationId: ORG, principalId: "user-org-admin" },
    });
    expect(summarized.ok).toBe(true);
    if (!summarized.ok) return;
    expect(summarized.value.summaries[0]).toMatchObject({
      projectCount: 2,
      currentValueCount: 2,
      policyCount: 0,
    });

    const otherOrg = await createUsageQueries(pool).summarize({
      organizationId: ORG_B,
      definitionIds: [DEFINITION_ID],
      projectScope: { kind: "all" },
      authScope: { organizationId: ORG_B, principalId: "user-org-admin-b" },
    });
    expect(otherOrg.ok).toBe(true);
    if (!otherOrg.ok) return;
    expect(otherOrg.value.summaries[0]).toMatchObject({
      projectCount: 0,
      currentValueCount: 0,
    });
  });
});
