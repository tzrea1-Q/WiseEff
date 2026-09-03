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
  CatalogReleaseAliasDocument,
  CatalogReleaseBundle,
  CatalogReleaseNode,
  CatalogReleaseSubjectDocument,
} from "../../catalog-kernel/compiler/types";
import { jsonCatalogReleaseSource } from "../../catalog-kernel/interface";
import { installPublishedRelease } from "../../catalog-kernel/install/installer";
import {
  CatalogSubjectId,
  serializeContract,
  type CatalogReleasePin,
  type ContractJsonValue,
} from "../../parameter-catalog-contract/index";
import { createEvidenceIngest } from "../evidence/index";
import type { IngestEvidenceCommand } from "../evidence/types";
import { createReviewQueueReader } from "../review/index";
import type { ReviewQueueItem, ReviewQueueTrustedContext } from "../review/types";
import {
  createEphemeralTestDatabase,
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type EphemeralTestDatabase,
} from "../../../testing/testDatabase";

import { createReviewItemResolver } from "./index";
import type { RegisterSubjectResolutionCommand } from "./command";

const databaseAvailable = await isTestDatabaseAvailable();
if (!databaseAvailable) {
  throw new Error(
    "S5-RSL requires a reachable real PostgreSQL server with pgvector; skipping is forbidden",
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
    "S5-RSL requires pgvector installed in the real PostgreSQL test database; skipping is forbidden",
  );
}

const ORG_ID = "org-s5-rsl";
const ATTR_ID = "attr-s5-rsl";
const MODULE_ID = "pmod-s5-rsl-driver";
const MODULE_ID_B = "pmod-s5-rsl-driver-b";
const ATTR_ID_B = "attr-s5-rsl-b";
const SUBJECT_ID = CatalogSubjectId("csub_acme_power");
const MATCHER_REVISION = "matcher-s5-rsl-1";

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

describe("atomic resolveReviewItem coordinator", () => {
  let database: EphemeralTestDatabase;
  let pool: pg.Pool;
  let pin: CatalogReleasePin;
  let ingest: ReturnType<typeof createEvidenceIngest>;
  let reader: ReturnType<typeof createReviewQueueReader>;
  let resolver: ReturnType<typeof createReviewItemResolver>;

  const admin: ReviewQueueTrustedContext = {
    actorKind: "org-admin",
    principalId: "user-org-admin",
    organizationId: ORG_ID,
  };

  const reviewCommand = (
    overrides: Partial<IngestEvidenceCommand> = {},
  ): IngestEvidenceCommand => ({
    organizationId: ORG_ID,
    sourceIdentity: `unknown:${randomUUID()}`,
    catalogReleaseId: pin.id,
    matcherRevision: MATCHER_REVISION,
    matcherOutput: { status: "unknown" },
    evidence: { propertyKey: "iin_max" },
    provenance: null,
    ...overrides,
  });

  const residue = async () => {
    const result = await pool.query<{
      resolutions: string;
      registrations: string;
      placements: string;
      idempotency: string;
      success_audits: string;
      open_items: string;
    }>(
      `
      select
        (select count(*)::text
           from parameter_catalog.parameter_review_resolutions r
           join parameter_catalog.parameter_review_items i on i.id = r.review_item_id
          where i.organization_id = $1) as resolutions,
        (select count(*)::text
           from parameter_catalog.organization_subject_registrations
          where organization_id = $1) as registrations,
        (select count(*)::text
           from parameter_catalog.subject_placements
          where organization_id = $1) as placements,
        (select count(*)::text
           from parameter_catalog.governance_command_idempotency
          where organization_id = $1 and command_family = 'review-resolution') as idempotency,
        (select count(*)::text
           from public.audit_events
          where organization_id = $1 and action = 'review-item-resolved') as success_audits,
        (select count(*)::text
           from parameter_catalog.parameter_review_items
          where organization_id = $1 and status = 'open') as open_items
      `,
      [ORG_ID],
    );
    return result.rows[0]!;
  };

  const openReviewItem = async (propertyKey: string): Promise<ReviewQueueItem> => {
    const ingested = await ingest.ingest(
      reviewCommand({
        sourceIdentity: `${propertyKey}:${randomUUID()}`,
        catalogReleaseId: pin.id,
        evidence: { propertyKey },
      }),
    );
    expect(ingested.ok).toBe(true);
    const listed = await reader.list({
      organizationId: ORG_ID,
      capturedRelease: pin,
      context: admin,
    });
    expect(listed.ok).toBe(true);
    if (!listed.ok) throw new Error("review queue list failed");
    const item = listed.value.items.find((entry) => entry.identityKey === `property:${propertyKey}`);
    expect(item).toBeDefined();
    if (!item) throw new Error("expected open review item");
    return item;
  };

  const resolveCommand = (
    item: ReviewQueueItem,
    overrides: Partial<RegisterSubjectResolutionCommand> = {},
  ): RegisterSubjectResolutionCommand => ({
    resolution: "register-subject",
    organizationId: ORG_ID,
    reviewItemId: item.id,
    expectedRelease: pin,
    etag: item.etag,
    idempotencyKey: `resolve:${randomUUID()}`,
    context: {
      actorKind: "org-admin",
      principalId: "user-org-admin",
      organizationId: ORG_ID,
    },
    reason: item.reason,
    subjectId: SUBJECT_ID,
    subjectKind: "driver",
    placement: { mode: "use-default" },
    destinationModuleId: MODULE_ID,
    ...overrides,
  });

  beforeAll(async () => {
    database = await createEphemeralTestDatabase("s5rsl");
    pool = new pg.Pool({ connectionString: database.url, max: 4 });
    const first = compileOrThrow(firstReleaseBundle());
    const installed = await installPublishedRelease(pool, {
      mode: "bootstrap",
      source: jsonCatalogReleaseSource(firstReleaseBundle()),
      expectedTargetDigest: first.aggregateDigest,
    });
    expect(installed.ok).toBe(true);
    pin = { id: first.release.id, digest: first.release.digest };
    await pool.query(`insert into public.organizations (id, name) values ($1, 'S5 RSL')`, [ORG_ID]);
    await pool.query(
      `insert into public.attribution_subjects (
         id, organization_id, subject_kind, display_name, source_key
       ) values
         ($1, $3, 'driver-registration', 'S5 RSL driver', 'compatible:acme,power'),
         ($2, $3, 'driver-registration', 'S5 RSL driver b', 'compatible:acme,power-b')`,
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
    ingest = createEvidenceIngest(pool);
    reader = createReviewQueueReader(pool);
    resolver = createReviewItemResolver(pool);
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    await database?.drop();
  });

  it("commits one ReviewResolution and one Registration/Placement through the guarded writer", async () => {
    const item = await openReviewItem(`success-${randomUUID()}`);
    const result = await resolver.resolve(resolveCommand(item));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.outcome).toBe("committed");
    expect(result.value.resolutionType).toBe("register-subject");
    expect(result.value.status).toBe("resolved");
    expect(result.value.registrationId).toBeDefined();
    expect(result.value.placementId).toBeDefined();
    expect(result.value.subjectId).toBe(SUBJECT_ID);
    expect(result.value.release).toEqual(pin);
    expect(result.value.etag).not.toBe(item.etag);
    expect(result.value.successAuditRef).toMatch(/^aud_/);

    const stored = await pool.query<{
      resolutions: string;
      registrations: string;
      placements: string;
      status: string;
    }>(
      `
      select
        (select count(*)::text
           from parameter_catalog.parameter_review_resolutions
          where review_item_id = $1) as resolutions,
        (select count(*)::text
           from parameter_catalog.organization_subject_registrations
          where organization_id = $2 and subject_id = $3) as registrations,
        (select count(*)::text
           from parameter_catalog.subject_placements
          where organization_id = $2) as placements,
        (select status from parameter_catalog.parameter_review_items where id = $1) as status
      `,
      [item.id, ORG_ID, SUBJECT_ID],
    );
    expect(stored.rows[0]).toEqual({
      resolutions: "1",
      registrations: "1",
      placements: "1",
      status: "resolved",
    });
  });

  it("refuses a stale ReviewItem ETag and leaves zero mutation residue", async () => {
    const item = await openReviewItem(`stale-etag-${randomUUID()}`);
    const before = await residue();
    const result = await resolver.resolve(
      resolveCommand(item, { etag: item.etag.replace(/[0-9a-f]/, "0") as typeof item.etag }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("revision-conflict");
    expect(await residue()).toEqual(before);
    const status = await pool.query<{ status: string }>(
      `select status from parameter_catalog.parameter_review_items where id = $1`,
      [item.id],
    );
    expect(status.rows[0]?.status).toBe("open");
    const refusals = await pool.query<{ count: string }>(
      `select count(*)::text as count
         from public.audit_events
        where organization_id = $1 and action = 'review-resolution-refused'`,
      [ORG_ID],
    );
    expect(Number(refusals.rows[0]?.count)).toBeGreaterThan(0);
  });

  it("replays a lost response to the exact stored result without a second Resolution", async () => {
    const item = await openReviewItem(`replay-${randomUUID()}`);
    const command = resolveCommand(item);
    const first = await resolver.resolve(command);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const before = await residue();
    const second = await resolver.resolve(command);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value).toEqual({
      ...first.value,
      outcome: "replayed",
    });
    expect(await residue()).toEqual(before);
  });

  it("conflicts when the same idempotency key is reused with a different fingerprint", async () => {
    const item = await openReviewItem(`fp-${randomUUID()}`);
    const key = `conflict:${randomUUID()}`;
    const first = await resolver.resolve(resolveCommand(item, { idempotencyKey: key }));
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const before = await residue();
    const second = await resolver.resolve(
      resolveCommand(item, {
        idempotencyKey: key,
        proof: { reason: "tampered-proof" },
      }),
    );
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error.kind).toBe("revision-conflict");
    expect(await residue()).toEqual(before);
  });

  it("rolls back a writer failure and leaves the ReviewItem open", async () => {
    const item = await openReviewItem(`rollback-${randomUUID()}`);
    const before = await residue();
    const result = await resolver.resolve(
      resolveCommand(item, { destinationModuleId: "pmod-missing-destination" }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("invalid-placement-parent");
    expect(await residue()).toEqual(before);
    const status = await pool.query<{ status: string }>(
      `select status from parameter_catalog.parameter_review_items where id = $1`,
      [item.id],
    );
    expect(status.rows[0]?.status).toBe("open");
  });

  it("maps a stale pin to PCA01 and writes no Resolution residue", async () => {
    const item = await openReviewItem(`stale-pin-${randomUUID()}`);
    const before = await residue();
    const successor = compileOrThrow(validCatalogReleaseBundle());
    const advanced = await installPublishedRelease(pool, {
      mode: "advance",
      source: jsonCatalogReleaseSource(validCatalogReleaseBundle()),
      expectedCurrent: pin,
      expectedTargetDigest: successor.aggregateDigest,
    });
    expect(advanced.ok).toBe(true);

    const result = await resolver.resolve(resolveCommand(item));
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

    const item = await openReviewItem(`retired-${randomUUID()}`);
    const before = await residue();
    const result = await resolver.resolve(resolveCommand(item));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatchObject({
      kind: "subject-retired",
      sqlstate: "PCA03",
      code: "PCAT-GUARD-SUBJECT-RETIRED",
      subjectId: SUBJECT_ID,
    });
    expect(await residue()).toEqual(before);
    const status = await pool.query<{ status: string }>(
      `select status from parameter_catalog.parameter_review_items where id = $1`,
      [item.id],
    );
    expect(status.rows[0]?.status).toBe("open");
  });
});
