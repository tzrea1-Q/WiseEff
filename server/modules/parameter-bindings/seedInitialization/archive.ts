/**
 * Issue #849 scope item 4: offline archive of a project's legacy parameter plane.
 *
 * The reviewed seed rebuild replaces a project's parameters. Before it does, the
 * legacy plane - drafts, history, submission rounds, change requests and their review
 * decisions, bindings and their revisions, source files and their versions, and the
 * canonical values those bindings own - is captured to the object store and recorded
 * in `project_parameter_plane_archives` with row counts and digests.
 *
 * This is capture only. Nothing here deletes or rewrites the archived rows: disposal
 * needs its own reviewed decision, and the ledger deliberately has no column that
 * could imply one happened.
 *
 * Bounded on purpose. Each relation is read with a row cap; exceeding the cap sets
 * `truncated` so a partial capture can never be mistaken for a complete one.
 */
import { createHash, randomUUID } from "node:crypto";

import { ApiError } from "../../../shared/http/errors";
import type { Database, Queryable } from "../../../shared/database/client";
import type { AuthContext } from "../../auth/types";
import { LEGACY_IDENTITY_SQL } from "../../parameter-kernel/legacyParameterIdentityNames";
import { canEditParameters } from "../../parameter-kernel/policy";
import type { ObjectStore } from "../../logs/objectStore";

/** Rows read per relation. Exceeding it marks the archive truncated. */
export const ARCHIVE_ROW_CAP = 5_000;
/** Keeps base64 + JSON assembly bounded well below the server process heap. */
export const ARCHIVE_OBJECT_BYTES_CAP = 64 * 1024 * 1024;
export const ARCHIVE_RELATION_BYTES_CAP = 64 * 1024 * 1024;
/** Relation payload, duplicated object keys, base64 expansion, and fixed JSON metadata. */
export const ARCHIVE_DOCUMENT_BYTES_CAP =
  (2 * ARCHIVE_RELATION_BYTES_CAP) + (Math.ceil(ARCHIVE_OBJECT_BYTES_CAP / 3) * 4) + (1024 * 1024);

type RelationScope =
  | { readonly kind: "project"; readonly projectId: string }
  | { readonly kind: "request" }
  | { readonly kind: "round" }
  | { readonly kind: "binding" }
  | { readonly kind: "canonicalBinding" }
  | { readonly kind: "file" }
  | { readonly kind: "configSet" }
  | { readonly kind: "baseline" }
  | { readonly kind: "configRevision" }
  | { readonly kind: "logicalNode" };

type ArchiveRelation = {
  readonly key: string;
  readonly from: string;
  readonly scope: RelationScope;
  readonly orderBy?: string;
};

/**
 * The archived plane, declared rather than inferred. Each child relation is scoped
 * through its parent because it carries no `project_id` of its own.
 */
export const ARCHIVED_PARAMETER_PLANE_RELATIONS: readonly ArchiveRelation[] = [
  { key: "parameter_drafts", from: "public.parameter_drafts", scope: { kind: "project", projectId: "" } },
  { key: "legacy_parameter_values", from: `public.${LEGACY_IDENTITY_SQL.valuesTable}`, scope: { kind: "project", projectId: "" } },
  { key: "parameter_draft_identity_invalidations", from: "public.parameter_draft_identity_invalidations", scope: { kind: "project", projectId: "" }, orderBy: "draft_id" },
  { key: "parameter_history_entries", from: "public.parameter_history_entries", scope: { kind: "project", projectId: "" } },
  { key: "parameter_submission_rounds", from: "public.parameter_submission_rounds", scope: { kind: "project", projectId: "" } },
  { key: "parameter_change_requests", from: "public.parameter_change_requests", scope: { kind: "project", projectId: "" } },
  { key: "project_parameter_bindings", from: "public.project_parameter_bindings", scope: { kind: "project", projectId: "" } },
  { key: "project_parameter_files", from: "public.project_parameter_files", scope: { kind: "project", projectId: "" } },
  { key: "project_parameter_file_candidates", from: "public.project_parameter_file_candidates", scope: { kind: "project", projectId: "" } },
  { key: "project_parameter_initialization_drafts", from: "public.project_parameter_initialization_drafts", scope: { kind: "project", projectId: "" } },
  { key: "project_parameter_initialization_reviews", from: "public.project_parameter_initialization_reviews", scope: { kind: "project", projectId: "" } },
  { key: "parameter_import_batches", from: "public.parameter_import_batches", scope: { kind: "project", projectId: "" } },
  { key: "parameter_file_sync_conflicts", from: "public.parameter_file_sync_conflicts", scope: { kind: "project", projectId: "" } },
  { key: "identity_mapping_tasks", from: "public.identity_mapping_tasks", scope: { kind: "project", projectId: "" } },
  { key: "parameter_spec_matcher_overrides", from: "public.parameter_spec_matcher_overrides", scope: { kind: "project", projectId: "" } },
  { key: "dts_property_occurrence_spec_decisions", from: "public.dts_property_occurrence_spec_decisions", scope: { kind: "project", projectId: "" } },
  { key: "project_parameter_value_drafts", from: "public.project_parameter_value_drafts", scope: { kind: "project", projectId: "" } },
  { key: "project_parameter_value_change_requests", from: "public.project_parameter_value_change_requests", scope: { kind: "project", projectId: "" } },
  { key: "parameter_review_decisions", from: "public.parameter_review_decisions", scope: { kind: "request" } },
  { key: "parameter_submission_items", from: "public.parameter_submission_items", scope: { kind: "round" } },
  { key: "project_parameter_binding_revisions", from: "public.project_parameter_binding_revisions", scope: { kind: "binding" } },
  { key: "project_parameter_file_versions", from: "public.project_parameter_file_versions", scope: { kind: "file" } },
  { key: "dts_config_set", from: "public.dts_config_set", scope: { kind: "project", projectId: "" } },
  { key: "dts_release_baseline", from: "public.dts_release_baseline", scope: { kind: "configSet" } },
  { key: "dts_release_baseline_members", from: "public.dts_release_baseline_members", scope: { kind: "baseline" } },
  { key: "dts_config_revisions", from: "public.dts_config_revisions", scope: { kind: "project", projectId: "" } },
  { key: "dts_config_revision_members", from: "public.dts_config_revision_members", scope: { kind: "configRevision" } },
  { key: "dts_logical_nodes", from: "public.dts_logical_nodes", scope: { kind: "project", projectId: "" } },
  { key: "dts_logical_node_revisions", from: "public.dts_logical_node_revisions", scope: { kind: "logicalNode" } },
  {
    key: "canonical_bindings",
    from: "parameter_catalog.project_parameter_bindings",
    scope: { kind: "project", projectId: "" }
  },
  {
    key: "binding_history_events",
    from: "parameter_catalog.binding_history_events",
    scope: { kind: "canonicalBinding" }
  },
  {
    key: "canonical_values",
    from: "parameter_catalog.project_parameter_values",
    scope: { kind: "canonicalBinding" }
  }
];

const SCOPE_SQL: Record<Exclude<RelationScope["kind"], "project">, string> = {
  request: `request_id in (
    select id from public.parameter_change_requests
     where organization_id = $1 and project_id = $2
  )`,
  round: `submission_round_id in (
    select id from public.parameter_submission_rounds
     where organization_id = $1 and project_id = $2
  )`,
  binding: `binding_id in (
    select id from public.project_parameter_bindings
     where organization_id = $1 and project_id = $2
  )`,
  canonicalBinding: `binding_id in (
    select id from parameter_catalog.project_parameter_bindings
     where organization_id = $1 and project_id = $2
  )`,
  file: `file_id in (
    select id from public.project_parameter_files
     where organization_id = $1 and project_id = $2
  )`,
  configSet: `config_set_id in (
    select id from public.dts_config_set
     where organization_id = $1 and project_id = $2
  )`,
  baseline: `baseline_id in (
    select baseline.id
      from public.dts_release_baseline baseline
      join public.dts_config_set config_set on config_set.id = baseline.config_set_id
     where config_set.organization_id = $1 and config_set.project_id = $2
  )`,
  configRevision: `config_revision_id in (
    select id from public.dts_config_revisions
     where organization_id = $1 and project_id = $2
  )`,
  logicalNode: `logical_node_id in (
    select id from public.dts_logical_nodes
     where organization_id = $1 and project_id = $2
  )`
};

const predicateFor = (scope: RelationScope): string =>
  scope.kind === "project"
    ? "organization_id = $1 and project_id = $2"
    : SCOPE_SQL[scope.kind];

export type ProjectParameterPlaneArchive = {
  readonly archiveId: string;
  readonly archiveDigest: string;
  readonly contentDigest: string;
  readonly objectRef: string;
  readonly counts: Readonly<Record<string, number>>;
  readonly truncated: boolean;
  /** True when an identical archive already existed for this project. */
  readonly reused: boolean;
};

export type ArchivedPlaneDocument = {
  readonly schemaVersion: "project-parameter-plane-archive/v2";
  readonly organizationId: string;
  readonly projectId: string;
  readonly capturedAt: string;
  readonly truncated: boolean;
  readonly counts: Record<string, number>;
  readonly relations: Record<string, readonly unknown[]>;
  readonly objects: Record<string, ArchivedPlaneObject>;
};

export type ArchivedPlaneObject = {
  readonly checksumSha256: string;
  readonly sizeBytes: number;
  readonly bytesBase64: string;
};

const sha256 = (value: string | Buffer): string =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

const archivedPlaneDigestOf = (document: ArchivedPlaneDocument): string =>
  sha256(JSON.stringify({
    schemaVersion: document.schemaVersion,
    organizationId: document.organizationId,
    projectId: document.projectId,
    truncated: document.truncated,
    counts: document.counts,
    relations: document.relations,
    objects: document.objects
  }));

export const archiveDigestOf = (input: {
  readonly scope: string;
  readonly counts: Readonly<Record<string, number>>;
  readonly contentDigest: string;
}): string =>
  sha256(
    JSON.stringify({
      scope: input.scope,
      counts: Object.fromEntries(
        Object.entries(input.counts).sort(([left], [right]) => left.localeCompare(right))
      ),
      contentDigest: input.contentDigest
    })
  );

/**
 * Capture the project's legacy parameter plane. Repeat calls with an unchanged plane
 * reuse the existing archive instead of writing a second identical object.
 */
export async function captureProjectParameterPlane(
  root: Database,
  objectStore: ObjectStore,
  auth: AuthContext,
  input: { readonly projectId: string; readonly capturedAt?: string },
  session?: Queryable
): Promise<ProjectParameterPlaneArchive> {
  if (!canEditParameters(auth) || !canEditParameters(auth, input.projectId)) {
    throw new ApiError("FORBIDDEN", "Parameter edit role is required to archive this project.");
  }
  if (!session) {
    return root.transaction(async (tx) => {
      await tx.query("set transaction isolation level repeatable read");
      return captureProjectParameterPlane(root, objectStore, auth, input, tx);
    });
  }
  const organizationId = auth.organization.id;
  const readBounded = objectStore.getBounded?.bind(objectStore);
  if (!readBounded) {
    throw new ApiError("CONFLICT", "The object store does not support bounded archive reads.", {
      projectId: input.projectId,
      reason: "parameter-archive-bounded-read-unavailable"
    });
  }
  const counts: Record<string, number> = {};
  const relations: Record<string, readonly unknown[]> = {};
  let truncated = false;
  let aggregateRelationBytes = 0;

  for (const relation of ARCHIVED_PARAMETER_PLANE_RELATIONS) {
    const predicate = predicateFor(relation.scope);
    const total = await session.query<{ n: string; bytes: string }>(
      `select count(*)::text as n,
              coalesce(sum(octet_length(to_jsonb(archived_row)::text)), 0)::text as bytes
         from ${relation.from} archived_row
        where ${predicate}`,
      [organizationId, input.projectId]
    );
    const totalCount = Number(total.rows[0]?.n ?? 0);
    aggregateRelationBytes += Number(total.rows[0]?.bytes ?? 0);
    if (aggregateRelationBytes > ARCHIVE_RELATION_BYTES_CAP) {
      throw new ApiError("CONFLICT", "The parameter relation archive exceeds its aggregate byte limit.", {
        projectId: input.projectId,
        aggregateRelationBytes,
        maxBytes: ARCHIVE_RELATION_BYTES_CAP,
        reason: "parameter-relation-archive-too-large"
      });
    }
    const rows = await session.query(
      `select * from ${relation.from} where ${predicate} order by ${relation.orderBy ?? "id"} limit $3`,
      [organizationId, input.projectId, ARCHIVE_ROW_CAP]
    );
    counts[relation.key] = totalCount;
    relations[relation.key] = rows.rows;
    if (totalCount > ARCHIVE_ROW_CAP) truncated = true;
  }

  const objectReferences = [
    ...(relations.project_parameter_file_versions ?? []),
    ...(relations.project_parameter_file_candidates ?? []).filter(
      (candidate) => (candidate as { storage_key?: unknown }).storage_key != null,
    ),
  ];
  const requiredObjects = new Map<string, { checksumSha256: string; sizeBytes: number }>();
  let aggregateObjectBytes = 0;
  for (const candidate of objectReferences) {
    const row = candidate as { storage_key?: unknown; checksum?: unknown; size_bytes?: unknown };
    if (
      typeof row.storage_key !== "string" ||
      typeof row.checksum !== "string" ||
      !["number", "string"].includes(typeof row.size_bytes)
    ) {
      throw new ApiError("CONFLICT", "A parameter file version cannot be archived completely.", {
        projectId: input.projectId,
        reason: "parameter-file-version-metadata-invalid"
      });
    }
    const sizeBytes = Number(row.size_bytes);
    if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) {
      throw new ApiError("CONFLICT", "A parameter source object has invalid size metadata.", {
        projectId: input.projectId,
        storageKey: row.storage_key,
        reason: "parameter-source-object-size-invalid"
      });
    }
    const existingObject = requiredObjects.get(row.storage_key);
    if (
      existingObject &&
      (existingObject.checksumSha256 !== row.checksum || existingObject.sizeBytes !== sizeBytes)
    ) {
      throw new ApiError("CONFLICT", "A parameter source storage key has conflicting metadata.", {
        projectId: input.projectId,
        storageKey: row.storage_key,
        reason: "parameter-source-object-metadata-conflict"
      });
    }
    if (!existingObject) {
      aggregateObjectBytes += sizeBytes;
      if (aggregateObjectBytes > ARCHIVE_OBJECT_BYTES_CAP) {
        throw new ApiError("CONFLICT", "The parameter source archive exceeds its aggregate byte limit.", {
          projectId: input.projectId,
          aggregateObjectBytes,
          maxBytes: ARCHIVE_OBJECT_BYTES_CAP,
          reason: "parameter-source-archive-too-large"
        });
      }
      requiredObjects.set(row.storage_key, { checksumSha256: row.checksum, sizeBytes });
    }
  }

  const objects: Record<string, ArchivedPlaneObject> = {};
  for (const [storageKey, expected] of requiredObjects) {
    let sourceBytes: Buffer;
    try {
      sourceBytes = await readBounded!(storageKey, expected.sizeBytes);
    } catch {
      throw new ApiError("CONFLICT", "A parameter source object is unavailable for offline archive.", {
        projectId: input.projectId,
        storageKey,
        reason: "parameter-source-object-unavailable"
      });
    }
    const checksumSha256 = createHash("sha256").update(sourceBytes).digest("hex");
    if (checksumSha256 !== expected.checksumSha256 || sourceBytes.byteLength !== expected.sizeBytes) {
      throw new ApiError("CONFLICT", "A parameter source object failed its checksum or size check.", {
        projectId: input.projectId,
        storageKey,
        reason: "parameter-source-object-integrity-failed"
      });
    }
    objects[storageKey] = {
      checksumSha256,
      sizeBytes: expected.sizeBytes,
      bytesBase64: sourceBytes.toString("base64")
    };
  }

  const document: ArchivedPlaneDocument = {
    schemaVersion: "project-parameter-plane-archive/v2",
    organizationId,
    projectId: input.projectId,
    capturedAt: input.capturedAt ?? new Date().toISOString(),
    truncated,
    counts,
    relations,
    objects
  };
  const bytes = Buffer.from(`${JSON.stringify(document)}\n`, "utf8");
  if (bytes.byteLength > ARCHIVE_DOCUMENT_BYTES_CAP) {
    throw new ApiError("CONFLICT", "The parameter plane archive document exceeds its byte limit.", {
      projectId: input.projectId,
      documentBytes: bytes.byteLength,
      maxBytes: ARCHIVE_DOCUMENT_BYTES_CAP,
      reason: "parameter-plane-archive-document-too-large"
    });
  }

  const latest = await session.query<{
    id: string;
    object_ref: string;
    content_digest: string;
    archive_digest: string;
    counts: Record<string, number>;
  }>(
    `select id, object_ref, content_digest, archive_digest, counts
       from project_parameter_plane_archives
      where organization_id = $1 and project_id = $2 and scope = 'legacy-parameter-plane'
      order by created_at desc, id
      limit 1`,
    [organizationId, input.projectId]
  );
  const previous = latest.rows[0];
  if (previous) {
    try {
      const previousBytes = await readBounded(previous.object_ref, ARCHIVE_DOCUMENT_BYTES_CAP);
      const parsed: unknown = JSON.parse(previousBytes.toString("utf8"));
      if (
        parsed !== null &&
        typeof parsed === "object" &&
        sha256(previousBytes) === previous.content_digest &&
        archiveDigestOf({
          scope: "legacy-parameter-plane",
          counts: previous.counts,
          contentDigest: previous.content_digest
        }) === previous.archive_digest &&
        archivedPlaneDigestOf(parsed as ArchivedPlaneDocument) === archivedPlaneDigestOf(document)
      ) {
        return {
          archiveId: previous.id,
          archiveDigest: previous.archive_digest,
          contentDigest: previous.content_digest,
          objectRef: previous.object_ref,
          counts,
          truncated,
          reused: true
        };
      }
    } catch {
      // A missing or malformed previous object is not reusable; write a fresh archive.
    }
  }

  const contentDigest = sha256(bytes);
  const archiveDigest = archiveDigestOf({ scope: "legacy-parameter-plane", counts, contentDigest });

  const stored = await objectStore.put({
    organizationId,
    fileName: `project-parameter-plane-${input.projectId}-${contentDigest.slice(7, 19)}.json`,
    contentType: "application/json",
    bytes
  });

  const archiveId = `pppa_${randomUUID()}`;
  await session.query(
    `insert into project_parameter_plane_archives (
       id, organization_id, project_id, scope, object_ref, content_digest,
       archive_digest, counts, truncated, created_by
     ) values ($1,$2,$3,'legacy-parameter-plane',$4,$5,$6,$7::jsonb,$8,$9)
     on conflict (organization_id, project_id, scope, archive_digest) do nothing`,
    [
      archiveId,
      organizationId,
      input.projectId,
      stored.storageKey,
      contentDigest,
      archiveDigest,
      JSON.stringify(counts),
      truncated,
      auth.user.id
    ]
  );

  const persisted = await session.query<{ id: string }>(
    `select id from project_parameter_plane_archives
      where organization_id = $1 and project_id = $2 and scope = 'legacy-parameter-plane'
        and archive_digest = $3
      limit 1`,
    [organizationId, input.projectId, archiveDigest]
  );

  return {
    archiveId: persisted.rows[0]?.id ?? archiveId,
    archiveDigest,
    contentDigest,
    objectRef: stored.storageKey,
    counts,
    truncated,
    reused: false
  };
}

/**
 * The guard a rebuild must satisfy: an archive exists for this project and was not
 * truncated. A partial archive is refused rather than treated as preservation.
 */
export async function assertProjectParameterPlaneArchived(
  db: Queryable,
  objectStore: ObjectStore,
  input: {
    readonly organizationId: string;
    readonly projectId: string;
    readonly archiveId: string;
    readonly archiveDigest: string;
  }
): Promise<{ readonly archiveId: string; readonly archiveDigest: string }> {
  const result = await db.query<{
    id: string;
    object_ref: string;
    content_digest: string;
    archive_digest: string;
    counts: Record<string, number>;
    truncated: boolean;
  }>(
    `select id, object_ref, content_digest, archive_digest, counts, truncated
       from project_parameter_plane_archives
      where id = $1 and organization_id = $2 and project_id = $3
        and scope = 'legacy-parameter-plane' and archive_digest = $4`,
    [input.archiveId, input.organizationId, input.projectId, input.archiveDigest]
  );
  const row = result.rows[0];
  if (!row) {
    throw new ApiError(
      "CONFLICT",
      "The project's parameter plane has not been archived offline; a seed rebuild is refused.",
      { projectId: input.projectId, reason: "parameter-plane-not-archived" }
    );
  }
  if (row.truncated) {
    throw new ApiError(
      "CONFLICT",
      "The project's parameter plane archive is truncated, so it is not complete preservation.",
      { projectId: input.projectId, reason: "parameter-plane-archive-truncated" }
    );
  }

  const readBounded = objectStore.getBounded?.bind(objectStore);
  if (!readBounded) {
    throw new ApiError(
      "CONFLICT",
      "The object store does not support bounded archive reads.",
      { projectId: input.projectId, reason: "parameter-archive-bounded-read-unavailable" }
    );
  }
  let bytes: Buffer;
  try {
    bytes = await readBounded(row.object_ref, ARCHIVE_DOCUMENT_BYTES_CAP);
  } catch {
    throw new ApiError(
      "CONFLICT",
      "The project's parameter plane archive integrity check failed.",
      { projectId: input.projectId, reason: "parameter-plane-archive-object-unavailable" }
    );
  }
  const expectedArchiveDigest = archiveDigestOf({
    scope: "legacy-parameter-plane",
    counts: row.counts,
    contentDigest: row.content_digest
  });
  let document: ArchivedPlaneDocument | undefined;
  try {
    const parsed: unknown = JSON.parse(bytes.toString("utf8"));
    document = parsed !== null && typeof parsed === "object"
      ? parsed as ArchivedPlaneDocument
      : undefined;
  } catch {
    document = undefined;
  }
  const relationKeys = ARCHIVED_PARAMETER_PLANE_RELATIONS.map((relation) => relation.key).sort();
  const ledgerCountKeys = Object.keys(row.counts).sort();
  const documentCountKeys = Object.keys(document?.counts ?? {}).sort();
  const countsMatch =
    relationKeys.length === ledgerCountKeys.length &&
    relationKeys.every((key, index) => key === ledgerCountKeys[index]) &&
    relationKeys.length === documentCountKeys.length &&
    relationKeys.every((key, index) => key === documentCountKeys[index]) &&
    Object.entries(row.counts).every(([key, count]) => document?.counts?.[key] === count);
  const documentRelationKeys = Object.keys(document?.relations ?? {}).sort();
  const relationsMatch =
    relationKeys.length === documentRelationKeys.length &&
    relationKeys.every((key, index) => key === documentRelationKeys[index]) &&
    relationKeys.every((key) =>
      Array.isArray(document?.relations?.[key]) && document.relations[key]!.length === row.counts[key]
    );
  const fileVersionRows = Array.isArray(document?.relations?.project_parameter_file_versions)
    ? document.relations.project_parameter_file_versions
    : [];
  const candidateRows = Array.isArray(document?.relations?.project_parameter_file_candidates)
    ? document.relations.project_parameter_file_candidates.filter(
      (candidate) => (candidate as { storage_key?: unknown }).storage_key != null,
    )
    : [];
  const objectReferenceRows = [...fileVersionRows, ...candidateRows];
  const referencedStorageKeys = new Set<string>();
  const objectsMatch = document?.objects !== null && typeof document?.objects === "object" && objectReferenceRows.every((candidate) => {
    const version = candidate as { storage_key?: unknown; checksum?: unknown; size_bytes?: unknown };
    if (
      typeof version.storage_key !== "string" ||
      typeof version.checksum !== "string" ||
      !["number", "string"].includes(typeof version.size_bytes)
    ) return false;
    referencedStorageKeys.add(version.storage_key);
    const archivedObject = document?.objects?.[version.storage_key];
    if (!archivedObject) return false;
    const decoded = Buffer.from(archivedObject.bytesBase64, "base64");
    return (
      archivedObject.checksumSha256 === version.checksum &&
      archivedObject.sizeBytes === Number(version.size_bytes) &&
      decoded.byteLength === archivedObject.sizeBytes &&
      createHash("sha256").update(decoded).digest("hex") === archivedObject.checksumSha256
    );
  }) && Object.keys(document?.objects ?? {}).every((storageKey) => referencedStorageKeys.has(storageKey));
  if (
    sha256(bytes) !== row.content_digest ||
    expectedArchiveDigest !== row.archive_digest ||
    document?.schemaVersion !== "project-parameter-plane-archive/v2" ||
    document.organizationId !== input.organizationId ||
    document.projectId !== input.projectId ||
    document.truncated ||
    !countsMatch ||
    !relationsMatch ||
    !objectsMatch
  ) {
    throw new ApiError(
      "CONFLICT",
      "The project's parameter plane archive integrity check failed.",
      { projectId: input.projectId, reason: "parameter-plane-archive-integrity-failed" }
    );
  }
  return { archiveId: row.id, archiveDigest: row.archive_digest };
}
