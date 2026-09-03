import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CatalogReleaseId } from "../../parameter-catalog-contract/index";
import { seedCompiledCatalogProjection } from "../../catalog-kernel/runtime/currentSnapshot";
import {
  createEphemeralTestDatabase,
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type EphemeralTestDatabase,
} from "../../../testing/testDatabase";

import { createEvidenceIngest } from "./index";
import type { IngestEvidenceCommand, SourceProvenance } from "./types";

const databaseAvailable = await isTestDatabaseAvailable();

if (!databaseAvailable) {
  throw new Error(
    "S4-EVD requires a reachable real PostgreSQL server with pgvector; skipping is forbidden",
  );
}

const pgVectorInstalled = await (async () => {
  const probe = await createInMemoryTestDatabase();
  try {
    const result = await probe.query<{ installed: boolean }>(
      `select exists (
         select 1
         from pg_catalog.pg_extension
         where extname = 'vector'
       ) as installed`,
    );
    return result.rows[0]?.installed === true;
  } finally {
    await probe.rollback();
  }
})();

if (!pgVectorInstalled) {
  throw new Error(
    "S4-EVD requires pgvector installed in the real PostgreSQL test database; skipping is forbidden",
  );
}

const ORG_ID = "org-s4-evd";
const PROJECT_ID = "project-s4-evd";
const LOGICAL_NODE_ID = "logical-s4-evd";
const CONFIG_REVISION_ID = "config-s4-evd-1";
const MATCHER_REVISION = "matcher-s4-evd-1";

const provenance = (): SourceProvenance => ({
  projectId: PROJECT_ID,
  logicalNodeId: LOGICAL_NODE_ID,
  configRevisionId: CONFIG_REVISION_ID,
  sourceLocator: {
    path: "/soc/charger",
    property: "iin_max",
  },
});

describe("immutable observation and review-evidence ingest", () => {
  let database: EphemeralTestDatabase;
  let pool: pg.Pool;
  let catalogReleaseId: CatalogReleaseId;
  let ingest: ReturnType<typeof createEvidenceIngest>;

  const command = (
    overrides: Partial<IngestEvidenceCommand> = {},
  ): IngestEvidenceCommand => ({
    organizationId: ORG_ID,
    sourceIdentity: `occurrence:${randomUUID()}`,
    catalogReleaseId,
    matcherRevision: MATCHER_REVISION,
    matcherOutput: { status: "matched" },
    provenance: provenance(),
    ...overrides,
  });

  const count = async (sql: string, values: unknown[] = []): Promise<number> => {
    const result = await pool.query<{ count: string }>(sql, values);
    return Number(result.rows[0]?.count ?? 0);
  };

  beforeAll(async () => {
    database = await createEphemeralTestDatabase("s4evd");
    const pins = await seedCompiledCatalogProjection(database.url);
    catalogReleaseId = pins.current.id;
    pool = new pg.Pool({ connectionString: database.url, max: 4 });
    await pool.query(
      `insert into public.organizations (id, name) values ($1, 'S4 EVD')`,
      [ORG_ID],
    );
    await pool.query(
      `insert into public.projects (id, organization_id, name, code)
       values ($1, $2, 'S4 EVD', 'S4EVD')`,
      [PROJECT_ID, ORG_ID],
    );
    ingest = createEvidenceIngest(pool);
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    await database?.drop();
  });

  it("ingests a unique matched observation without creating a Registration or match", async () => {
    const input = command();
    const result = await ingest.ingest(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      kind: "observation",
      status: "ingested",
      catalogReleaseId,
    });
    expect(result.value.fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);

    const stored = await pool.query<{
      id: string;
      evidence_fingerprint: string;
      source_locator: SourceProvenance["sourceLocator"];
    }>(
      `select id, evidence_fingerprint, source_locator
       from parameter_catalog.parameter_observations
       where organization_id = $1 and source_identity = $2`,
      [ORG_ID, input.sourceIdentity],
    );
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0]?.id).toBe(result.value.id);
    expect(stored.rows[0]?.evidence_fingerprint).toBe(result.value.fingerprint);
    expect(stored.rows[0]?.source_locator).toEqual(input.provenance?.sourceLocator);

    expect(
      await count(
        `select count(*)::text as count from parameter_catalog.parameter_observation_matches`,
      ),
    ).toBe(0);
    expect(
      await count(
        `select count(*)::text as count from parameter_catalog.organization_subject_registrations`,
      ),
    ).toBe(0);
  });

  it("replays the exact fingerprint to the same observation id without a second row", async () => {
    const input = command({ sourceIdentity: `replay:${randomUUID()}` });
    const first = await ingest.ingest(input);
    const second = await ingest.ingest(input);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.value).toEqual({
      ...first.value,
      status: "replayed",
    });
    expect(
      await count(
        `select count(*)::text as count
         from parameter_catalog.parameter_observations
         where organization_id = $1 and source_identity = $2`,
        [ORG_ID, input.sourceIdentity],
      ),
    ).toBe(1);
  });

  it("conflicts when the same source_identity arrives with a different fingerprint and leaves original bytes", async () => {
    const sourceIdentity = `conflict:${randomUUID()}`;
    const originalLocator = {
      path: "/soc/charger",
      property: "iin_max",
      note: "original",
    };
    const first = await ingest.ingest(
      command({
        sourceIdentity,
        provenance: { ...provenance(), sourceLocator: originalLocator },
      }),
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = await ingest.ingest(
      command({
        sourceIdentity,
        provenance: {
          ...provenance(),
          sourceLocator: {
            path: "/soc/charger",
            property: "iin_max",
            note: "tampered",
          },
        },
      }),
    );
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error.kind).toBe("fingerprint-conflict");
    if (second.error.kind === "fingerprint-conflict") {
      expect(second.error.storedId).toBe(first.value.id);
      expect(second.error.storedFingerprint).toBe(first.value.fingerprint);
      expect(second.error.attemptedFingerprint).not.toBe(first.value.fingerprint);
    }

    const stored = await pool.query<{
      id: string;
      evidence_fingerprint: string;
      source_locator: typeof originalLocator;
    }>(
      `select id, evidence_fingerprint, source_locator
       from parameter_catalog.parameter_observations
       where organization_id = $1 and source_identity = $2`,
      [ORG_ID, sourceIdentity],
    );
    expect(stored.rows).toEqual([
      {
        id: first.value.id,
        evidence_fingerprint: first.value.fingerprint,
        source_locator: originalLocator,
      },
    ]);
  });

  it.each(["unknown", "ambiguous"] as const)(
    "stores %s matcher output as ReviewEvidence and creates no Registration",
    async (status) => {
      const input = command({
        sourceIdentity: `weak:${status}:${randomUUID()}`,
        matcherOutput: { status },
      });
      const beforeRegistrations = await count(
        `select count(*)::text as count from parameter_catalog.organization_subject_registrations`,
      );
      const result = await ingest.ingest(input);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toMatchObject({
        kind: "review-evidence",
        status: "ingested",
        reason: status,
        rClass: null,
      });
      expect(
        await count(
          `select count(*)::text as count
           from parameter_catalog.parameter_observations
           where organization_id = $1 and source_identity = $2`,
          [ORG_ID, input.sourceIdentity],
        ),
      ).toBe(0);
      expect(
        await count(
          `select count(*)::text as count from parameter_catalog.organization_subject_registrations`,
        ),
      ).toBe(beforeRegistrations);
    },
  );

  it("keeps same-key R6 and R8 as two evidence records instead of one merged observation", async () => {
    const propertyKey = "synthetic.legacy-twin";
    const r6Identity = `wf671-platform-subjectless-draft:${randomUUID()}`;
    const r8Identity = `wf671-org-manual-node-draft:${randomUUID()}`;
    const r6 = await ingest.ingest(
      command({
        sourceIdentity: r6Identity,
        matcherOutput: { status: "unknown" },
        classification: { rClass: "R6" },
        evidence: { propertyKey, specId: r6Identity },
        provenance: null,
      }),
    );
    const r8 = await ingest.ingest(
      command({
        sourceIdentity: r8Identity,
        matcherOutput: { status: "unknown" },
        classification: { rClass: "R8" },
        evidence: { propertyKey, specId: r8Identity },
        provenance: null,
      }),
    );
    expect(r6.ok && r8.ok).toBe(true);
    if (!r6.ok || !r8.ok) return;
    expect(r6.value.kind).toBe("review-evidence");
    expect(r8.value.kind).toBe("review-evidence");
    expect(r6.value.id).not.toBe(r8.value.id);
    if (r6.value.kind === "review-evidence" && r8.value.kind === "review-evidence") {
      expect(r6.value.rClass).toBe("R6");
      expect(r8.value.rClass).toBe("R8");
    }

    const rows = await pool.query<{
      id: string;
      r_class: string | null;
      source_graph_ref: string | null;
    }>(
      `select id, r_class, source_graph_ref
       from parameter_catalog.parameter_review_evidence
       where organization_id = $1
         and source_graph_ref in ($2, $3)
       order by r_class`,
      [ORG_ID, r6Identity, r8Identity],
    );
    expect(rows.rows).toEqual([
      { id: r6.value.id, r_class: "R6", source_graph_ref: r6Identity },
      { id: r8.value.id, r_class: "R8", source_graph_ref: r8Identity },
    ]);
    expect(
      await count(
        `select count(*)::text as count
         from parameter_catalog.parameter_observations
         where organization_id = $1 and source_identity in ($2, $3, $4)`,
        [ORG_ID, r6Identity, r8Identity, propertyKey],
      ),
    ).toBe(0);
  });

  it("refuses an overwrite of stored jsonb review evidence and leaves original bytes", async () => {
    const sourceIdentity = `overwrite:${randomUUID()}`;
    const originalPayload = { note: "original-bytes", propertyKey: "iin_max" };
    const first = await ingest.ingest(
      command({
        sourceIdentity,
        matcherOutput: { status: "unknown" },
        evidence: originalPayload,
      }),
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = await ingest.ingest(
      command({
        sourceIdentity,
        matcherOutput: { status: "unknown" },
        evidence: { note: "tampered-bytes", propertyKey: "iin_max" },
      }),
    );
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error).toEqual({
      kind: "evidence-overwrite-refused",
      sourceIdentity,
      storedId: first.value.id,
    });

    const stored = await pool.query<{ evidence: { payload: typeof originalPayload } }>(
      `select evidence
       from parameter_catalog.parameter_review_evidence
       where id = $1`,
      [first.value.id],
    );
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0]?.evidence.payload).toEqual(originalPayload);
    expect(
      await count(
        `select count(*)::text as count
         from parameter_catalog.parameter_review_evidence
         where organization_id = $1 and source_graph_ref = $2`,
        [ORG_ID, sourceIdentity],
      ),
    ).toBe(1);
  });

  it("returns a typed failure when source provenance is missing and writes no rows", async () => {
    const sourceIdentity = `missing:${randomUUID()}`;
    const result = await ingest.ingest(
      command({
        sourceIdentity,
        provenance: null,
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      kind: "missing-source-provenance",
      missing: ["provenance"],
    });

    expect(
      await count(
        `select count(*)::text as count
         from parameter_catalog.parameter_observations
         where organization_id = $1 and source_identity = $2`,
        [ORG_ID, sourceIdentity],
      ),
    ).toBe(0);
    expect(
      await count(
        `select count(*)::text as count
         from parameter_catalog.parameter_review_evidence
         where organization_id = $1 and source_graph_ref = $2`,
        [ORG_ID, sourceIdentity],
      ),
    ).toBe(0);
  });

  it("requires the captured catalog_release_id to exist and does not invent Catalog rows", async () => {
    const missingRelease = CatalogReleaseId("crel_s4_evd_missing");
    const input = command({
      sourceIdentity: `missing-release:${randomUUID()}`,
      catalogReleaseId: missingRelease,
    });
    const beforeReleases = await count(
      `select count(*)::text as count from parameter_catalog.catalog_releases`,
    );
    const result = await ingest.ingest(input);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      kind: "catalog-release-not-found",
      catalogReleaseId: missingRelease,
    });
    expect(
      await count(
        `select count(*)::text as count
         from parameter_catalog.parameter_observations
         where organization_id = $1 and source_identity = $2`,
        [ORG_ID, input.sourceIdentity],
      ),
    ).toBe(0);
    expect(
      await count(
        `select count(*)::text as count from parameter_catalog.catalog_releases`,
      ),
    ).toBe(beforeReleases);
  });
});
