import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  CatalogReleaseId,
  CatalogSubjectId,
  type CatalogReleasePin,
} from "../../parameter-catalog-contract/index";
import { compileCatalogRelease } from "../../catalog-kernel/compiler/index";
import {
  validCatalogReleaseBundle,
} from "../../catalog-kernel/compiler/__fixtures__/catalogReleaseBundle";
import { refreshSuccessorSource } from "../../catalog-publication/builder/bundleCodec";
import type {
  CatalogReleaseBundle,
} from "../../catalog-kernel/compiler/types";
import { jsonCatalogReleaseSource } from "../../catalog-kernel/interface";
import { installPublishedRelease } from "../../catalog-kernel/install/installer";
import {
  createEphemeralTestDatabase,
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type EphemeralTestDatabase,
} from "../../../testing/testDatabase";

import type { RegisterSubjectCommand } from "./command";
import { createRegistrationService } from "./service";

const databaseAvailable = await isTestDatabaseAvailable();
if (!databaseAvailable) {
  throw new Error(
    "S4-REG requires a reachable real PostgreSQL server with pgvector; skipping is forbidden",
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
    "S4-REG requires pgvector installed in the real PostgreSQL test database; skipping is forbidden",
  );
}

const ORG_ID = "org-s4-reg";
const ATTR_ID = "attr-s4-reg";
const ATTR_ID_B = "attr-s4-reg-b";
const MODULE_ID = "pmod-s4-reg-driver";
const MODULE_ID_B = "pmod-s4-reg-driver-b";
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

const retiringSuccessorBundle = (): CatalogReleaseBundle => {
  const bundle = structuredClone(validCatalogReleaseBundle());
  const current = bundle.releases.find(
    (release) => release.manifest.release.id === bundle.targetReleaseId,
  );
  if (!current) throw new Error("current successor missing");
  const subject = current.documents.find((document) => document.kind === "subject");
  const alias = current.documents.find((document) => document.kind === "alias");
  if (subject?.kind !== "subject" || alias?.kind !== "alias") throw new Error("successor subject/alias missing");
  const successorSubject = { ...subject, content: { ...subject.content,
    id: "csub_acme_power_next", canonicalKey: "driver:acme,power-next",
    selector: { ...subject.content.selector, value: "acme,power-next" },
    lifecycle: "active" as const, tombstone: null,
  } };
  const successorAlias = { ...alias, content: { ...alias.content,
    id: "cali_acme_power_next", subjectId: successorSubject.content.id,
    normalizedSelector: "acme,power-next-v1", lifecycle: "active" as const, tombstone: null,
  } };
  const releaseId = "crel_acme_3";
  const target = refreshSuccessorSource({ ...current,
    manifest: { ...current.manifest, release: { ...current.manifest.release,
      id: releaseId, version: "1.2.0", sequence: 3, publishedAt: "2026-09-03T00:00:00Z",
      predecessor: { id: current.manifest.release.id, digest: current.manifest.release.digest },
    } },
    documents: [...current.documents.map((document) => document === subject ? {
      ...subject, content: { ...subject.content, lifecycle: "retired" as const, tombstone: {
        reason: "withdrawn", withdrawnByReleaseId: releaseId, previousSelector: "acme,power",
        successorId: successorSubject.content.id,
      } },
    } : document === alias ? { ...alias, content: { ...alias.content, lifecycle: "retired" as const,
      tombstone: { reason: "withdrawn", withdrawnByReleaseId: releaseId,
        previousSelector: alias.content.normalizedSelector, successorId: successorAlias.content.id },
    } } : document), successorSubject, successorAlias],
  }, current.manifest.files[0]?.path ?? "schemas/dts/vendor/acme-power.yaml");
  return { ...bundle, releases: [...bundle.releases, target], targetReleaseId: releaseId };
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

describe("guarded Registration and Placement", () => {
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
    proof: { reason: "captured-kernel-proof" },
    idempotencyKey: `reg:${randomUUID()}`,
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
    database = await createEphemeralTestDatabase("s4regint");
    pool = new pg.Pool({ connectionString: database.url, max: 4 });
    const first = compileOrThrow(firstReleaseBundle());
    const installed = await installPublishedRelease(pool, {
      mode: "bootstrap",
      source: jsonCatalogReleaseSource(firstReleaseBundle()),
      expectedTargetDigest: first.aggregateDigest,
    });
    expect(installed.ok).toBe(true);
    pin = { id: first.release.id, digest: first.release.digest };
    await pool.query(`insert into public.organizations (id, name) values ($1, 'S4 REG')`, [ORG_ID]);
    await pool.query(
      `insert into public.attribution_subjects (
         id, organization_id, subject_kind, display_name, source_key
       ) values
         ($1, $3, 'driver-registration', 'S4 REG driver', 'compatible:acme,power'),
         ($2, $3, 'driver-registration', 'S4 REG driver b', 'compatible:acme,power-b')`,
      [ATTR_ID, ATTR_ID_B, ORG_ID],
    );
    await pool.query(
      `insert into public.driver_registrations (
         attribution_subject_id, driver_nature, instance_cardinality
       ) values ($1, 'physical-device', 'multiple'), ($2, 'physical-device', 'multiple')`,
      [ATTR_ID, ATTR_ID_B],
    );
    await pool.query(
      `insert into public.parameter_modules (
         id, organization_id, name, path, depth, kind, origin, attribution_subject_id
       ) values
         ($1, $3, 'Driver', $1, 1, 'driver-group', 'curated', $4),
         ($2, $3, 'Driver B', $2, 1, 'driver-group', 'curated', $5)`,
      [MODULE_ID, MODULE_ID_B, ORG_ID, ATTR_ID, ATTR_ID_B],
    );
    service = createRegistrationService(pool);
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    await database?.drop();
  });

  it("creates one Registration and exactly one Placement from a captured pin", async () => {
    const result = await service.execute(registerCommand());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.outcome).toBe("committed");
    expect(result.value.registrationStatus).toBe("active");
    expect(result.value.placementOrigin).toBe("curated");
    expect(result.value.moduleId).toBe(MODULE_ID);
    expect(result.value.subjectId).toBe(SUBJECT_ID);
    expect(result.value.release).toEqual(pin);

    const stored = await pool.query<{
      registrations: string;
      placements: string;
      placement_registration: string;
    }>(
      `
      select
        (select count(*)::text
           from parameter_catalog.organization_subject_registrations
          where organization_id = $1 and subject_id = $2) as registrations,
        (select count(*)::text
           from parameter_catalog.subject_placements
          where organization_id = $1) as placements,
        (select registration_id
           from parameter_catalog.subject_placements
          where id = $3) as placement_registration
      `,
      [ORG_ID, SUBJECT_ID, result.value.placementId],
    );
    expect(stored.rows[0]).toEqual({
      registrations: "1",
      placements: "1",
      placement_registration: result.value.registrationId,
    });
  });

  it("atomically initializes a typed destination, replays it and rolls back rejected or duplicate initialization", async () => {
    const org = `org-init-${randomUUID()}`;
    const parent = `business-${randomUUID()}`;
    const target = `driver-${randomUUID()}`;
    await pool.query(`insert into public.organizations(id,name) values($1,'Initialization')`, [org]);
    await pool.query(`insert into public.parameter_modules(id,organization_id,name,path,kind,origin) values($1,$2,'Business',$1,'business','curated')`, [parent, org]);
    const command = registerCommand({ organizationId: org, destinationModuleId: target, newDestination: { parentModuleId: parent, name: "Canonical driver" }, idempotencyKey: "initialize-exact" });
    const initialized = await Promise.all([service.execute(command), service.execute(command)]);
    expect(initialized.every((result) => result.ok)).toBe(true);
    expect(initialized.map((result) => result.ok ? result.value.outcome : "failed").sort()).toEqual(["committed", "replayed"]);
    expect(await service.execute(command)).toMatchObject({ ok: true, value: { outcome: "replayed", moduleId: target } });
    const created = await pool.query(`select module.kind,module.parent_id,module.path,subject.source_key from public.parameter_modules module join public.attribution_subjects subject on subject.id=module.attribution_subject_id where module.id=$1`, [target]);
    expect(created.rows[0]).toEqual({ kind: "driver-group", parent_id: parent, path: `${parent}/${target}`, source_key: `catalog-subject:${SUBJECT_ID}` });
    const before = await residue();
    expect(await service.execute({ ...command, destinationModuleId: `${target}-foreign`, idempotencyKey: "wrong-parent", newDestination: { parentModuleId: MODULE_ID, name: "Foreign parent" } })).toMatchObject({ ok: false, error: { kind: "invalid-placement-parent" } });
    expect(await residue()).toEqual(before);
    const lateOrg = `${org}-late`;
    const lateParent = `${parent}-late`;
    const lateTarget = `${target}-late`;
    await pool.query(`insert into public.organizations(id,name) values($1,'Late rollback')`, [lateOrg]);
    await pool.query(`insert into public.parameter_modules(id,organization_id,name,path,kind,origin) values($1,$2,'Business',$1,'business','curated')`, [lateParent, lateOrg]);
    expect(await service.execute({ ...command, organizationId: lateOrg, subjectKind: "node-type", destinationModuleId: lateTarget, newDestination: { parentModuleId: lateParent, name: "Wrong subject kind" } })).toMatchObject({ ok: false });
    expect((await pool.query(`select id from public.parameter_modules where id=$1`, [lateTarget])).rows).toHaveLength(0);
    expect((await pool.query(`select id from public.attribution_subjects where id=$1`, [`asub:canonical:${lateTarget}`])).rows).toHaveLength(0);
    expect(await residue()).toEqual(before);
    expect(await service.execute({ ...command, destinationModuleId: `${target}-duplicate`, idempotencyKey: "duplicate-init" })).toMatchObject({ ok: false });
    expect(await residue()).toEqual(before);
    expect((await pool.query(`select id from public.parameter_modules where id=$1`, [`${target}-duplicate`])).rows).toHaveLength(0);
    expect(await service.execute({ ...command, destinationModuleId: `${target}-wrong-kind`, idempotencyKey: "wrong-kind-parent", newDestination: { parentModuleId: target, name: "Wrong kind" } })).toMatchObject({ ok: false, error: { kind: "invalid-placement-parent" } });
    expect(await residue()).toEqual(before);
  });

  it("does not automatically restore a retired Registration", async () => {
    const existing = await pool.query<{ id: string }>(
      `select id
         from parameter_catalog.organization_subject_registrations
        where organization_id = $1 and subject_id = $2`,
      [ORG_ID, SUBJECT_ID],
    );
    const registrationId = existing.rows[0]?.id;
    expect(registrationId).toBeDefined();
    const retire = await service.execute({
      kind: "retire",
      organizationId: ORG_ID,
      registrationId: registrationId as never,
      expectedRelease: pin,
      idempotencyKey: `retire:${randomUUID()}`,
      context: { actorKind: "org-admin", principalId: "user-org-admin" },
      reason: "lifecycle-retire",
    });
    expect(retire.ok).toBe(true);

    const beforeMove = await residue();
    const moveWhileRetired = await service.execute({
      kind: "move-placement",
      organizationId: ORG_ID,
      registrationId: registrationId as never,
      expectedRelease: pin,
      destinationModuleId: MODULE_ID_B,
      idempotencyKey: `move-retired:${randomUUID()}`,
      context: { actorKind: "org-admin", principalId: "user-org-admin" },
    });
    expect(moveWhileRetired).toEqual({
      ok: false,
      error: {
        kind: "restore-required",
        registrationId,
      },
    });
    expect(await residue()).toEqual(beforeMove);
    await expect(
      pool.query<{ module_id: string }>(
        `select module_id
           from parameter_catalog.subject_placements
          where registration_id = $1`,
        [registrationId],
      ),
    ).resolves.toMatchObject({ rows: [{ module_id: MODULE_ID }] });

    const automatic = await service.execute(
      registerCommand({
        method: "automatic",
        context: { actorKind: "trusted-system", principalId: "system-matcher" },
        idempotencyKey: `auto-restore:${randomUUID()}`,
      }),
    );
    expect(automatic.ok).toBe(false);
    if (automatic.ok) return;
    expect(automatic.error.kind).toBe("auto-restore-forbidden");
    const stored = await pool.query<{ status: string; count: string }>(
      `select status,
              (select count(*)::text
                 from parameter_catalog.subject_placements
                where registration_id = $1) as count
         from parameter_catalog.organization_subject_registrations
        where id = $1`,
      [registrationId],
    );
    expect(stored.rows[0]).toEqual({ status: "retired", count: "1" });

    const restored = await service.execute({
      kind: "restore",
      organizationId: ORG_ID,
      registrationId: registrationId as never,
      expectedRelease: pin,
      idempotencyKey: `restore:${randomUUID()}`,
      context: { actorKind: "org-admin", principalId: "user-org-admin" },
      reason: "reactivate-for-later-cases",
    });
    expect(restored.ok).toBe(true);
  });

  it("refuses a second Placement for the same Registration and leaves residue unchanged", async () => {
    const first = await service.execute(registerCommand({ idempotencyKey: `dup:${randomUUID()}` }));
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const before = await residue();
    const second = await service.execute(
      registerCommand({
        idempotencyKey: `dup-b:${randomUUID()}`,
        destinationModuleId: MODULE_ID_B,
      }),
    );
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error.kind).toBe("placement-conflict");
    expect(await residue()).toEqual(before);
    const placements = await pool.query<{ count: string }>(
      `select count(*)::text as count
         from parameter_catalog.subject_placements
        where registration_id = $1`,
      [first.value.registrationId],
    );
    expect(placements.rows[0]?.count).toBe("1");
  });

  it("uses the locked Placement version for stale moves and replays before rechecking it", async () => {
    const current = await pool.query<{
      registration_id: string;
      placement_id: string;
      module_id: string;
      version: string;
    }>(
      `select placement.registration_id, placement.id as placement_id, placement.module_id,
              (extract(epoch from placement.updated_at) * 1000000)::bigint::text as version
         from parameter_catalog.subject_placements placement
        where placement.organization_id = $1
        order by placement.id
        limit 1`,
      [ORG_ID],
    );
    const row = current.rows[0];
    expect(row).toBeDefined();
    if (!row) return;
    const staleVersion = (BigInt(row.version) - 1n).toString();
    const before = await residue();
    const stale = await service.execute({
      kind: "move-placement",
      organizationId: ORG_ID,
      registrationId: row.registration_id as never,
      expectedRelease: pin,
      destinationModuleId: MODULE_ID_B,
      expectedPlacementVersion: staleVersion,
      idempotencyKey: `move-stale:${randomUUID()}`,
      context: { actorKind: "org-admin", principalId: "user-org-admin" },
    });
    expect(stale).toEqual({
      ok: false,
      error: {
        kind: "placement-conflict",
        registrationId: row.registration_id,
        placementId: row.placement_id,
      },
    });
    expect(await residue()).toEqual(before);
    await expect(
      pool.query<{ module_id: string }>(
        `select module_id from parameter_catalog.subject_placements where id = $1`,
        [row.placement_id],
      ),
    ).resolves.toMatchObject({ rows: [{ module_id: row.module_id }] });

    const command = {
      kind: "move-placement" as const,
      organizationId: ORG_ID,
      registrationId: row.registration_id as never,
      expectedRelease: pin,
      destinationModuleId: MODULE_ID_B,
      expectedPlacementVersion: row.version,
      idempotencyKey: `move-replay:${randomUUID()}`,
      context: { actorKind: "org-admin" as const, principalId: "user-org-admin" },
    };
    const moved = await service.execute(command);
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(moved.value.outcome).toBe("committed");
    expect(moved.value.placementVersion).toBeDefined();
    expect(moved.value.placementVersion).not.toBe(row.version);
    const replayed = await service.execute(command);
    expect(replayed).toEqual({ ok: true, value: { ...moved.value, outcome: "replayed" } });
    const after = await pool.query<{ module_id: string; count: string }>(
      `select module_id,
              (select count(*)::text from parameter_catalog.subject_placements where registration_id = $2) as count
         from parameter_catalog.subject_placements
        where id = $1`,
      [row.placement_id, row.registration_id],
    );
    expect(after.rows[0]).toEqual({ module_id: MODULE_ID_B, count: "1" });
  });

  it("maps a stale pin to PCA01 and writes no residue", async () => {
    const before = await residue();
    const successor = compileOrThrow(validCatalogReleaseBundle());
    const advanced = await installPublishedRelease(pool, {
      mode: "advance",
      source: jsonCatalogReleaseSource(validCatalogReleaseBundle()),
      expectedCurrent: pin,
      expectedTargetDigest: successor.aggregateDigest,
    });
    expect(advanced.ok).toBe(true);

    const result = await service.execute(registerCommand({ idempotencyKey: `stale:${randomUUID()}` }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatchObject({
      kind: "release-drift",
      sqlstate: "PCA01",
      code: "PCAT-GUARD-RELEASE-MISMATCH",
    });
    expect(await residue()).toEqual(before);

    pin = { id: successor.release.id, digest: successor.release.digest };
  });

  it("maps retired current membership to PCA03", async () => {
    const retiring = compileOrThrow(retiringSuccessorBundle());
    const advanced = await installPublishedRelease(pool, {
      mode: "advance",
      source: jsonCatalogReleaseSource(retiringSuccessorBundle()),
      expectedCurrent: pin,
      expectedTargetDigest: retiring.aggregateDigest,
    });
    expect(advanced.ok).toBe(true);
    pin = { id: retiring.release.id, digest: retiring.release.digest };

    const before = await residue();
    const result = await service.execute(
      registerCommand({
        idempotencyKey: `retired:${randomUUID()}`,
        expectedRelease: pin,
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatchObject({
      kind: "subject-retired",
      sqlstate: "PCA03",
      code: "PCAT-GUARD-SUBJECT-RETIRED",
      subjectId: SUBJECT_ID,
    });
    expect(await residue()).toEqual(before);
    expect(CatalogReleaseId(pin.id)).toBe(pin.id);
  });
});
