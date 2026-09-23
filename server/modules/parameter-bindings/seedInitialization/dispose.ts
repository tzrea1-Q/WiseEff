/**
 * T2.3b residue disposal for one captured project parameter plane.
 * Does not run from materializeSeedSources. Ordinary DELETE of immutable
 * catalog rows stays fail-closed; this module calls dispose_plane_residue.
 */
import { randomUUID } from "node:crypto";

import { ApiError } from "../../../shared/http/errors";
import type { Database, Queryable } from "../../../shared/database/client";
import { withAuditedWrite } from "../../audit/auditedWrite";
import type { AuthContext } from "../../auth/types";
import { canEditParameters } from "../../parameter-kernel/policy";
import type { ObjectStore } from "../../logs/objectStore";
import {
  ARCHIVED_PARAMETER_PLANE_RELATIONS,
  assertProjectParameterPlaneArchived,
  type ArchivedPlaneDocument,
  type ProjectParameterPlaneArchive,
} from "./archive";

const TARGET_PROJECT_IDS = new Set(["atlas", "aurora", "nebula"]);

const DELETE_ORDER = [
  "parameter_review_decisions",
  "parameter_submission_items",
  "parameter_draft_identity_invalidations",
  "project_parameter_value_change_targets",
  "project_parameter_value_change_requests",
  "project_parameter_value_drafts",
  "parameter_change_requests",
  "parameter_submission_rounds",
  "parameter_history_entries",
  "parameter_drafts",
  "legacy_parameter_values",
  "parameter_import_batches",
  "parameter_file_sync_conflicts",
  "identity_mapping_tasks",
  "parameter_spec_matcher_overrides",
  "dts_property_occurrence_spec_decisions",
  "project_parameter_initialization_reviews",
  "project_parameter_initialization_drafts",
  "binding_history_events",
  "canonical_values",
  "canonical_source_pins",
  "canonical_source_occurrences",
  "project_parameter_binding_revisions",
  "dts_release_baseline_members",
  "dts_config_revision_members",
  "project_parameter_file_candidates",
  "project_parameter_file_versions",
  "project_parameter_files",
  "dts_logical_node_revisions",
  "dts_logical_nodes",
  "dts_release_baseline",
  "dts_config_revisions",
  "dts_config_set",
  "canonical_bindings",
  "project_parameter_bindings",
] as const;

export type PlaneDisposalOperator = {
  readonly role: "cutover-operator";
  readonly approvalRef: string;
};

export type PlaneDisposalPlan = {
  readonly archiveId: string;
  readonly archiveDigest: string;
  readonly residue: Readonly<Record<string, readonly string[]>>;
};

const relationByKey = new Map(
  ARCHIVED_PARAMETER_PLANE_RELATIONS.map((relation) => [relation.key, relation]),
);

const pkColumnFor = (key: string): "id" | "draft_id" =>
  key === "parameter_draft_identity_invalidations" ? "draft_id" : "id";

const rowPk = (key: string, row: unknown): string | null => {
  if (row === null || typeof row !== "object") return null;
  const value = (row as Record<string, unknown>)[pkColumnFor(key)];
  return typeof value === "string" && value.length > 0 ? value : null;
};

const requireApproval = (operator: PlaneDisposalOperator): void => {
  if (operator.role !== "cutover-operator") {
    throw new ApiError("FORBIDDEN", "Plane disposal requires the cutover-operator role.");
  }
  if (!operator.approvalRef || operator.approvalRef.trim() !== operator.approvalRef) {
    throw new ApiError("FORBIDDEN", "Plane disposal requires a trusted approval ref.");
  }
};

const requireEditorAndOperator = (auth: AuthContext, operator: PlaneDisposalOperator): void => {
  if (!canEditParameters(auth)) {
    throw new ApiError("FORBIDDEN", "Plane disposal requires parameter edit permission.");
  }
  requireApproval(operator);
};

const requireTargetProject = (projectId: string): void => {
  if (!TARGET_PROJECT_IDS.has(projectId)) {
    throw new ApiError("VALIDATION_FAILED", "Plane disposal is limited to Atlas, Aurora, and Nebula.", {
      projectId,
    });
  }
};

const loadDocument = async (
  root: Database,
  objectStore: ObjectStore,
  auth: AuthContext,
  input: { organizationId: string; projectId: string; archiveId: string; archiveDigest: string },
): Promise<ArchivedPlaneDocument> => {
  await assertProjectParameterPlaneArchived(root, objectStore, {
    organizationId: input.organizationId,
    projectId: input.projectId,
    archiveId: input.archiveId,
    archiveDigest: input.archiveDigest,
  });
  const readBounded = objectStore.getBounded?.bind(objectStore);
  if (!readBounded) {
    throw new ApiError("CONFLICT", "The object store does not support bounded archive reads.", {
      reason: "parameter-archive-bounded-read-unavailable",
    });
  }
  const ledger = await root.query<{ object_ref: string }>(
    `select object_ref from project_parameter_plane_archives
      where id = $1 and organization_id = $2 and project_id = $3`,
    [input.archiveId, input.organizationId, input.projectId],
  );
  const objectRef = ledger.rows[0]?.object_ref;
  if (!objectRef) {
    throw new ApiError("CONFLICT", "The project's parameter plane archive was not found.", {
      archiveId: input.archiveId,
    });
  }
  const bytes = await readBounded(objectRef, Number.MAX_SAFE_INTEGER);
  return JSON.parse(bytes.toString("utf8")) as ArchivedPlaneDocument;
};

const snapshotPks = (document: ArchivedPlaneDocument, key: string): string[] => {
  const rows = document.relations[key] ?? [];
  return rows.map((row) => rowPk(key, row)).filter((id): id is string => id !== null);
};

async function idsFrom(db: Queryable, sql: string, params: unknown[]): Promise<string[]> {
  const result = await db.query<{ id: string }>(sql, params);
  return result.rows.map((row) => row.id).filter(Boolean);
}

const asSet = (ids: string[]): Set<string> => new Set(ids);

async function loadSuccessorPks(
  db: Queryable,
  organizationId: string,
  projectId: string,
): Promise<Map<string, Set<string>>> {
  const successor = new Map<string, Set<string>>();
  for (const relation of ARCHIVED_PARAMETER_PLANE_RELATIONS) {
    successor.set(relation.key, new Set());
  }
  const currentBindings = asSet(
    await idsFrom(
      db,
      `select id from parameter_catalog.current_project_parameter_bindings
        where organization_id = $1 and project_id = $2`,
      [organizationId, projectId],
    ),
  );
  successor.set("canonical_bindings", currentBindings);
  successor.set(
    "project_parameter_bindings",
    asSet(
      await idsFrom(
        db,
        `select id from public.project_parameter_bindings
          where organization_id = $1 and project_id = $2`,
        [organizationId, projectId],
      ),
    ),
  );
  const bindingList = [...currentBindings];
  successor.set(
    "canonical_values",
    asSet(
      await idsFrom(
        db,
        `select id from parameter_catalog.project_parameter_values
          where binding_id = any($1::text[])`,
        [bindingList],
      ),
    ),
  );
  successor.set(
    "canonical_source_pins",
    asSet(
      await idsFrom(
        db,
        `select id from parameter_catalog.project_value_source_pins
          where binding_id = any($1::text[])`,
        [bindingList],
      ),
    ),
  );
  successor.set(
    "canonical_source_occurrences",
    asSet(
      await idsFrom(
        db,
        `select source_occurrence_id as id
           from parameter_catalog.current_project_parameter_bindings
          where organization_id = $1 and project_id = $2
            and source_occurrence_id is not null`,
        [organizationId, projectId],
      ),
    ),
  );
  successor.set(
    "binding_history_events",
    asSet(
      await idsFrom(
        db,
        `select id from parameter_catalog.binding_history_events
          where binding_id = any($1::text[])`,
        [bindingList],
      ),
    ),
  );
  successor.set(
    "project_parameter_binding_revisions",
    asSet(
      await idsFrom(
        db,
        `select id from public.project_parameter_binding_revisions
          where binding_id = any($1::text[])`,
        [[...(successor.get("project_parameter_bindings") ?? new Set())]],
      ),
    ),
  );
  const currentConfigSets = asSet(
    await idsFrom(
      db,
      `select id from public.dts_config_set
        where organization_id = $1 and project_id = $2 and name = 'default'`,
      [organizationId, projectId],
    ),
  );
  successor.set("dts_config_set", currentConfigSets);
  const configList = [...currentConfigSets];
  // Revisions below remain retained; their members and versions still need
  // parent files even after those files leave the active config set.
  successor.set(
    "project_parameter_files",
    asSet(
      await idsFrom(
        db,
        `select file.id from public.project_parameter_files file
          where file.organization_id = $1 and file.project_id = $2
            and (file.config_set_id = any($3::text[]) or exists (
              select 1 from public.dts_config_revision_members member
              join public.dts_config_revisions revision on revision.id = member.config_revision_id
              where member.file_id = file.id
                and revision.organization_id = $1 and revision.project_id = $2
                and revision.config_set_id = any($3::text[])
            ))`,
        [organizationId, projectId, configList],
      ),
    ),
  );
  successor.set(
    "dts_config_revisions",
    asSet(
      await idsFrom(
        db,
        `select id from public.dts_config_revisions
          where organization_id = $1 and project_id = $2
            and config_set_id = any($3::text[])`,
        [organizationId, projectId, configList],
      ),
    ),
  );
  const revisionList = [...(successor.get("dts_config_revisions") ?? new Set())];
  successor.set(
    "dts_config_revision_members",
    asSet(
      await idsFrom(
        db,
        `select id from public.dts_config_revision_members
          where config_revision_id = any($1::text[])`,
        [revisionList],
      ),
    ),
  );
  successor.set(
    "project_parameter_file_versions",
    asSet(
      await idsFrom(
        db,
        `select file_version_id as id from public.dts_config_revision_members
          where config_revision_id = any($1::text[])`,
        [revisionList],
      ),
    ),
  );
  try {
    successor.set(
      "project_parameter_file_candidates",
      asSet(
        await idsFrom(
          db,
          `select id from public.project_parameter_file_candidates
            where organization_id = $1 and project_id = $2
              and status in ('uploading', 'parsing', 'ready', 'active')`,
          [organizationId, projectId],
        ),
      ),
    );
  } catch {
    successor.set("project_parameter_file_candidates", new Set());
  }
  successor.set(
    "dts_release_baseline",
    asSet(
      await idsFrom(
        db,
        `select id from public.dts_release_baseline
          where organization_id = $1 and config_set_id = any($2::text[])`,
        [organizationId, configList],
      ),
    ),
  );
  const baselineList = [...(successor.get("dts_release_baseline") ?? new Set())];
  successor.set(
    "dts_release_baseline_members",
    asSet(
      await idsFrom(
        db,
        `select id from public.dts_release_baseline_members
          where baseline_id = any($1::text[])`,
        [baselineList],
      ),
    ),
  );
  successor.set(
    "dts_logical_nodes",
    asSet(
      await idsFrom(
        db,
        `select id from public.dts_logical_nodes
          where organization_id = $1 and project_id = $2
            and config_set_id = any($3::text[])`,
        [organizationId, projectId, configList],
      ),
    ),
  );
  const nodeList = [...(successor.get("dts_logical_nodes") ?? new Set())];
  successor.set(
    "dts_logical_node_revisions",
    asSet(
      await idsFrom(
        db,
        `select id from public.dts_logical_node_revisions
          where logical_node_id = any($1::text[])
            and config_revision_id = any($2::text[])`,
        [nodeList, revisionList],
      ),
    ),
  );
  successor.set(
    "identity_mapping_tasks",
    asSet(
      await idsFrom(
        db,
        `select id from public.identity_mapping_tasks
          where organization_id = $1 and project_id = $2
            and status = 'open'
            and config_revision_id = any($3::text[])`,
        [organizationId, projectId, revisionList],
      ),
    ),
  );
  try {
    successor.set(
      "project_parameter_value_drafts",
      asSet(
        await idsFrom(
          db,
          `select id from public.project_parameter_value_drafts
            where organization_id = $1 and project_id = $2
              and binding_id = any($3::text[])`,
          [organizationId, projectId, bindingList],
        ),
      ),
    );
  } catch {
    successor.set("project_parameter_value_drafts", new Set());
  }
  try {
    successor.set(
      "project_parameter_value_change_requests",
      asSet(
        await idsFrom(
          db,
          `select request.id from public.project_parameter_value_change_requests request
            where request.organization_id = $1 and request.project_id = $2
              and (request.binding_id = any($3::text[]) or exists (
                select 1 from public.project_parameter_value_change_targets target
                 where target.request_id = request.id and target.binding_id = any($3::text[])))
              and request.status in ('open', 'pending', 'submitted')`,
          [organizationId, projectId, bindingList],
        ),
      ),
    );
  } catch {
    successor.set("project_parameter_value_change_requests", new Set());
  }
  successor.set("project_parameter_value_change_targets", asSet(await idsFrom(
    db,
    `select target.id from public.project_parameter_value_change_targets target
       where target.request_id = any($1::text[])`,
    [[...(successor.get("project_parameter_value_change_requests") ?? new Set())]],
  )));
  successor.set(
    "parameter_submission_rounds",
    asSet(
      await idsFrom(
        db,
        `select id from public.parameter_submission_rounds
          where organization_id = $1 and project_id = $2
            and status in ('open', 'pending', 'submitted')`,
        [organizationId, projectId],
      ),
    ),
  );
  try {
    successor.set(
      "parameter_file_sync_conflicts",
      asSet(
        await idsFrom(
          db,
          `select id from public.parameter_file_sync_conflicts
            where organization_id = $1 and project_id = $2 and status = 'open'`,
          [organizationId, projectId],
        ),
      ),
    );
  } catch {
    successor.set("parameter_file_sync_conflicts", new Set());
  }
  return successor;
}

async function restrictProtectedBindingIds(db: Queryable, organizationId: string, projectId: string): Promise<Set<string>> {
  const ids = [
    ...(await idsFrom(
      db,
      `select old_binding_id as id from parameter_catalog.definition_replacement_projects
        where organization_id = $1 and project_id = $2 and old_binding_id is not null
       union
       select new_binding_id from parameter_catalog.definition_replacement_projects
        where organization_id = $1 and project_id = $2 and new_binding_id is not null`,
      [organizationId, projectId],
    )),
    ...(await idsFrom(
      db,
      `select binding_id as id from parameter_catalog.parameter_observation_matches
        where organization_id = $1 and project_id = $2 and binding_id is not null`,
      [organizationId, projectId],
    )),
    ...(await idsFrom(
      db,
      `select project_parameter_binding_id as id from public.debugging_parameters
        where organization_id = $1 and project_parameter_binding_id is not null`,
      [organizationId],
    )),
    ...(await idsFrom(
      db,
      `select project_parameter_binding_id as id from public.node_operations
        where organization_id = $1 and project_parameter_binding_id is not null`,
      [organizationId],
    )),
    ...(await idsFrom(
      db,
      `select project_parameter_binding_id as id from public.legacy_parameter_migration_evidence
        where organization_id = $1 and project_parameter_binding_id is not null`,
      [organizationId],
    )),
  ];
  return new Set(ids);
}

export async function planProjectParameterPlaneDisposal(
  root: Database,
  objectStore: ObjectStore,
  auth: AuthContext,
  operator: PlaneDisposalOperator,
  input: {
    readonly projectId: string;
    readonly archiveId: string;
    readonly archiveDigest: string;
  },
): Promise<PlaneDisposalPlan> {
  requireEditorAndOperator(auth, operator);
  requireTargetProject(input.projectId);
  const organizationId = auth.organization.id;
  const document = await loadDocument(root, objectStore, auth, {
    organizationId,
    projectId: input.projectId,
    archiveId: input.archiveId,
    archiveDigest: input.archiveDigest,
  });
  const protectedBindings = await restrictProtectedBindingIds(root, organizationId, input.projectId);
  const reviewRevisionIds = new Set(
    await idsFrom(
      root,
      `select distinct config_revision_id as id
         from public.parameter_spec_review_tasks
        where organization_id = $1 and config_revision_id is not null`,
      [organizationId],
    ),
  );
  const occurrenceProtected = new Set(
    await idsFrom(
      root,
      `select source_occurrence_id as id
         from parameter_catalog.parameter_observations
        where organization_id = $1 and project_id = $2 and source_occurrence_id is not null`,
      [organizationId, input.projectId],
    ),
  );
  const successorByKey = await loadSuccessorPks(root, organizationId, input.projectId);
  const residue: Record<string, string[]> = {};
  for (const relation of ARCHIVED_PARAMETER_PLANE_RELATIONS) {
    const snapshot = snapshotPks(document, relation.key);
    const successor = successorByKey.get(relation.key) ?? new Set<string>();
    residue[relation.key] = snapshot.filter((id) => {
      if (successor.has(id)) return false;
      if (
        (relation.key === "project_parameter_bindings" || relation.key === "canonical_bindings")
        && protectedBindings.has(id)
      ) {
        return false;
      }
      if (relation.key === "dts_config_revisions" && reviewRevisionIds.has(id)) return false;
      if (relation.key === "canonical_source_occurrences" && occurrenceProtected.has(id)) return false;
      return true;
    });
  }
  return {
    archiveId: input.archiveId,
    archiveDigest: input.archiveDigest,
    residue,
  };
}

async function callDisposer(
  db: Queryable,
  archiveId: string,
  relationFrom: string,
  pkColumn: "id" | "draft_id",
  pks: readonly string[],
): Promise<void> {
  if (pks.length === 0) return;
  await db.query(
    `select parameter_catalog.dispose_plane_residue($1, $2, $3, $4::text[])`,
    [archiveId, relationFrom, pkColumn, [...pks]],
  );
}

export async function disposeProjectParameterPlaneResidue(
  root: Database,
  objectStore: ObjectStore,
  auth: AuthContext,
  operator: PlaneDisposalOperator,
  input: {
    readonly projectId: string;
    readonly archiveId: string;
    readonly archiveDigest: string;
  },
): Promise<{ readonly phase: "residue-deleted"; readonly archive: ProjectParameterPlaneArchive | null }> {
  requireEditorAndOperator(auth, operator);
  requireTargetProject(input.projectId);
  const organizationId = auth.organization.id;
  const plan = await planProjectParameterPlaneDisposal(root, objectStore, auth, operator, input);
  return withAuditedWrite(root, auth, { requestId: operator.approvalRef }, async (tx) => {
    await tx.query("select pg_advisory_xact_lock(hashtext('plane-disposal'), hashtext($1))", [
      `${organizationId}:${input.projectId}`,
    ]);
    const existing = await tx.query<{ id: string; phase: string }>(
      `select id, phase from parameter_catalog.plane_disposal_runs where archive_id = $1`,
      [input.archiveId],
    );
    if (existing.rows[0]?.phase === "residue-deleted") {
      return { result: { phase: "residue-deleted" as const, archive: null }, audit: null };
    }
    const runId = existing.rows[0]?.id ?? randomUUID();
    if (!existing.rows[0]) {
      await tx.query(
        `insert into parameter_catalog.plane_disposal_runs (
           id, organization_id, project_id, archive_id, archive_digest, approval_ref, phase, created_by
         ) values ($1, $2, $3, $4, $5, $6, 'archive-verified', $7)`,
        [
          runId,
          organizationId,
          input.projectId,
          input.archiveId,
          input.archiveDigest,
          operator.approvalRef,
          auth.user.id,
        ],
      );
    }
    await loadDocument(root, objectStore, auth, {
      organizationId,
      projectId: input.projectId,
      archiveId: input.archiveId,
      archiveDigest: input.archiveDigest,
    });
    const publicBindingResidue = plan.residue.project_parameter_bindings ?? [];
    if (publicBindingResidue.length > 0) {
      await tx.query(
        `update public.dts_reload_run_targets
            set disposed_binding_id = binding_id,
                binding_id = null
          where binding_id = any($1::text[])`,
        [publicBindingResidue],
      );
    }
    await tx.query(
      `update parameter_catalog.plane_disposal_runs
          set phase = 'rehomed', updated_at = now()
        where id = $1`,
      [runId],
    );
    const fileVersionResidue = plan.residue.project_parameter_file_versions ?? [];
    const revisionResidue = plan.residue.dts_config_revisions ?? [];
    if (fileVersionResidue.length > 0 || revisionResidue.length > 0) {
      const regenerable: Array<{ from: string; sql: string; params: unknown[] }> = [
        {
          from: "public.dts_occurrence_effects",
          sql: `select id from public.dts_occurrence_effects
                 where config_revision_id = any($1::text[])`,
          params: [revisionResidue],
        },
        {
          from: "public.dts_property_occurrences",
          sql: `select id from public.dts_property_occurrences
                 where file_version_id = any($1::text[]) or config_revision_id = any($2::text[])`,
          params: [fileVersionResidue, revisionResidue],
        },
        {
          from: "public.dts_node_occurrences",
          sql: `select id from public.dts_node_occurrences
                 where file_version_id = any($1::text[]) or config_revision_id = any($2::text[])`,
          params: [fileVersionResidue, revisionResidue],
        },
        {
          from: "public.dts_validation_diagnostics",
          sql: `select id from public.dts_validation_diagnostics
                 where logical_node_id = any($1::text[])`,
          params: [plan.residue.dts_logical_nodes ?? []],
        },
        {
          from: "public.dts_validation_runs",
          sql: `select id from public.dts_validation_runs
                 where config_revision_id = any($1::text[])`,
          params: [revisionResidue],
        },
        {
          from: "public.dts_phandle_refs",
          sql: `select ref.id
                  from public.dts_phandle_refs ref
                  join public.dts_properties property on property.id = ref.from_property_id
                  join public.dts_nodes node on node.id = property.node_id
                 where node.file_version_id = any($1::text[])`,
          params: [fileVersionResidue],
        },
      ];
      for (const child of regenerable) {
        const ids = await idsFrom(tx, child.sql, child.params);
        await callDisposer(tx, input.archiveId, child.from, "id", ids);
      }
    }
    // Versions are disposed before their files. Break only the current-version
    // links whose two endpoints are both archived residue in this transaction.
    await tx.query(`update public.project_parameter_files
      set current_version_id = null
      where organization_id = $1 and project_id = $2
        and id = any($3::text[]) and current_version_id = any($4::text[])`,
    [organizationId, input.projectId, plan.residue.project_parameter_files ?? [], fileVersionResidue]);
    for (const key of DELETE_ORDER) {
      const relation = relationByKey.get(key);
      if (!relation) continue;
      await callDisposer(tx, input.archiveId, relation.from, pkColumnFor(key), plan.residue[key] ?? []);
    }
    const document = await loadDocument(root, objectStore, auth, {
      organizationId,
      projectId: input.projectId,
      archiveId: input.archiveId,
      archiveDigest: input.archiveDigest,
    });
    const residueKeys = new Set([
      ...fileVersionResidue,
      ...(plan.residue.project_parameter_file_candidates ?? []),
    ]);
    if (residueKeys.size > 0) {
      const liveKeys = await tx.query<{ storage_key: string }>(
        `select storage_key from public.project_parameter_file_versions where storage_key is not null
         union
         select storage_key from public.project_parameter_file_candidates where storage_key is not null`,
      );
      const remaining = new Set(liveKeys.rows.map((row) => row.storage_key));
      for (const [storageKey] of Object.entries(document.objects)) {
        if (!remaining.has(storageKey) && objectStore.delete) {
          await objectStore.delete(storageKey);
        }
      }
    }
    await tx.query(
      `update parameter_catalog.plane_disposal_runs
          set phase = 'residue-deleted', updated_at = now()
        where id = $1`,
      [runId],
    );
    return {
      result: { phase: "residue-deleted" as const, archive: null },
      audit: {
        app: "parameters",
        kind: "plane-disposal",
        action: "dispose-residue",
        severity: "Medium",
        projectId: input.projectId,
        targetType: "project_parameter_plane_archive",
        targetId: input.archiveId,
        metadata: { archiveDigest: input.archiveDigest, approvalRef: operator.approvalRef },
      },
    };
  });
}

export async function retrieveProjectParameterPlaneArchive(
  root: Database,
  objectStore: ObjectStore,
  operator: PlaneDisposalOperator,
  input: { readonly archiveId: string },
): Promise<ArchivedPlaneDocument> {
  requireApproval(operator);
  const readBounded = objectStore.getBounded?.bind(objectStore);
  if (!readBounded) {
    throw new ApiError("CONFLICT", "The object store does not support bounded archive reads.", {
      reason: "parameter-archive-bounded-read-unavailable",
    });
  }
  const ledger = await root.query<{ object_ref: string; organization_id: string; project_id: string }>(
    `select object_ref, organization_id, project_id
       from project_parameter_plane_archives where id = $1`,
    [input.archiveId],
  );
  const row = ledger.rows[0];
  if (!row) {
    throw new ApiError("NOT_FOUND", "The project's parameter plane archive was not found.", {
      archiveId: input.archiveId,
    });
  }
  const bytes = await readBounded(row.object_ref, Number.MAX_SAFE_INTEGER);
  return JSON.parse(bytes.toString("utf8")) as ArchivedPlaneDocument;
}
