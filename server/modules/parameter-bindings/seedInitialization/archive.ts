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
 * Bounded on purpose. Each relation is read with a row cap; hitting the cap sets
 * `truncated` so a partial capture can never be mistaken for a complete one.
 */
import { createHash, randomUUID } from "node:crypto";

import { ApiError } from "../../../shared/http/errors";
import type { Database, Queryable } from "../../../shared/database/client";
import type { AuthContext } from "../../auth/types";
import { canEditParameters } from "../../parameter-kernel/policy";
import type { ObjectStore } from "../../logs/objectStore";

/** Rows read per relation. Exceeding it marks the archive truncated. */
export const ARCHIVE_ROW_CAP = 5_000;

type RelationScope =
  | { readonly kind: "project"; readonly projectId: string }
  | { readonly kind: "request" }
  | { readonly kind: "round" }
  | { readonly kind: "binding" }
  | { readonly kind: "file" };

type ArchiveRelation = {
  readonly key: string;
  readonly from: string;
  readonly scope: RelationScope;
};

/**
 * The archived plane, declared rather than inferred. Each child relation is scoped
 * through its parent because it carries no `project_id` of its own.
 */
export const ARCHIVED_PARAMETER_PLANE_RELATIONS: readonly ArchiveRelation[] = [
  { key: "parameter_drafts", from: "public.parameter_drafts", scope: { kind: "project", projectId: "" } },
  { key: "parameter_history_entries", from: "public.parameter_history_entries", scope: { kind: "project", projectId: "" } },
  { key: "parameter_submission_rounds", from: "public.parameter_submission_rounds", scope: { kind: "project", projectId: "" } },
  { key: "parameter_change_requests", from: "public.parameter_change_requests", scope: { kind: "project", projectId: "" } },
  { key: "project_parameter_bindings", from: "public.project_parameter_bindings", scope: { kind: "project", projectId: "" } },
  { key: "project_parameter_files", from: "public.project_parameter_files", scope: { kind: "project", projectId: "" } },
  { key: "project_parameter_file_candidates", from: "public.project_parameter_file_candidates", scope: { kind: "project", projectId: "" } },
  { key: "project_parameter_initialization_drafts", from: "public.project_parameter_initialization_drafts", scope: { kind: "project", projectId: "" } },
  { key: "project_parameter_initialization_reviews", from: "public.project_parameter_initialization_reviews", scope: { kind: "project", projectId: "" } },
  { key: "parameter_review_decisions", from: "public.parameter_review_decisions", scope: { kind: "request" } },
  { key: "parameter_submission_items", from: "public.parameter_submission_items", scope: { kind: "round" } },
  { key: "project_parameter_binding_revisions", from: "public.project_parameter_binding_revisions", scope: { kind: "binding" } },
  { key: "project_parameter_file_versions", from: "public.project_parameter_file_versions", scope: { kind: "file" } },
  {
    key: "canonical_values",
    from: "parameter_catalog.project_parameter_values",
    scope: { kind: "binding" }
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
  file: `file_id in (
    select id from public.project_parameter_files
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
  readonly schemaVersion: "project-parameter-plane-archive/v1";
  readonly organizationId: string;
  readonly projectId: string;
  readonly capturedAt: string;
  readonly truncated: boolean;
  readonly counts: Record<string, number>;
  readonly relations: Record<string, readonly unknown[]>;
};

const sha256 = (value: string | Buffer): string =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

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
  session: Queryable = root
): Promise<ProjectParameterPlaneArchive> {
  if (!canEditParameters(auth) || !canEditParameters(auth, input.projectId)) {
    throw new ApiError("FORBIDDEN", "Parameter edit role is required to archive this project.");
  }
  const organizationId = auth.organization.id;
  const counts: Record<string, number> = {};
  const relations: Record<string, readonly unknown[]> = {};
  let truncated = false;

  for (const relation of ARCHIVED_PARAMETER_PLANE_RELATIONS) {
    const predicate = predicateFor(relation.scope);
    const total = await session.query<{ n: string }>(
      `select count(*)::text as n from ${relation.from} where ${predicate}`,
      [organizationId, input.projectId]
    );
    const totalCount = Number(total.rows[0]?.n ?? 0);
    const rows = await session.query(
      `select * from ${relation.from} where ${predicate} order by ctid limit $3`,
      [organizationId, input.projectId, ARCHIVE_ROW_CAP]
    );
    counts[relation.key] = totalCount;
    relations[relation.key] = rows.rows;
    if (totalCount > ARCHIVE_ROW_CAP) truncated = true;
  }

  const document: ArchivedPlaneDocument = {
    schemaVersion: "project-parameter-plane-archive/v1",
    organizationId,
    projectId: input.projectId,
    capturedAt: input.capturedAt ?? new Date().toISOString(),
    truncated,
    counts,
    relations
  };
  const bytes = Buffer.from(`${JSON.stringify(document, null, 1)}\n`, "utf8");
  const contentDigest = sha256(bytes);
  const archiveDigest = archiveDigestOf({ scope: "legacy-parameter-plane", counts, contentDigest });

  const existing = await session.query<{ id: string; object_ref: string }>(
    `select id, object_ref
       from project_parameter_plane_archives
      where organization_id = $1 and project_id = $2 and scope = 'legacy-parameter-plane'
        and archive_digest = $3
      limit 1`,
    [organizationId, input.projectId, archiveDigest]
  );
  if (existing.rows[0]) {
    return {
      archiveId: existing.rows[0].id,
      archiveDigest,
      contentDigest,
      objectRef: existing.rows[0].object_ref,
      counts,
      truncated,
      reused: true
    };
  }

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
  input: { readonly organizationId: string; readonly projectId: string }
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
      where organization_id = $1 and project_id = $2 and scope = 'legacy-parameter-plane'
      order by created_at desc, id
      limit 1`,
    [input.organizationId, input.projectId]
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

  let bytes: Buffer;
  try {
    bytes = await objectStore.get(row.object_ref);
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
  const countsMatch =
    document !== undefined &&
    Object.keys(document.counts ?? {}).length === Object.keys(row.counts).length &&
    Object.entries(row.counts).every(([key, count]) => document?.counts?.[key] === count);
  if (
    sha256(bytes) !== row.content_digest ||
    expectedArchiveDigest !== row.archive_digest ||
    document?.schemaVersion !== "project-parameter-plane-archive/v1" ||
    document.organizationId !== input.organizationId ||
    document.projectId !== input.projectId ||
    document.truncated ||
    !countsMatch
  ) {
    throw new ApiError(
      "CONFLICT",
      "The project's parameter plane archive integrity check failed.",
      { projectId: input.projectId, reason: "parameter-plane-archive-integrity-failed" }
    );
  }
  return { archiveId: row.id, archiveDigest: row.archive_digest };
}
