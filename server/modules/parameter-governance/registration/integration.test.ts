import { Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { stringify } from "yaml";

import {
  CatalogReleaseId,
  CatalogSubjectId,
  serializeContract,
  type CatalogReleasePin,
  type ContractJsonValue,
} from "../../parameter-catalog-contract/index";
import { compileCatalogRelease } from "../../catalog-kernel/compiler/index";
import {
  refreshReleaseAggregateDigest,
  validCatalogReleaseBundle,
} from "../../catalog-kernel/compiler/__fixtures__/catalogReleaseBundle";
import type {
  CatalogReleaseAliasDocument,
  CatalogReleaseBundle,
  CatalogReleaseNode,
  CatalogReleaseSubjectDocument,
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

const retiringSuccessorBundle = (): CatalogReleaseBundle => {
  const bundle = structuredClone(validCatalogReleaseBundle());
  const current = bundle.releases.find(
    (release) => release.manifest.release.id === bundle.targetReleaseId,
  );
  if (!current) throw new Error("current successor missing");
  const target = structuredClone(current);
  target.manifest.release.id = "crel_acme_3";
  target.manifest.release.version = "1.2.0";
  target.manifest.release.sequence = 3;
  target.manifest.release.publishedAt = "2026-09-03T00:00:00Z";
  target.manifest.release.predecessor = {
    id: current.manifest.release.id,
    digest: current.manifest.release.digest,
  };

  const subject = target.documents.find(
    (document): document is CatalogReleaseSubjectDocument => document.kind === "subject",
  );
  const alias = target.documents.find(
    (document): document is CatalogReleaseAliasDocument => document.kind === "alias",
  );
  if (!subject || !alias) throw new Error("successor subject/alias missing");

  const successorSubject = structuredClone(subject);
  successorSubject.content.id = "csub_acme_power_next";
  successorSubject.content.canonicalKey = "driver:acme,power-next";
  successorSubject.content.selector = {
    ...successorSubject.content.selector,
    value: "acme,power-next",
  };
  successorSubject.content.lifecycle = "active";
  successorSubject.content.tombstone = null;

  const successorAlias = structuredClone(alias);
  successorAlias.content.id = "cali_acme_power_next";
  successorAlias.content.subjectId = successorSubject.content.id;
  successorAlias.content.normalizedSelector = "acme,power-next-v1";
  successorAlias.content.lifecycle = "active";
  successorAlias.content.tombstone = null;

  subject.content.lifecycle = "retired";
  subject.content.tombstone = {
    reason: "withdrawn",
    withdrawnByReleaseId: target.manifest.release.id,
    previousSelector: "acme,power",
    successorId: successorSubject.content.id,
  };
  alias.content.lifecycle = "retired";
  alias.content.tombstone = {
    reason: "withdrawn",
    withdrawnByReleaseId: target.manifest.release.id,
    previousSelector: alias.content.normalizedSelector,
    successorId: successorAlias.content.id,
  };
  target.documents.push(successorSubject, successorAlias);
  refreshReleaseSource(target);
  bundle.releases.push(target);
  bundle.targetReleaseId = target.manifest.release.id;
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
