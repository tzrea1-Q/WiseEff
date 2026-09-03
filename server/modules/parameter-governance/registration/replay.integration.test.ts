import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CatalogSubjectId, type CatalogReleasePin } from "../../parameter-catalog-contract/index";
import { compileCatalogRelease } from "../../catalog-kernel/compiler/index";
import { validCatalogReleaseBundle } from "../../catalog-kernel/compiler/__fixtures__/catalogReleaseBundle";
import type { CatalogReleaseBundle } from "../../catalog-kernel/compiler/types";
import { jsonCatalogReleaseSource } from "../../catalog-kernel/interface";
import { installPublishedRelease } from "../../catalog-kernel/install/installer";
import {
  createEphemeralTestDatabase,
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type EphemeralTestDatabase,
} from "../../../testing/testDatabase";

import type { RegisterSubjectCommand } from "./command";
import { writeGuardedRegistration } from "./internalGuardedRegistrationWriter";
import { createRegistrationService } from "./service";
import { withRegistrationUnitOfWork } from "./unitOfWork";

const databaseAvailable = await isTestDatabaseAvailable();
if (!databaseAvailable) {
  throw new Error(
    "S4-REG replay tests require a reachable real PostgreSQL server with pgvector; skipping is forbidden",
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
    "S4-REG replay tests require pgvector installed in the real PostgreSQL test database; skipping is forbidden",
  );
}

const ORG_ID = "org-s4-reg-rp";
const ROLLBACK_ORG_ID = "org-s4-reg-rb";
const ATTR_ID = "attr-s4-reg-rp";
const ROLLBACK_ATTR_ID = "attr-s4-reg-rb";
const MODULE_ID = "pmod-s4-reg-rp";
const ROLLBACK_MODULE_ID = "pmod-s4-reg-rb";
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

describe("idempotent replay and writer rollback", () => {
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
    proof: { reason: "replay-proof" },
    idempotencyKey: `replay:${randomUUID()}`,
    context: { actorKind: "org-admin", principalId: "user-org-admin" },
    ...overrides,
  });

  const residue = async () => {
    const result = await pool.query<{
      registrations: string;
      placements: string;
      idempotency: string;
    }>(`
      select
        (select count(*)::text from parameter_catalog.organization_subject_registrations) as registrations,
        (select count(*)::text from parameter_catalog.subject_placements) as placements,
        (select count(*)::text from parameter_catalog.governance_command_idempotency) as idempotency
    `);
    return result.rows[0]!;
  };

  beforeAll(async () => {
    database = await createEphemeralTestDatabase("s4regrp");
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
    await pool.query(
      `insert into public.organizations (id, name) values ($1, 'S4 REG RP'), ($2, 'S4 REG RB')`,
      [ORG_ID, ROLLBACK_ORG_ID],
    );
    await pool.query(
      `insert into public.attribution_subjects (
         id, organization_id, subject_kind, display_name, source_key
       ) values
         ($1, $3, 'driver-registration', 'RP driver', 'compatible:acme,power'),
         ($2, $4, 'driver-registration', 'RB driver', 'compatible:acme,power')`,
      [ATTR_ID, ROLLBACK_ATTR_ID, ORG_ID, ROLLBACK_ORG_ID],
    );
    await pool.query(
      `insert into public.driver_registrations (
         attribution_subject_id, driver_nature, instance_cardinality
       ) values ($1, 'physical-device', 'multiple'), ($2, 'physical-device', 'multiple')`,
      [ATTR_ID, ROLLBACK_ATTR_ID],
    );
    await pool.query(
      `insert into public.parameter_modules (
         id, organization_id, name, path, depth, kind, origin, attribution_subject_id
       ) values
         ($1, $3, 'Driver', $1, 1, 'driver-group', 'curated', $5),
         ($2, $4, 'Driver', $2, 1, 'driver-group', 'curated', $6)`,
      [MODULE_ID, ROLLBACK_MODULE_ID, ORG_ID, ROLLBACK_ORG_ID, ATTR_ID, ROLLBACK_ATTR_ID],
    );
    service = createRegistrationService(pool);
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    await database?.drop();
  });

  it("replays a lost response to the exact stored result without a second Placement", async () => {
    const command = registerCommand({ idempotencyKey: `lost:${randomUUID()}` });
    const first = await service.execute(command);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = await service.execute(command);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value).toEqual({
      ...first.value,
      outcome: "replayed",
    });
    expect(await residue()).toEqual({
      registrations: "1",
      placements: "1",
      idempotency: "1",
    });
  });

  it("conflicts when the same idempotency key is reused with a different fingerprint", async () => {
    const key = `conflict:${randomUUID()}`;
    const first = await service.execute(registerCommand({ idempotencyKey: key }));
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = await service.execute(
      registerCommand({
        idempotencyKey: key,
        proof: { reason: "tampered-proof" },
      }),
    );
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error.kind).toBe("revision-conflict");
    if (second.error.kind === "revision-conflict") {
      expect(second.error.storedFingerprint).toBe(first.value.fingerprint);
      expect(second.error.attemptedFingerprint).not.toBe(first.value.fingerprint);
    }
    const after = await residue();
    expect(after.registrations).toBe("1");
    expect(after.placements).toBe("1");
  });

  it("rolls back the writer transaction and leaves zero registration residue", async () => {
    const command = registerCommand({
      organizationId: ROLLBACK_ORG_ID,
      destinationModuleId: ROLLBACK_MODULE_ID,
      idempotencyKey: `rollback:${randomUUID()}`,
    });
    await expect(
      withRegistrationUnitOfWork(pool, async (client) => {
        const written = await writeGuardedRegistration(client, command);
        expect(written.ok).toBe(true);
        throw new Error("injected-registration-rollback");
      }),
    ).rejects.toThrow("injected-registration-rollback");
    const leftover = await pool.query<{
      registrations: string;
      placements: string;
      idempotency: string;
    }>(
      `
      select
        (select count(*)::text
           from parameter_catalog.organization_subject_registrations
          where organization_id = $1) as registrations,
        (select count(*)::text
           from parameter_catalog.subject_placements
          where organization_id = $1) as placements,
        (select count(*)::text
           from parameter_catalog.governance_command_idempotency
          where organization_id = $1) as idempotency
      `,
      [ROLLBACK_ORG_ID],
    );
    expect(leftover.rows[0]).toEqual({
      registrations: "0",
      placements: "0",
      idempotency: "0",
    });
  });
});
