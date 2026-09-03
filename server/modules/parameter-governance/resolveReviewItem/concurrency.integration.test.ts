import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { compileCatalogRelease } from "../../catalog-kernel/compiler/index";
import { validCatalogReleaseBundle } from "../../catalog-kernel/compiler/__fixtures__/catalogReleaseBundle";
import type { CatalogReleaseBundle } from "../../catalog-kernel/compiler/types";
import { jsonCatalogReleaseSource } from "../../catalog-kernel/interface";
import { installPublishedRelease } from "../../catalog-kernel/install/installer";
import { acquireCurrentPointerLockExclusive } from "../../catalog-kernel/install/lockProtocol";
import { CatalogSubjectId, type CatalogReleasePin } from "../../parameter-catalog-contract/index";
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

import { resolveReviewItem } from "./index";
import type { RegisterSubjectResolutionCommand } from "./command";

const databaseAvailable = await isTestDatabaseAvailable();
if (!databaseAvailable) {
  throw new Error(
    "S5-RSL concurrency tests require a reachable real PostgreSQL server with pgvector; skipping is forbidden",
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
    "S5-RSL concurrency tests require pgvector installed in the real PostgreSQL test database; skipping is forbidden",
  );
}

const ORG_ID = "org-s5-rsl-cx";
const ATTR_ID = "attr-s5-rsl-cx";
const MODULE_ID = "pmod-s5-rsl-cx";
const SUBJECT_ID = CatalogSubjectId("csub_acme_power");
const MATCHER_REVISION = "matcher-s5-rsl-cx-1";

const firstReleaseBundle = (): CatalogReleaseBundle => {
  const full = validCatalogReleaseBundle();
  const first = structuredClone(full.releases[0]!);
  return {
    schemaVersion: full.schemaVersion,
    targetReleaseId: first.manifest.release.id,
    releases: [first],
  };
};

describe("independent-session resolveReviewItem races", () => {
  let database: EphemeralTestDatabase;
  let pool: pg.Pool;
  let pin: CatalogReleasePin;
  let ingest: ReturnType<typeof createEvidenceIngest>;
  let reader: ReturnType<typeof createReviewQueueReader>;

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

  const residue = async (client: pg.Client | pg.Pool = pool) => {
    const result = await client.query<{
      resolutions: string;
      registrations: string;
      placements: string;
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
          where organization_id = $1) as placements
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
    idempotencyKey: `cx:${randomUUID()}`,
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
    database = await createEphemeralTestDatabase("s5rslcx");
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
    await pool.query(`insert into public.organizations (id, name) values ($1, 'S5 RSL CX')`, [
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
    ingest = createEvidenceIngest(pool);
    reader = createReviewQueueReader(pool);
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    await database?.drop();
  });

  it("allows only one concurrent resolver to commit the ReviewItem", async () => {
    const item = await openReviewItem(`race-${randomUUID()}`);
    const poolA = new pg.Pool({ connectionString: database.url, max: 1 });
    const poolB = new pg.Pool({ connectionString: database.url, max: 1 });
    try {
      const [left, right] = await Promise.all([
        resolveReviewItem(poolA, resolveCommand(item)),
        resolveReviewItem(poolB, resolveCommand(item)),
      ]);
      const outcomes = [left, right];
      const wins = outcomes.filter((outcome) => outcome.ok);
      const losses = outcomes.filter((outcome) => !outcome.ok);
      expect(wins).toHaveLength(1);
      expect(losses).toHaveLength(1);
      if (!losses[0] || losses[0].ok) return;
      expect(losses[0].error.kind).toBe("revision-conflict");
      expect(await residue()).toEqual({
        resolutions: "1",
        registrations: "1",
        placements: "1",
      });
      const status = await pool.query<{ status: string }>(
        `select status from parameter_catalog.parameter_review_items where id = $1`,
        [item.id],
      );
      expect(status.rows[0]?.status).toBe("resolved");
    } finally {
      await poolA.end();
      await poolB.end();
    }
  });

  it("returns PCA05 when exclusive pointer lock is held and writes nothing", async () => {
    const item = await openReviewItem(`pca05-${randomUUID()}`);
    const before = await residue();
    const holder = new pg.Client({ connectionString: database.url });
    await holder.connect();
    try {
      await holder.query("begin");
      await acquireCurrentPointerLockExclusive(holder);
      const startedAt = Date.now();
      const result = await resolveReviewItem(pool, resolveCommand(item));
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
      expect(await residue(holder)).toEqual(before);
      await holder.query("rollback");
    } finally {
      await holder.query("rollback").catch(() => undefined);
      await holder.end();
    }
  });
});
