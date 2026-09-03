import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { compileCatalogRelease } from "../../catalog-kernel/compiler/index";
import { validCatalogReleaseBundle } from "../../catalog-kernel/compiler/__fixtures__/catalogReleaseBundle";
import type { CatalogReleaseBundle } from "../../catalog-kernel/compiler/types";
import { jsonCatalogReleaseSource } from "../../catalog-kernel/interface";
import { installPublishedRelease } from "../../catalog-kernel/install/installer";
import { type CatalogReleasePin } from "../../parameter-catalog-contract/index";
import { createEvidenceIngest } from "../evidence/index";
import type { IngestEvidenceCommand } from "../evidence/types";
import {
  createEphemeralTestDatabase,
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type EphemeralTestDatabase,
} from "../../../testing/testDatabase";

import { createReviewQueueReader } from "./index";
import type { ReviewQueueTrustedContext } from "./types";

const databaseAvailable = await isTestDatabaseAvailable();
if (!databaseAvailable) {
  throw new Error(
    "S4-REV requires a reachable real PostgreSQL server with pgvector; skipping is forbidden",
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
    "S4-REV requires pgvector installed in the real PostgreSQL test database; skipping is forbidden",
  );
}

const ORG_A = "org-s4-rev-a";
const ORG_B = "org-s4-rev-b";
const MATCHER_REVISION = "matcher-s4-rev-1";
const RAW_SECRET = "raw-review-payload-secret";
const PROJECT_ID = "project-s4-rev";

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

describe("authorized grouped Review Queue reads", () => {
  let database: EphemeralTestDatabase;
  let pool: pg.Pool;
  let pin: CatalogReleasePin;
  let ingest: ReturnType<typeof createEvidenceIngest>;
  let reader: ReturnType<typeof createReviewQueueReader>;

  const adminA: ReviewQueueTrustedContext = {
    actorKind: "org-admin",
    principalId: "user-org-admin-a",
    organizationId: ORG_A,
  };

  const reviewCommand = (
    overrides: Partial<IngestEvidenceCommand> = {},
  ): IngestEvidenceCommand => ({
    organizationId: ORG_A,
    sourceIdentity: `unknown:${randomUUID()}`,
    catalogReleaseId: pin.id,
    matcherRevision: MATCHER_REVISION,
    matcherOutput: { status: "unknown" },
    evidence: { propertyKey: "iin_max", note: RAW_SECRET },
    provenance: null,
    ...overrides,
  });

  const residue = async () => {
    const result = await pool.query<{
      resolutions: string;
      registrations: string;
      placements: string;
      releases: string;
      evidence: string;
      items: string;
    }>(`
      select
        (select count(*)::text from parameter_catalog.parameter_review_resolutions) as resolutions,
        (select count(*)::text from parameter_catalog.organization_subject_registrations) as registrations,
        (select count(*)::text from parameter_catalog.subject_placements) as placements,
        (select count(*)::text from parameter_catalog.catalog_releases) as releases,
        (select count(*)::text from parameter_catalog.parameter_review_evidence) as evidence,
        (select count(*)::text from parameter_catalog.parameter_review_items) as items
    `);
    return result.rows[0]!;
  };

  beforeAll(async () => {
    database = await createEphemeralTestDatabase("s4rev");
    pool = new pg.Pool({ connectionString: database.url, max: 4 });
    const firstBundle = firstReleaseBundle();
    const first = compileOrThrow(firstBundle);
    const installed = await installPublishedRelease(pool, {
      mode: "bootstrap",
      source: jsonCatalogReleaseSource(firstBundle),
      expectedTargetDigest: first.aggregateDigest,
    });
    expect(installed.ok).toBe(true);
    pin = { id: first.release.id, digest: first.release.digest };
    await pool.query(`insert into public.organizations (id, name) values ($1, 'S4 REV A'), ($2, 'S4 REV B')`, [
      ORG_A,
      ORG_B,
    ]);
    await pool.query(
      `insert into public.projects (id, organization_id, name, code)
       values ($1, $2, 'S4 REV', 'S4REV')`,
      [PROJECT_ID, ORG_A],
    );
    ingest = createEvidenceIngest(pool);
    reader = createReviewQueueReader(pool);
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    await database?.drop();
  });

  it("groups two same-key unknown evidence rows into one authorized open item", async () => {
    const first = await ingest.ingest(
      reviewCommand({ sourceIdentity: `group-a:${randomUUID()}` }),
    );
    const second = await ingest.ingest(
      reviewCommand({ sourceIdentity: `group-b:${randomUUID()}` }),
    );
    expect(first.ok && second.ok).toBe(true);

    const listed = await reader.list({
      organizationId: ORG_A,
      capturedRelease: pin,
      context: adminA,
    });
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    const iinMax = listed.value.items.filter((item) => item.identityKey === "property:iin_max");
    expect(iinMax).toHaveLength(1);
    expect(iinMax[0]?.status).toBe("open");
    expect(iinMax[0]?.evidenceCount).toBeGreaterThanOrEqual(2);
    expect(iinMax[0]?.candidateState.status).toBe("current");
    expect(JSON.stringify(listed.value)).not.toContain(RAW_SECRET);
  });

  it("returns permission-denied for an unauthorized caller and never another org's items", async () => {
    const foreign = await ingest.ingest(
      reviewCommand({
        organizationId: ORG_B,
        sourceIdentity: `foreign:${randomUUID()}`,
        evidence: { propertyKey: "foreign_key", note: RAW_SECRET },
      }),
    );
    expect(foreign.ok).toBe(true);

    const agent = await reader.list({
      organizationId: ORG_A,
      capturedRelease: pin,
      context: { actorKind: "agent", principalId: "agent-1" },
    });
    expect(agent.ok).toBe(false);
    if (agent.ok) return;
    expect(agent.error.kind).toBe("permission-denied");
    expect(JSON.stringify(agent.error)).not.toContain(RAW_SECRET);
    expect(JSON.stringify(agent.error)).not.toContain("property:iin_max");

    const cross = await reader.list({
      organizationId: ORG_A,
      capturedRelease: pin,
      context: {
        actorKind: "org-admin",
        principalId: "user-org-admin-b",
        organizationId: ORG_B,
      },
    });
    expect(cross.ok).toBe(false);
    if (cross.ok) return;
    expect(cross.error.kind).toBe("permission-denied");
    expect(JSON.stringify(cross.error)).not.toContain("property:iin_max");
  });

  it("fails closed with stale-candidate when the captured pin is not current", async () => {
    const before = await residue();
    const successorBundle = validCatalogReleaseBundle();
    const successor = compileOrThrow(successorBundle);
    const advanced = await installPublishedRelease(pool, {
      mode: "advance",
      source: jsonCatalogReleaseSource(successorBundle),
      expectedCurrent: pin,
      expectedTargetDigest: successor.aggregateDigest,
    });
    expect(advanced.ok).toBe(true);

    const stale = await reader.list({
      organizationId: ORG_A,
      capturedRelease: pin,
      context: adminA,
    });
    expect(stale.ok).toBe(false);
    if (stale.ok) return;
    expect(stale.error.kind).toBe("stale-candidate");
    expect(JSON.stringify(stale.error)).not.toContain(RAW_SECRET);

    const currentPin = { id: successor.release.id, digest: successor.release.digest };
    const current = await reader.list({
      organizationId: ORG_A,
      capturedRelease: currentPin,
      context: adminA,
    });
    expect(current.ok).toBe(true);
    if (!current.ok) return;
    expect(current.value.items.every((item) => item.catalogReleaseId === currentPin.id)).toBe(true);
    expect(JSON.stringify(current.value)).not.toContain(RAW_SECRET);

    const after = await residue();
    expect(after.resolutions).toBe(before.resolutions);
    expect(after.registrations).toBe(before.registrations);
    expect(after.placements).toBe(before.placements);
    expect(after.releases).toBe(String(Number(before.releases) + 1));
    pin = currentPin;
  });

  it("keeps the ReviewItem ETag stable across replay and changes it when grouped state changes", async () => {
    const propertyKey = `etag-${randomUUID()}`;
    const firstIngest = await ingest.ingest(
      reviewCommand({
        sourceIdentity: `etag-a:${randomUUID()}`,
        catalogReleaseId: pin.id,
        evidence: { propertyKey, note: RAW_SECRET },
      }),
    );
    expect(firstIngest.ok).toBe(true);

    const query = {
      organizationId: ORG_A,
      capturedRelease: pin,
      context: adminA,
    };
    const first = await reader.list(query);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const item = first.value.items.find((entry) => entry.identityKey === `property:${propertyKey}`);
    expect(item).toBeDefined();
    const replay = await reader.list(query);
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    const replayed = replay.value.items.find((entry) => entry.identityKey === `property:${propertyKey}`);
    expect(replayed?.id).toBe(item!.id);
    expect(replayed?.etag).toBe(item!.etag);

    const detail = await reader.get({
      ...query,
      reviewItemId: item!.id,
    });
    expect(detail.ok).toBe(true);
    if (!detail.ok) return;
    expect(detail.value.etag).toBe(item!.etag);
    expect(JSON.stringify(detail.value)).not.toContain(RAW_SECRET);

    const secondIngest = await ingest.ingest(
      reviewCommand({
        sourceIdentity: `etag-b:${randomUUID()}`,
        catalogReleaseId: pin.id,
        evidence: { propertyKey, note: RAW_SECRET },
      }),
    );
    expect(secondIngest.ok).toBe(true);
    const changed = await reader.list(query);
    expect(changed.ok).toBe(true);
    if (!changed.ok) return;
    const updated = changed.value.items.find((entry) => entry.identityKey === `property:${propertyKey}`);
    expect(updated?.id).toBe(item!.id);
    expect(updated?.etag).not.toBe(item!.etag);
    expect(updated?.evidenceCount).toBe((item?.evidenceCount ?? 0) + 1);
  });

  it("does not write Resolution, Registration, or Catalog rows from Review Queue reads", async () => {
    const before = await residue();
    const listed = await reader.list({
      organizationId: ORG_A,
      capturedRelease: pin,
      context: adminA,
    });
    expect(listed.ok).toBe(true);
    const after = await residue();
    expect(after.resolutions).toBe(before.resolutions);
    expect(after.registrations).toBe(before.registrations);
    expect(after.placements).toBe(before.placements);
    expect(after.releases).toBe(before.releases);
    expect(after.evidence).toBe(before.evidence);
  });

  it("does not create review work from a unique matched observation", async () => {
    const before = await reader.list({
      organizationId: ORG_A,
      capturedRelease: pin,
      context: adminA,
    });
    expect(before.ok).toBe(true);
    if (!before.ok) return;
    const matched = await ingest.ingest({
      organizationId: ORG_A,
      sourceIdentity: `matched:${randomUUID()}`,
      catalogReleaseId: pin.id,
      matcherRevision: MATCHER_REVISION,
      matcherOutput: { status: "matched" },
      provenance: {
        projectId: PROJECT_ID,
        logicalNodeId: "logical-s4-rev",
        configRevisionId: "config-s4-rev-1",
        sourceLocator: { path: "/soc/charger", property: "iin_max" },
      },
    });
    expect(matched.ok).toBe(true);
    if (matched.ok) {
      expect(matched.value.kind).toBe("observation");
    }
    const after = await reader.list({
      organizationId: ORG_A,
      capturedRelease: pin,
      context: adminA,
    });
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.value.items.map((item) => item.id).sort()).toEqual(
      before.value.items.map((item) => item.id).sort(),
    );
  });
});
