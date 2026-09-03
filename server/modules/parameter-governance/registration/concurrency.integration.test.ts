import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CatalogSubjectId, type CatalogReleasePin } from "../../parameter-catalog-contract/index";
import { compileCatalogRelease } from "../../catalog-kernel/compiler/index";
import { validCatalogReleaseBundle } from "../../catalog-kernel/compiler/__fixtures__/catalogReleaseBundle";
import type { CatalogReleaseBundle } from "../../catalog-kernel/compiler/types";
import { jsonCatalogReleaseSource } from "../../catalog-kernel/interface";
import { installPublishedRelease } from "../../catalog-kernel/install/installer";
import { acquireCurrentPointerLockExclusive } from "../../catalog-kernel/install/lockProtocol";
import {
  createEphemeralTestDatabase,
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type EphemeralTestDatabase,
} from "../../../testing/testDatabase";
import { openIndependentCatalogSessions } from "../../../testing/parameterCatalog/sessions";

import type { RegisterSubjectCommand } from "./command";
import { createRegistrationService } from "./service";

const databaseAvailable = await isTestDatabaseAvailable();
if (!databaseAvailable) {
  throw new Error(
    "S4-REG concurrency tests require a reachable real PostgreSQL server with pgvector; skipping is forbidden",
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
    "S4-REG concurrency tests require pgvector installed in the real PostgreSQL test database; skipping is forbidden",
  );
}

const ORG_ID = "org-s4-reg-cx";
const ATTR_ID = "attr-s4-reg-cx";
const MODULE_ID = "pmod-s4-reg-cx";
const SUBJECT_ID = CatalogSubjectId("csub_acme_power");

const firstReleaseBundle = (): CatalogReleaseBundle => {
  const full = validCatalogReleaseBundle();
  const first = structuredClone(full.releases[0]!);
  return {
    schemaVersion: full.schemaVersion,
    targetReleaseId: first.manifest.release.id,
    releases: [first],
  };
};

async function connect(url: string): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  return client;
}

describe("shared guard versus exclusive current-pointer lock", () => {
  let database: EphemeralTestDatabase;
  let pool: pg.Pool;
  let pin: CatalogReleasePin;
  let service: ReturnType<typeof createRegistrationService>;

  const registerCommand = (
    overrides: Partial<RegisterSubjectCommand> = {},
  ): RegisterSubjectCommand => ({
    kind: "register",
    organizationId: ORG_ID,
    subjectId: SUBJECT_ID,
    subjectKind: "driver",
    expectedRelease: pin,
    placement: { mode: "use-default" },
    destinationModuleId: MODULE_ID,
    method: "explicit",
    proof: { reason: "lock-race" },
    idempotencyKey: `lock:${randomUUID()}`,
    context: { actorKind: "org-admin", principalId: "user-org-admin" },
    ...overrides,
  });

  const residue = async (client: pg.Client | pg.Pool) => {
    const result = await client.query<{
      registrations: string;
      placements: string;
    }>(`
      select
        (select count(*)::text from parameter_catalog.organization_subject_registrations) as registrations,
        (select count(*)::text from parameter_catalog.subject_placements) as placements
    `);
    return result.rows[0]!;
  };

  beforeAll(async () => {
    database = await createEphemeralTestDatabase("s4regcx");
    pool = new pg.Pool({ connectionString: database.url, max: 4 });
    const compiled = compileCatalogRelease(firstReleaseBundle());
    if (!compiled.ok) throw new Error("first release failed to compile");
    const installed = await installPublishedRelease(pool, {
      mode: "bootstrap",
      source: jsonCatalogReleaseSource(firstReleaseBundle()),
      expectedTargetDigest: compiled.value.aggregateDigest,
    });
    expect(installed.ok).toBe(true);
    pin = { id: compiled.value.release.id, digest: compiled.value.release.digest };
    await pool.query(`insert into public.organizations (id, name) values ($1, 'S4 REG CX')`, [
      ORG_ID,
    ]);
    await pool.query(
      `insert into public.attribution_subjects (
         id, organization_id, subject_kind, display_name, source_key
       ) values ($1, $2, 'driver-registration', 'CX driver', 'compatible:acme,power')`,
      [ATTR_ID, ORG_ID],
    );
    await pool.query(
      `insert into public.driver_registrations (
         attribution_subject_id, driver_nature, instance_cardinality
       ) values ($1, 'physical-device', 'multiple')`,
      [ATTR_ID],
    );
    await pool.query(
      `insert into public.parameter_modules (
         id, organization_id, name, path, depth, kind, origin, attribution_subject_id
       ) values ($1, $2, 'Driver', $1, 1, 'driver-group', 'curated', $3)`,
      [MODULE_ID, ORG_ID, ATTR_ID],
    );
    service = createRegistrationService(pool);
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    await database?.drop();
  });

  it("returns PCA05 when exclusive pointer lock is held and writes nothing", async () => {
    const holder = await connect(database.url);
    try {
      await holder.query("begin");
      await acquireCurrentPointerLockExclusive(holder);
      const startedAt = Date.now();
      const result = await service.execute(registerCommand());
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toEqual({
        kind: "synchronization-busy",
        code: "PCAT-GUARD-SYNCHRONIZATION-BUSY",
        sqlstate: "PCA05",
        retryable: true,
      });
      expect(Date.now() - startedAt).toBeGreaterThanOrEqual(1_500);
      expect(Date.now() - startedAt).toBeLessThan(3_500);
      expect(await residue(holder)).toEqual({ registrations: "0", placements: "0" });
      await holder.query("rollback");
    } finally {
      await holder.query("rollback").catch(() => undefined);
      await holder.end();
    }
  });

  it("waits for a shared guard holder to end rather than tearing a Registration write", async () => {
    const [holder, observer] = await openIndependentCatalogSessions(database.url);
    try {
      await holder.begin();
      await holder.query(
        "select parameter_catalog.assert_catalog_subject_active($1,$2,$3,$4)",
        [pin.id, pin.digest, SUBJECT_ID, "active"],
      );

      const compiled = compileCatalogRelease(firstReleaseBundle());
      if (!compiled.ok) throw new Error("compile failed");
      const exclusive = installPublishedRelease(pool, {
        mode: "bootstrap",
        source: jsonCatalogReleaseSource(firstReleaseBundle()),
        expectedTargetDigest: compiled.value.aggregateDigest,
      });

      const deadline = Date.now() + 2_000;
      let sawWait = false;
      while (Date.now() < deadline) {
        const waiting = await observer.query<{ waiting: boolean }>(
          `select exists (
             select 1
             from pg_catalog.pg_stat_activity
             where datname = current_database()
               and pid <> pg_backend_pid()
               and wait_event_type = 'Lock'
               and wait_event = 'advisory'
           ) as waiting`,
        );
        if (waiting.rows[0]?.waiting) {
          sawWait = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(sawWait).toBe(true);
      expect(await residue(pool)).toEqual({ registrations: "0", placements: "0" });
      await holder.commit();
      await expect(exclusive).resolves.toMatchObject({
        ok: true,
        value: { status: "already-current" },
      });
    } finally {
      await holder.rollback().catch(() => undefined);
      await holder.close();
      await observer.close();
    }
  });
});
