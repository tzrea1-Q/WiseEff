import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { CatalogReleaseId, type ContractJsonValue } from "../../parameter-catalog-contract/index";
import { seedCompiledCatalogProjection } from "../../catalog-kernel/runtime/currentSnapshot";
import {
  createEphemeralTestDatabase,
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type EphemeralTestDatabase,
} from "../../../testing/testDatabase";

import { createEvidenceIngest, fingerprintCanonical } from "./index";
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
const CONFIG_SET_ID = "config-set-s4-evd";
const FILE_ID = "file-s4-evd";
const FILE_VERSION_ID = "version-s4-evd";
const NODE_OCCURRENCE_ID = "node-occurrence-s4-evd";
const PROPERTY_OCCURRENCE_ID = "property-occurrence-s4-evd";
const SOURCE_OCCURRENCE_ID = "src-occ-s4-evd";
const MATCHER_REVISION = "matcher-s4-evd-1";
let testPropertyOccurrenceId = PROPERTY_OCCURRENCE_ID;
let testPropertyName = "iin_max";

const provenance = (): SourceProvenance => ({
  projectId: PROJECT_ID,
  logicalNodeId: LOGICAL_NODE_ID,
  configRevisionId: CONFIG_REVISION_ID,
  sourceOccurrenceId: SOURCE_OCCURRENCE_ID,
  sourceLocator: {
    kind: "dts-property",
    propertyOccurrenceId: testPropertyOccurrenceId,
    nodeOccurrenceId: NODE_OCCURRENCE_ID,
    fileVersionId: FILE_VERSION_ID,
    propertyName: testPropertyName,
  },
});

describe("immutable observation and review-evidence ingest", () => {
  let database: EphemeralTestDatabase;
  let pool: pg.Pool;
  let writerPool: pg.Pool;
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
    await pool.query(
      `insert into public.dts_config_set (id, organization_id, project_id, name)
       values ($1, $2, $3, 'source')`,
      [CONFIG_SET_ID, ORG_ID, PROJECT_ID],
    );
    await pool.query(
      `insert into public.project_parameter_files (
         id, organization_id, project_id, file_name, format, config_set_id, config_set_role
       ) values ($1, $2, $3, 'source.dts', 'dts', $4, 'base')`,
      [FILE_ID, ORG_ID, PROJECT_ID, CONFIG_SET_ID],
    );
    await pool.query(
      `insert into public.project_parameter_file_versions (
         id, file_id, version_number, storage_key, checksum, size_bytes, origin
       ) values ($1, $2, 1, 's4-evd-source', 'checksum-s4-evd', 1, 'upload')`,
      [FILE_VERSION_ID, FILE_ID],
    );
    await pool.query(
      `update public.project_parameter_files
          set current_version_id = $1
        where id = $2`,
      [FILE_VERSION_ID, FILE_ID],
    );
    await pool.query(
      `insert into public.dts_config_revisions (
         id, organization_id, project_id, config_set_id, revision_number, status
       ) values ($1, $2, $3, $4, 1, 'resolved')`,
      [CONFIG_REVISION_ID, ORG_ID, PROJECT_ID, CONFIG_SET_ID],
    );
    await pool.query(
      `insert into public.dts_config_revision_members (
         id, config_revision_id, file_id, file_version_id, role, sort_order
       ) values ('member-s4-evd', $1, $2, $3, 'base', 0)`,
      [CONFIG_REVISION_ID, FILE_ID, FILE_VERSION_ID],
    );
    await pool.query(
      `insert into public.dts_logical_nodes (id, organization_id, project_id, config_set_id)
       values ($1, $2, $3, $4)`,
      [LOGICAL_NODE_ID, ORG_ID, PROJECT_ID, CONFIG_SET_ID],
    );
    await pool.query(
      `insert into public.dts_logical_node_revisions (
         id, logical_node_id, config_revision_id, node_locator, name
       ) values ('logical-revision-s4-evd', $1, $2, '/soc/charger', 'charger')`,
      [LOGICAL_NODE_ID, CONFIG_REVISION_ID],
    );
    await pool.query(
      `insert into public.dts_node_occurrences (
         id, config_revision_id, file_version_id, name, node_path,
         start_offset, end_offset, start_line, start_column, end_line, end_column, raw_text
       ) values ($1, $2, $3, 'charger', '/soc/charger', 0, 10, 1, 1, 1, 11, 'charger {}')`,
      [NODE_OCCURRENCE_ID, CONFIG_REVISION_ID, FILE_VERSION_ID],
    );
    await pool.query(
      `insert into public.dts_property_occurrences (
         id, config_revision_id, node_occurrence_id, file_version_id, property_name,
         start_offset, end_offset, start_line, start_column, end_line, end_column, raw_text
       ) values ($1, $2, $3, $4, 'iin_max', 1, 8, 1, 2, 1, 9, 'iin_max = 1')`,
      [PROPERTY_OCCURRENCE_ID, CONFIG_REVISION_ID, NODE_OCCURRENCE_ID, FILE_VERSION_ID],
    );
    await pool.query(
      `insert into public.dts_occurrence_effects (
         id, config_revision_id, logical_node_revision_id, property_name, effect_kind,
         node_occurrence_id, property_occurrence_id, source_order
       ) values ('effect-s4-evd', $1, 'logical-revision-s4-evd', 'iin_max', 'set', $2, $3, 0)`,
      [CONFIG_REVISION_ID, NODE_OCCURRENCE_ID, PROPERTY_OCCURRENCE_ID],
    );
    await pool.query(
      `insert into parameter_catalog.project_parameter_source_occurrences (
         id, organization_id, project_id, config_set_id, file_id, occurrence_kind, logical_node_id
       ) values ($1, $2, $3, $4, $5, 'dts', $6)`,
      [SOURCE_OCCURRENCE_ID, ORG_ID, PROJECT_ID, CONFIG_SET_ID, FILE_ID, LOGICAL_NODE_ID],
    );
    writerPool = new pg.Pool({
      connectionString: database.url,
      max: 1,
      options: "-c role=parameter_governance_writer_role",
    });
    ingest = createEvidenceIngest(writerPool);
  }, 60_000);

  beforeEach(async () => {
    const serial = await count(
      `select count(*)::text as count
         from public.dts_property_occurrences
        where config_revision_id = $1`,
      [CONFIG_REVISION_ID],
    );
    testPropertyOccurrenceId = `property-occurrence-s4-evd-${serial + 1}`;
    testPropertyName = `iin_max_${serial + 1}`;
    await pool.query(
      `insert into public.dts_property_occurrences (
         id, config_revision_id, node_occurrence_id, file_version_id, property_name,
         start_offset, end_offset, start_line, start_column, end_line, end_column, raw_text
       ) values ($1, $2, $3, $4, $5, 1, 8, 1, 2, 1, 9, $5)`,
      [
        testPropertyOccurrenceId,
        CONFIG_REVISION_ID,
        NODE_OCCURRENCE_ID,
        FILE_VERSION_ID,
        testPropertyName,
      ],
    );
    await pool.query(
      `insert into public.dts_occurrence_effects (
         id, config_revision_id, logical_node_revision_id, property_name, effect_kind,
         node_occurrence_id, property_occurrence_id, source_order
       ) values ($1, $2, 'logical-revision-s4-evd', $3, 'set', $4, $5, 0)`,
      [
        `effect-s4-evd-${serial + 1}`,
        CONFIG_REVISION_ID,
        testPropertyName,
        NODE_OCCURRENCE_ID,
        testPropertyOccurrenceId,
      ],
    );
  });

  afterAll(async () => {
    await writerPool?.end();
    await pool?.end();
    await database?.drop();
  });

  it("lets the governance writer append through the owner trigger without source reads", async () => {
    const who = await writerPool.query<{ current_user: string }>(
      "select current_user",
    );
    expect(who.rows[0]?.current_user).toBe("parameter_governance_writer_role");
    const writerPrivileges = await writerPool.query<{ can_read: boolean }>(
      "select has_table_privilege(current_user, 'parameter_catalog.parameter_observations', 'select') as can_read",
    );
    expect(writerPrivileges.rows[0]?.can_read).toBe(true);
    await expect(
      writerPool.query(
        `select id
           from parameter_catalog.project_parameter_source_occurrences
          where id = $1`,
        [SOURCE_OCCURRENCE_ID],
      ),
    ).rejects.toMatchObject({ code: "42501" });

    const result = await ingest.ingest(
      command({ sourceIdentity: `acl-positive:${randomUUID()}` }),
    );
    expect(result.ok).toBe(true);
  });

  it("rejects a mismatched locator at the deferred owner trigger", async () => {
    const result = await ingest.ingest(
      command({
        sourceIdentity: `acl-mismatch:${randomUUID()}`,
        provenance: {
          ...provenance(),
          sourceLocator: {
            ...provenance().sourceLocator,
            propertyName: "property-not-in-the-captured-revision",
          },
        },
      }),
    );
    expect(result).toEqual({
      ok: false,
      error: {
        kind: "source-provenance-mismatch",
        sourceOccurrenceId: SOURCE_OCCURRENCE_ID,
        reason: "occurrence, revision member, or exact parameter locator is not owned by the project",
      },
    });
  });

  it("does not coerce numeric locator values to strings for the governance writer", async () => {
    await pool.query("update dts_property_occurrences set property_name='123' where id=$1",[testPropertyOccurrenceId]);
    await pool.query("update dts_occurrence_effects set property_name='123' where property_occurrence_id=$1",[testPropertyOccurrenceId]);
    const locator = { ...provenance().sourceLocator,propertyName: 123 };
    const client = await writerPool.connect();
    try {
      await client.query("begin");
      await client.query(`insert into parameter_catalog.parameter_observations
        (id,organization_id,project_id,logical_node_id,config_revision_id,source_identity,source_locator,
          catalog_release_id,matcher_revision,evidence_fingerprint,source_occurrence_id,parameter_locator_digest)
        values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12)`,
      [`pobs-numeric-${randomUUID()}`,ORG_ID,PROJECT_ID,LOGICAL_NODE_ID,CONFIG_REVISION_ID,
        `numeric:${randomUUID()}`,JSON.stringify(locator),catalogReleaseId,MATCHER_REVISION,
        "numeric-probe",SOURCE_OCCURRENCE_ID,fingerprintCanonical(locator as ContractJsonValue)]);
      await expect(client.query("set constraints all immediate")).rejects.toMatchObject({ code: "23503" });
    } finally { await client.query("rollback"); client.release(); }
  });

  it("keeps separator-containing exact replay tuples distinct", async () => {
    const successor = CatalogReleaseId(`${catalogReleaseId}|tuple`);
    await pool.query(`insert into parameter_catalog.catalog_releases
      (id,release_sequence,release_version,release_digest,compiled_model_digest,toolchain_digest,published_at)
      select $1,(select max(release_sequence)+1 from parameter_catalog.catalog_releases),$1,
        $2,compiled_model_digest,toolchain_digest,published_at
      from parameter_catalog.catalog_releases where id=$3`,
    [successor,`sha256:${"a".repeat(64)}`,catalogReleaseId]);
    const first = command({ matcherRevision: "tuple|matcher" });
    const second = command({ catalogReleaseId: successor,matcherRevision: "matcher" });
    expect([first.catalogReleaseId,first.matcherRevision].join("|"))
      .toBe([second.catalogReleaseId,second.matcherRevision].join("|"));
    const a = await ingest.ingest(first);
    const b = await ingest.ingest(second);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.value.id).not.toBe(b.value.id);
    expect(await ingest.ingest(first)).toMatchObject({ ok: true,value: { id: a.value.id,status: "replayed" } });
    expect(await ingest.ingest(second)).toMatchObject({ ok: true,value: { id: b.value.id,status: "replayed" } });
  });

  it("rejects a writer-supplied digest that is not canonical for the owned locator", async () => {
    const sourceIdentity = `pseudo-digest:${randomUUID()}`;
    const locator = provenance().sourceLocator;
    await writerPool.query("begin");
    try {
      await writerPool.query(
        `insert into parameter_catalog.parameter_observations (
           id, organization_id, project_id, logical_node_id, config_revision_id,
           source_identity, source_locator, catalog_release_id, matcher_revision,
           evidence_fingerprint, source_occurrence_id, parameter_locator_digest
         ) values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12)`,
        [
          `pseudo-digest-observation-${randomUUID()}`,
          ORG_ID,
          PROJECT_ID,
          LOGICAL_NODE_ID,
          CONFIG_REVISION_ID,
          sourceIdentity,
          JSON.stringify(locator),
          catalogReleaseId,
          MATCHER_REVISION,
          `sha256:${"0".repeat(64)}`,
          SOURCE_OCCURRENCE_ID,
          `sha256:${"f".repeat(64)}`,
        ],
      );
      await expect(writerPool.query("commit")).rejects.toMatchObject({
        code: "23503",
        constraint: "parameter_observation_source_owner_fk",
      });
    } finally {
      await writerPool.query("rollback").catch(() => undefined);
    }
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
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const reconnectPool = new pg.Pool({
      connectionString: database.url,
      max: 1,
      options: "-c role=parameter_governance_writer_role",
    });
    try {
      const reconnectIngest = createEvidenceIngest(reconnectPool);
      const second = await reconnectIngest.ingest(input);
      expect(second.ok).toBe(true);
      if (!second.ok) return;
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
      expect(
        await count(
          `select count(*)::text as count
           from parameter_catalog.parameter_observation_matches
           where observation_id = $1`,
          [first.value.id],
        ),
      ).toBe(0);
      expect(
        await count(
          `select count(*)::text as count
           from parameter_catalog.parameter_review_evidence
           where organization_id = $1
             and evidence->>'sourceIdentity' = $2`,
          [ORG_ID, input.sourceIdentity],
        ),
      ).toBe(0);
    } finally {
      await reconnectPool.end();
    }
  });

  it("conflicts when the same exact source locator arrives with a different identity digest", async () => {
    const sourceIdentity = `conflict:${randomUUID()}`;
    const originalLocator = provenance().sourceLocator;
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
        sourceIdentity: `${sourceIdentity}:tampered`,
        provenance: { ...provenance(), sourceLocator: originalLocator },
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
      source_identity: string;
    }>(
      `select id, r_class, evidence->>'sourceIdentity' as source_identity
       from parameter_catalog.parameter_review_evidence
       where organization_id = $1
         and evidence->>'sourceIdentity' in ($2, $3)
       order by r_class`,
      [ORG_ID, r6Identity, r8Identity],
    );
    expect(rows.rows).toEqual([
      { id: r6.value.id, r_class: "R6", source_identity: r6Identity },
      { id: r8.value.id, r_class: "R8", source_identity: r8Identity },
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
         where organization_id = $1 and evidence->>'sourceIdentity' = $2`,
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
         where organization_id = $1 and evidence->>'sourceIdentity' = $2`,
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

  it("replays exact review-evidence fingerprint to the same id without a second row", async () => {
    const input = command({
      sourceIdentity: `review-replay:${randomUUID()}`,
      matcherOutput: { status: "unknown" },
      evidence: { note: "stable-review" },
    });
    const first = await ingest.ingest(input);
    const second = await ingest.ingest(input);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.value.kind).toBe("review-evidence");
    expect(second.value).toEqual({
      ...first.value,
      status: "replayed",
    });
    expect(
      await count(
        `select count(*)::text as count
         from parameter_catalog.parameter_review_evidence
         where organization_id = $1 and evidence->>'sourceIdentity' = $2`,
        [ORG_ID, input.sourceIdentity],
      ),
    ).toBe(1);
    expect(
      await count(
        `select count(*)::text as count
         from parameter_catalog.parameter_observations
         where organization_id = $1 and source_identity = $2`,
        [ORG_ID, input.sourceIdentity],
      ),
    ).toBe(0);
  });

  it("keeps a weak review record separate from a matched observation even when source_identity repeats", async () => {
    const sourceIdentity = `matched-then-weak:${randomUUID()}`;
    const first = await ingest.ingest(command({ sourceIdentity }));
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.kind).toBe("observation");

    const second = await ingest.ingest(
      command({
        sourceIdentity,
        matcherOutput: { status: "unknown" },
      }),
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.kind).toBe("review-evidence");
    expect(
      await count(
        `select count(*)::text as count
         from parameter_catalog.parameter_observations
         where organization_id = $1 and source_identity = $2`,
        [ORG_ID, sourceIdentity],
      ),
    ).toBe(1);
    expect(
      await count(
        `select count(*)::text as count
         from parameter_catalog.parameter_review_evidence
         where organization_id = $1 and evidence->>'sourceIdentity' = $2`,
        [ORG_ID, sourceIdentity],
      ),
    ).toBe(1);
  });

  it("conflicts when review evidence is followed by a matched ingest for the same source_identity", async () => {
    const sourceIdentity = `weak-then-matched:${randomUUID()}`;
    const first = await ingest.ingest(
      command({
        sourceIdentity,
        matcherOutput: { status: "ambiguous" },
      }),
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.kind).toBe("review-evidence");

    const second = await ingest.ingest(command({ sourceIdentity }));
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error.kind).toBe("evidence-overwrite-refused");
    if (second.error.kind === "evidence-overwrite-refused") {
      expect(second.error.storedId).toBe(first.value.id);
    }
    expect(
      await count(
        `select count(*)::text as count
         from parameter_catalog.parameter_review_evidence
         where organization_id = $1 and evidence->>'sourceIdentity' = $2`,
        [ORG_ID, sourceIdentity],
      ),
    ).toBe(1);
    expect(
      await count(
        `select count(*)::text as count
         from parameter_catalog.parameter_observations
         where organization_id = $1 and source_identity = $2`,
        [ORG_ID, sourceIdentity],
      ),
    ).toBe(0);
  });

  it("keeps distinct source identities separate even when source_graph_ref collides", async () => {
    const sharedGraph = `graph:${randomUUID()}`;
    const firstIdentity = `graph-a:${randomUUID()}`;
    const secondIdentity = `graph-b:${randomUUID()}`;
    const first = await ingest.ingest(
      command({
        sourceIdentity: firstIdentity,
        matcherOutput: { status: "unknown" },
        classification: { rClass: "R6", sourceGraphRef: sharedGraph },
        evidence: { propertyKey: "synthetic.legacy-twin" },
        provenance: null,
      }),
    );
    const second = await ingest.ingest(
      command({
        sourceIdentity: secondIdentity,
        matcherOutput: { status: "unknown" },
        classification: { rClass: "R6", sourceGraphRef: sharedGraph },
        evidence: { propertyKey: "synthetic.legacy-twin" },
        provenance: null,
      }),
    );
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.value.id).not.toBe(second.value.id);

    const replay = await ingest.ingest(
      command({
        sourceIdentity: firstIdentity,
        matcherOutput: { status: "unknown" },
        classification: { rClass: "R6", sourceGraphRef: sharedGraph },
        evidence: { propertyKey: "synthetic.legacy-twin" },
        provenance: null,
      }),
    );
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    expect(replay.value).toEqual({
      ...first.value,
      status: "replayed",
    });

    const rows = await pool.query<{ id: string; source_identity: string }>(
      `select id, evidence->>'sourceIdentity' as source_identity
       from parameter_catalog.parameter_review_evidence
       where organization_id = $1
         and source_graph_ref = $2
       order by evidence->>'sourceIdentity'`,
      [ORG_ID, sharedGraph],
    );
    expect(rows.rows).toHaveLength(2);
    expect(new Set(rows.rows.map((row) => row.source_identity))).toEqual(
      new Set([firstIdentity, secondIdentity]),
    );
  });
});
