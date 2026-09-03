import { randomUUID } from "node:crypto";
import pg from "pg";

import { R_CLASSES, type RClass } from "../classifier";
import {
  MAPPING_TARGET_KINDS,
  type MappingFailure,
  type MappingFailureCode,
  type MappingHead,
  type MappingOutcome,
  type MappingQueryable,
  type MappingResult,
  type MappingTargetKind,
  type MappingVersion,
} from "./types";

type IdentityRow = {
  id: string;
  source_kind: string;
  source_id: string;
  owner_scope_kind: string;
  owner_scope_id: string;
};

type HeadJoinRow = {
  legacy_identity_id: string;
  current_version_id: string;
  cas_version: string;
  id: string;
  cutover_run_id: string;
  version_number: string;
  source_checksum: string;
  graph_fingerprint: string;
  r_class: string;
  target_kind: string | null;
  target_id: string | null;
  archive_id: string | null;
  evidence_archive_id: string | null;
  supersedes_version_id: string | null;
};

export const fail = <T>(code: MappingFailureCode, detail: string): MappingResult<T> => ({
  ok: false,
  error: { code, detail } satisfies MappingFailure,
});

export const ok = <T>(value: T): MappingResult<T> => ({ ok: true, value });

const isTargetKind = (value: string): value is MappingTargetKind =>
  (MAPPING_TARGET_KINDS as readonly string[]).includes(value);

const isRClass = (value: string): value is RClass =>
  (R_CLASSES as readonly string[]).includes(value);

export const mintMappingVersionId = (): string => `lmap_${randomUUID()}`;

export const mapDatabaseError = <T>(error: unknown): MappingResult<T> => {
  if (error instanceof pg.DatabaseError) {
    if (error.code === "23505") {
      return fail("PCAT-MAP-CONFLICT", error.constraint ?? "unique constraint");
    }
    if (error.constraint === "legacy_mapping_target_fk") {
      return fail("PCAT-MAP-TARGET-MISSING", error.message);
    }
    if (
      error.constraint === "legacy_mapping_source_target_ck" ||
      error.constraint === "legacy_mapping_target_owner_fk"
    ) {
      return fail("PCAT-MAP-TARGET-INCOMPATIBLE", error.message);
    }
    return fail("PCAT-MAP-WRITE-FAILED", error.message);
  }
  throw error;
};

export const withMappingTransaction = async <T>(
  client: MappingQueryable,
  body: () => Promise<MappingResult<T>>,
): Promise<MappingResult<T>> => {
  const state = await client.query<{ in_txn: boolean }>(
    "select pg_catalog.pg_current_xact_id_if_assigned() is not null as in_txn",
  );
  const owns = state.rows[0]?.in_txn !== true;
  if (owns) {
    await client.query("begin");
  }
  try {
    const result = await body();
    if (!result.ok) {
      if (owns) await client.query("rollback");
      return result;
    }
    if (owns) await client.query("commit");
    return result;
  } catch (error) {
    if (owns) await client.query("rollback").catch(() => undefined);
    return mapDatabaseError(error);
  }
};

export const lockMappingIdentity = async (
  client: MappingQueryable,
  identityId: string,
): Promise<void> => {
  await client.query(
    "select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('pcat-map:' || $1, 0))",
    [identityId],
  );
};

export const loadStoredIdentity = async (
  client: MappingQueryable,
  identityId: string,
  forUpdate: boolean,
): Promise<IdentityRow | null> => {
  const result = await client.query<IdentityRow>(
    `
    select id, source_kind, source_id, owner_scope_kind, owner_scope_id
    from parameter_catalog.legacy_identities
    where id = $1
    ${forUpdate ? "for update" : ""}
    `,
    [identityId],
  );
  return result.rows[0] ?? null;
};

export const loadIdentityIdBySourceTuple = async (
  client: MappingQueryable,
  input: {
    sourceSystem: string;
    sourceKind: string;
    ownerScopeKind: string;
    ownerScopeId: string;
    sourceId: string;
  },
): Promise<string | null> => {
  const result = await client.query<{ id: string }>(
    `
    select id
    from parameter_catalog.legacy_identities
    where source_system = $1
      and source_kind = $2
      and owner_scope_kind = $3
      and owner_scope_id = $4
      and source_id = $5
    `,
    [
      input.sourceSystem,
      input.sourceKind,
      input.ownerScopeKind,
      input.ownerScopeId,
      input.sourceId,
    ],
  );
  return result.rows[0]?.id ?? null;
};

const parseVersion = (row: HeadJoinRow): MappingVersion | null => {
  if (!isRClass(row.r_class)) return null;
  if (row.target_kind !== null && !isTargetKind(row.target_kind)) return null;
  return {
    id: row.id,
    legacyIdentityId: row.legacy_identity_id,
    cutoverRunId: row.cutover_run_id,
    versionNumber: Number(row.version_number),
    sourceChecksum: row.source_checksum,
    graphFingerprint: row.graph_fingerprint,
    rClass: row.r_class,
    targetKind: row.target_kind,
    targetId: row.target_id,
    archiveId: row.archive_id,
    evidenceArchiveId: row.evidence_archive_id,
    supersedesVersionId: row.supersedes_version_id,
  };
};

const parseHead = (row: HeadJoinRow): MappingHead | null => {
  const version = parseVersion(row);
  if (!version) return null;
  return {
    legacyIdentityId: row.legacy_identity_id,
    currentVersionId: row.current_version_id,
    casVersion: Number(row.cas_version),
    version,
  };
};

const HEAD_JOIN_SQL = `
select
  h.legacy_identity_id,
  h.current_version_id,
  h.cas_version::text as cas_version,
  v.id,
  v.cutover_run_id,
  v.version_number::text as version_number,
  v.source_checksum,
  v.graph_fingerprint,
  v.r_class,
  v.target_kind,
  v.target_id,
  v.archive_id,
  v.evidence_archive_id,
  v.supersedes_version_id
from parameter_catalog.legacy_mapping_heads h
join parameter_catalog.legacy_mapping_versions v
  on v.legacy_identity_id = h.legacy_identity_id
 and v.id = h.current_version_id
where h.legacy_identity_id = $1
`;

export const countMappingHeads = async (
  client: MappingQueryable,
  identityId: string,
): Promise<number> => {
  const result = await client.query<{ n: string }>(
    `
    select count(*)::bigint as n
    from parameter_catalog.legacy_mapping_heads
    where legacy_identity_id = $1
    `,
    [identityId],
  );
  return Number(result.rows[0]?.n ?? 0);
};

export const loadMappingHead = async (
  client: MappingQueryable,
  identityId: string,
  forUpdate: boolean,
): Promise<MappingResult<MappingHead | null>> => {
  const result = await client.query<HeadJoinRow>(
    `${HEAD_JOIN_SQL}${forUpdate ? " for update of h" : ""}`,
    [identityId],
  );
  if (result.rows.length === 0) return ok(null);
  if (result.rows.length > 1) {
    return fail("PCAT-MAP-CONFLICT", `Ambiguous mapping heads for ${identityId}`);
  }
  const head = parseHead(result.rows[0]!);
  if (!head) {
    return fail("PCAT-MAP-WRITE-FAILED", `Stored mapping head for ${identityId} is malformed`);
  }
  return ok(head);
};

export const outcomeColumns = (
  outcome: MappingOutcome,
): {
  targetKind: MappingTargetKind | null;
  targetId: string | null;
  archiveId: string | null;
  evidenceArchiveId: string | null;
} => {
  const evidenceArchiveId = outcome.evidenceArchiveId ?? null;
  if (outcome.kind === "operational") {
    return {
      targetKind: outcome.targetKind,
      targetId: outcome.targetId,
      archiveId: null,
      evidenceArchiveId,
    };
  }
  return {
    targetKind: null,
    targetId: null,
    archiveId: outcome.archiveId,
    evidenceArchiveId,
  };
};

export const isExactReplay = (
  version: MappingVersion,
  input: {
    sourceChecksum: string;
    graphFingerprint: string;
    rClass: RClass;
    outcome: MappingOutcome;
  },
): boolean => {
  if (version.sourceChecksum !== input.sourceChecksum) return false;
  if (version.graphFingerprint !== input.graphFingerprint) return false;
  if (version.rClass !== input.rClass) return false;
  const columns = outcomeColumns(input.outcome);
  return (
    version.targetKind === columns.targetKind &&
    version.targetId === columns.targetId &&
    version.archiveId === columns.archiveId &&
    version.evidenceArchiveId === columns.evidenceArchiveId
  );
};

export const nextVersionNumber = async (
  client: MappingQueryable,
  identityId: string,
): Promise<number> => {
  const result = await client.query<{ max_version: string }>(
    `
    select coalesce(max(version_number), 0)::text as max_version
    from parameter_catalog.legacy_mapping_versions
    where legacy_identity_id = $1
    `,
    [identityId],
  );
  return Number(result.rows[0]?.max_version ?? 0) + 1;
};

export const insertMappingVersion = async (
  client: MappingQueryable,
  version: MappingVersion,
): Promise<void> => {
  await client.query(
    `
    insert into parameter_catalog.legacy_mapping_versions (
      id, legacy_identity_id, cutover_run_id, version_number,
      source_checksum, graph_fingerprint, r_class,
      target_kind, target_id, archive_id, evidence_archive_id, supersedes_version_id
    ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    `,
    [
      version.id,
      version.legacyIdentityId,
      version.cutoverRunId,
      version.versionNumber,
      version.sourceChecksum,
      version.graphFingerprint,
      version.rClass,
      version.targetKind,
      version.targetId,
      version.archiveId,
      version.evidenceArchiveId,
      version.supersedesVersionId,
    ],
  );
};

export const insertMappingHead = async (
  client: MappingQueryable,
  identityId: string,
  versionId: string,
): Promise<void> => {
  await client.query(
    `
    insert into parameter_catalog.legacy_mapping_heads (
      legacy_identity_id, current_version_id, cas_version
    ) values ($1, $2, 1)
    `,
    [identityId, versionId],
  );
};

export const casMappingHead = async (
  client: MappingQueryable,
  input: {
    identityId: string;
    nextVersionId: string;
    expectedVersionId: string;
    expectedCasVersion: number;
  },
): Promise<boolean> => {
  const result = await client.query(
    `
    update parameter_catalog.legacy_mapping_heads
       set current_version_id = $1,
           cas_version = cas_version + 1,
           updated_at = now()
     where legacy_identity_id = $2
       and current_version_id = $3
       and cas_version = $4
    `,
    [
      input.nextVersionId,
      input.identityId,
      input.expectedVersionId,
      input.expectedCasVersion,
    ],
  );
  return (result.rowCount ?? 0) === 1;
};

export const persistBlockedLedger = async (
  client: MappingQueryable,
  input: {
    cutoverRunId: string;
    identityId: string;
    classifierVersion: string;
    graphFingerprint: string;
  },
): Promise<void> => {
  await client.query(
    `
    insert into parameter_catalog.parameter_catalog_classification_ledger (
      cutover_run_id, legacy_identity_id, r_class, classifier_version,
      graph_fingerprint, disposition, mapping_version_id
    ) values ($1, $2, 'R0', $3, $4, 'blocked', null)
    on conflict (cutover_run_id, legacy_identity_id) do nothing
    `,
    [
      input.cutoverRunId,
      input.identityId,
      input.classifierVersion,
      input.graphFingerprint,
    ],
  );
};

export const loadBlockedLedger = async (
  client: MappingQueryable,
  identityId: string,
): Promise<boolean> => {
  const result = await client.query<{ n: string }>(
    `
    select count(*)::bigint as n
    from parameter_catalog.parameter_catalog_classification_ledger
    where legacy_identity_id = $1
      and r_class = 'R0'
      and disposition = 'blocked'
      and mapping_version_id is null
    `,
    [identityId],
  );
  return Number(result.rows[0]?.n ?? 0) > 0;
};
