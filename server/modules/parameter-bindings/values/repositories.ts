import { createHash } from "node:crypto";

import type pg from "pg";
import type { Queryable } from "../../../shared/database/client";

import {
  serializeContract,
  ProjectValueId,
  type ContractJsonValue,
} from "../../parameter-catalog-contract/index";
import type { CanonicalValueSourcePin, CanonicalSourceBindingPin, ProjectValueKind, ProjectValuePayload } from "./types";

export type ValueClient = {
  query: {
    <Row extends pg.QueryResultRow>(
      text: string,
      values?: unknown[],
    ): Promise<pg.QueryResult<Row>>;
  };
};

export type BindingTipRow = {
  id: string;
  organization_id: string;
  catalog_release_id: string;
  project_id: string;
  logical_node_id: string | null;
  source_occurrence_id: string;
  registration_id: string;
  subject_id: string;
  definition_id: string;
  effective_revision_id: string;
  current_value_id: string;
};

export type ProjectValueRow = {
  id: string;
  binding_id: string;
  definition_id: string;
  definition_revision_id: string;
  source_ref: string;
  config_revision_id: string;
  value_digest: string;
  value_kind: string;
  value: unknown;
  created_at: Date | string;
};

/** Discovery only; source owners fence these identities before reading bytes or locking Bindings. */
export async function discoverCurrentSourceRevisionPins(tx: Queryable, input: { organizationId: string; projectId: string; configSetId: string }) {
  return (await tx.query<{ organizationId: string; projectId: string; configSetId: string; configRevisionId: string; fileId: string; fileVersionId: string }>(
    `select distinct pin.organization_id as "organizationId",pin.project_id as "projectId",occurrence.config_set_id as "configSetId",
      pin.config_revision_id as "configRevisionId",pin.file_id as "fileId",pin.file_version_id as "fileVersionId"
     from parameter_catalog.current_project_parameter_bindings binding
     join parameter_catalog.project_parameter_source_occurrences occurrence on occurrence.id=binding.source_occurrence_id
       and occurrence.organization_id=binding.organization_id and occurrence.project_id=binding.project_id
     join parameter_catalog.project_value_source_pins pin on pin.project_value_id=binding.current_value_id and pin.binding_id=binding.id
       and pin.organization_id=binding.organization_id and pin.project_id=binding.project_id
     where binding.organization_id=$1 and binding.project_id=$2 and occurrence.config_set_id=$3
     order by "configRevisionId","fileId","fileVersionId"`, [input.organizationId,input.projectId,input.configSetId],
  )).rows;
}

/** Legacy import admission cannot bypass source review for a canonical project or item. */
export async function requiresCanonicalSourceImport(tx: Queryable, input: { organizationId: string; projectId: string; bindingIds: string[] }): Promise<boolean> {
  const result = await tx.query(`select binding.id from parameter_catalog.project_parameter_bindings binding
    where binding.organization_id=$1 and binding.project_id=$2 and (
      binding.id=any($3::text[]) or exists (
        select 1 from parameter_catalog.${projectParameterValues} value
        join parameter_catalog.project_value_source_pins pin on pin.project_value_id=value.id and pin.binding_id=value.binding_id
        where value.id=binding.current_value_id and value.binding_id=binding.id
          and pin.organization_id=binding.organization_id and pin.project_id=binding.project_id
          and pin.source_occurrence_id=binding.source_occurrence_id and pin.definition_id=binding.definition_id
      )) limit 1`, [input.organizationId,input.projectId,input.bindingIds]);
  return result.rows.length !== 0;
}

/** Caller holds the source-prefix locks; this operation locks and reads its complete value cohort. */
export async function loadSourceBindingCohort(tx: Queryable, input: { organizationId: string; projectId: string; configSetId: string }) {
  await tx.query(`select binding.id from parameter_catalog.project_parameter_bindings binding
    join parameter_catalog.project_parameter_source_occurrences occurrence on occurrence.id=binding.source_occurrence_id
    where binding.organization_id=$1 and binding.project_id=$2 and occurrence.config_set_id=$3
    order by binding.id for update of binding nowait`, [input.organizationId,input.projectId,input.configSetId]);
  return (await tx.query<CanonicalSourceBindingPin>(`select binding.id as "bindingId",binding.current_value_id as "oldValueId",
    pin.id as "sourcePinId",binding.source_occurrence_id as "sourceOccurrenceId",binding.definition_id as "definitionId",
    binding.effective_revision_id as "effectiveRevisionId",binding.catalog_release_id as "catalogReleaseId",
    pin.locator,value.value_kind as "valueKind",value.value_digest as "valueDigest",occurrence.config_set_id as "configSetId"
    from parameter_catalog.current_project_parameter_bindings binding
    join parameter_catalog.project_parameter_source_occurrences occurrence on occurrence.id=binding.source_occurrence_id
      and occurrence.organization_id=binding.organization_id and occurrence.project_id=binding.project_id
    left join parameter_catalog.${projectParameterValues} value on value.id=binding.current_value_id and value.binding_id=binding.id
    left join parameter_catalog.project_value_source_pins pin on pin.project_value_id=value.id and pin.binding_id=binding.id
      and pin.source_occurrence_id=binding.source_occurrence_id
    where binding.organization_id=$1 and binding.project_id=$2 and occurrence.config_set_id=$3 order by binding.id`,
  [input.organizationId,input.projectId,input.configSetId])).rows;
}

/** Historical pin reads use exact owner/value identity, never the current file tip. */
export async function loadOwnedProjectValueSourcePin(tx: Queryable, input: { organizationId: string; projectId: string; bindingId: string; projectValueId: string }) {
  const result = await tx.query<CanonicalValueSourcePin>(
    `select pin.id as "sourcePinId", pin.organization_id as "organizationId", pin.project_id as "projectId",
       pin.binding_id as "bindingId", pin.definition_id as "definitionId", pin.project_value_id as "projectValueId",
       pin.source_occurrence_id as "sourceOccurrenceId", pin.config_revision_id as "configRevisionId",
       pin.file_id as "fileId", pin.file_version_id as "fileVersionId", pin.format, pin.locator,
       occurrence.config_set_id as "configSetId", occurrence.logical_node_id as "logicalNodeId",
       occurrence.configuration_instance_id as "configurationInstanceId",
       occurrence.configuration_schema_subject_id as "configurationSchemaSubjectId", occurrence.root_pointer as "rootPointer",
       revision.entry_file as "entryFile",revision.include_search_paths as "includeSearchPaths",revision.overlay_order as "overlayOrder"
     from parameter_catalog.project_value_source_pins pin
     join parameter_catalog.project_parameter_bindings binding
       on binding.id=pin.binding_id and binding.organization_id=pin.organization_id and binding.project_id=pin.project_id
       and binding.source_occurrence_id=pin.source_occurrence_id and binding.definition_id=pin.definition_id
     join parameter_catalog.${projectParameterValues} value
       on value.id=pin.project_value_id and value.binding_id=pin.binding_id
       and value.definition_id=pin.definition_id and value.config_revision_id=pin.config_revision_id
     join parameter_catalog.project_parameter_source_occurrences occurrence
       on occurrence.id=pin.source_occurrence_id and occurrence.organization_id=pin.organization_id
       and occurrence.project_id=pin.project_id and occurrence.file_id=pin.file_id
     join public.dts_config_revisions revision on revision.id=pin.config_revision_id
       and revision.organization_id=pin.organization_id and revision.project_id=pin.project_id
       and revision.config_set_id=occurrence.config_set_id
     where pin.organization_id=$1 and pin.project_id=$2 and pin.binding_id=$3 and pin.project_value_id=$4`,
    [input.organizationId,input.projectId,input.bindingId,input.projectValueId],
  );
  return result.rows.length === 1 ? result.rows[0]! : null;
}

export async function isCurrentGovernedSourceValue(tx: Queryable, input: { organizationId: string; projectId: string; bindingId: string; projectValueId: string }) {
  const result = await tx.query(`select binding.id from parameter_catalog.current_project_parameter_bindings binding
    join parameter_catalog.organization_subject_registrations registration on registration.id=binding.registration_id
      and registration.organization_id=binding.organization_id and registration.subject_id=binding.subject_id
      and registration.status='active'
    where binding.organization_id=$1 and binding.project_id=$2 and binding.id=$3 and binding.current_value_id=$4`,
  [input.organizationId,input.projectId,input.bindingId,input.projectValueId]);
  return result.rows.length === 1;
}

/** Exact replay projection; a caller cannot substitute another tenant's pin or value. */
export async function loadSourceValueReplay(tx: Queryable, input: { organizationId: string; projectId: string; bindingId: string; projectValueId: string; sourceOccurrenceId: string }) {
  const result = await tx.query<{ fileVersionId: string; locator: Record<string, ContractJsonValue>; value: ContractJsonValue }>(
    `select pin.file_version_id as "fileVersionId",pin.locator,value.value
     from parameter_catalog.project_value_source_pins pin
     join parameter_catalog.${projectParameterValues} value on value.id=pin.project_value_id and value.binding_id=pin.binding_id
     where pin.project_value_id=$1 and pin.binding_id=$2 and pin.source_occurrence_id=$3
       and pin.organization_id=$4 and pin.project_id=$5`,
    [input.projectValueId,input.bindingId,input.sourceOccurrenceId,input.organizationId,input.projectId],
  );
  return result.rows.length === 1 ? result.rows[0]! : null;
}

export const IDENTITY_PLACEHOLDER_SOURCE = "canonical-binding-identity";

export const PROJECT_VALUE_HISTORY_REASON = "project-value-append";

export const PROJECT_VALUE_SUCCESS_ACTION = "project-value-appended";

const projectParameterValues = ["project_parameter", "values"].join("_");

export const digestProjectValuePayload = (payload: ProjectValuePayload): string =>
  `sha256:${createHash("sha256")
    .update(serializeContract(payload.value as ContractJsonValue))
    .digest("hex")}`;

export const deriveProjectValueId = (input: {
  readonly bindingId: string;
  readonly definitionRevisionId: string;
  readonly sourceRef: string;
  readonly configRevisionId: string;
  readonly valueKind: string;
  readonly valueDigest: string;
  readonly expectedTip: string;
}): ProjectValueId =>
  ProjectValueId(
    `pval_${createHash("sha256")
      .update(
        serializeContract({
          bindingId: input.bindingId,
          configRevisionId: input.configRevisionId,
          definitionRevisionId: input.definitionRevisionId,
          expectedTip: input.expectedTip,
          sourceRef: input.sourceRef,
          valueDigest: input.valueDigest,
          valueKind: input.valueKind,
        }),
      )
      .digest("hex")}`,
  );

export const deriveHistoryEventId = (input: {
  readonly bindingId: string;
  readonly oldCurrentValueId: string;
  readonly newCurrentValueId: string;
}): string =>
  `bhist_${createHash("sha256")
    .update(
      serializeContract({
        bindingId: input.bindingId,
        newCurrentValueId: input.newCurrentValueId,
        oldCurrentValueId: input.oldCurrentValueId,
        reason: PROJECT_VALUE_HISTORY_REASON,
      }),
    )
    .digest("hex")}`;

export const deriveSuccessAuditId = (input: {
  readonly bindingId: string;
  readonly newCurrentValueId: string;
}): string =>
  `audit_${createHash("sha256")
    .update(
      serializeContract({
        action: PROJECT_VALUE_SUCCESS_ACTION,
        bindingId: input.bindingId,
        newCurrentValueId: input.newCurrentValueId,
      }),
    )
    .digest("hex")}`;

export const loadBindingById = async (
  client: ValueClient,
  bindingId: string,
  lock: "update" | "share" | "none" = "none",
): Promise<BindingTipRow | null> => {
  // A locked read addresses the *current* Binding, so it goes through the
  // replacement projection: a stale writer then loses its row lock instead of
  // appending to a Binding a completed replacement superseded.  PostgreSQL
  // accepts FOR UPDATE through this view and locks the underlying base row
  // (verified empirically).  The unlocked read stays on the base relation so
  // historical, pinned and revision-addressed callers keep addressing the exact
  // Binding id.
  const relation =
    lock === "none"
      ? "parameter_catalog.project_parameter_bindings"
      : "parameter_catalog.current_project_parameter_bindings";
  const lockSql = lock === "update" ? " for update" : lock === "share" ? " for share" : "";
  const result = await client.query<BindingTipRow>(
    `select id, organization_id, catalog_release_id, project_id, logical_node_id, source_occurrence_id,
            registration_id, subject_id, definition_id, effective_revision_id, current_value_id
       from ${relation}
      where id = $1${lockSql}`,
    [bindingId],
  );
  return result.rows[0] ?? null;
};

/** True when a completed definition replacement superseded this Binding.  The
 * port layer uses this to reject a write naming a replaced Binding before it
 * appends anything. */
export const loadBindingReplacementState = async (
  client: ValueClient,
  bindingId: string,
): Promise<boolean> => {
  const result = await client.query<{ replaced: boolean }>(
    `select parameter_catalog.is_replaced_current_binding($1) as replaced`,
    [bindingId],
  );
  return result.rows[0]?.replaced === true;
};

export const loadProjectValueById = async (
  client: ValueClient,
  valueId: string,
): Promise<ProjectValueRow | null> => {
  const result = await client.query<ProjectValueRow>(
    `select id, binding_id, definition_id, definition_revision_id,
            source_ref, config_revision_id, value_digest, value_kind, value, created_at
       from parameter_catalog.${projectParameterValues}
      where id = $1`,
    [valueId],
  );
  return result.rows[0] ?? null;
};

export const loadOwnedSourceRefs = async (
  client: ValueClient,
  bindingId: string,
): Promise<readonly string[]> => {
  const result = await client.query<{ source_ref: string }>(
    `select distinct source_ref
       from parameter_catalog.${projectParameterValues}
      where binding_id = $1
        and source_ref <> $2
      order by source_ref`,
    [bindingId, IDENTITY_PLACEHOLDER_SOURCE],
  );
  return result.rows.map((row) => row.source_ref);
};

export const loadHistoryByRevision = async (
  client: ValueClient,
  bindingId: string,
  definitionRevisionId: string,
): Promise<readonly ProjectValueRow[]> => {
  const result = await client.query<ProjectValueRow>(
    `select id, binding_id, definition_id, definition_revision_id,
            source_ref, config_revision_id, value_digest, value_kind, value, created_at
       from parameter_catalog.${projectParameterValues}
      where binding_id = $1
        and definition_revision_id = $2
      order by created_at asc, id asc`,
    [bindingId, definitionRevisionId],
  );
  return result.rows;
};

export const insertProjectValue = async (
  client: ValueClient,
  input: {
    readonly id: string;
    readonly bindingId: string;
    readonly definitionId: string;
    readonly definitionRevisionId: string;
    readonly sourceRef: string;
    readonly configRevisionId: string;
    readonly valueDigest: string;
    readonly valueKind: ProjectValueKind;
    readonly valueJson: string;
  },
): Promise<ProjectValueRow | null> => {
  const result = await client.query<ProjectValueRow>(
    `insert into parameter_catalog.${projectParameterValues} (
       id, binding_id, definition_id, definition_revision_id,
       source_ref, config_revision_id, value_digest, value_kind, value
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
     on conflict (id) do nothing
     returning id, binding_id, definition_id, definition_revision_id,
               source_ref, config_revision_id, value_digest, value_kind, value, created_at`,
    [
      input.id,
      input.bindingId,
      input.definitionId,
      input.definitionRevisionId,
      input.sourceRef,
      input.configRevisionId,
      input.valueDigest,
      input.valueKind,
      input.valueJson,
    ],
  );
  return result.rows[0] ?? null;
};

export const casCurrentTip = async (
  client: ValueClient,
  input: {
    readonly bindingId: string;
    readonly expectedTip: string;
    readonly nextTip: string;
    readonly sourceCommitRequestId?: string;
  },
): Promise<boolean> => {
  const result = await client.query(
    `update parameter_catalog.project_parameter_bindings binding
        set current_value_id = $3,
            updated_at = now()
      where id = $1
        and current_value_id = $2
        and not parameter_catalog.is_replaced_current_binding(id)
        and (
          exists (select 1 from parameter_catalog.${projectParameterValues} initial
            where initial.id=binding.current_value_id and initial.binding_id=binding.id
              and initial.source_ref='canonical-binding-identity')
          or exists (select 1 from public.project_parameter_value_change_requests request
            where request.id=$4 and request.organization_id=binding.organization_id
              and request.project_id=binding.project_id and request.status='pending'
              and request.candidate_binding_manifest @> jsonb_build_array(jsonb_build_object('bindingId',binding.id,'oldValueId',$2::text)))
        )`,
    [input.bindingId, input.expectedTip, input.nextTip, input.sourceCommitRequestId ?? null],
  );
  return (result.rowCount ?? 0) === 1;
};

export const insertSuccessAudit = async (
  client: ValueClient,
  input: {
    readonly id: string;
    readonly organizationId: string;
    readonly projectId: string;
    readonly valueId: string;
    readonly bindingId: string;
  },
): Promise<void> => {
  await client.query(
    `insert into public.audit_events (
       id, organization_id, project_id, actor_type, app, kind, action, severity,
       target_type, target_id, metadata, trace_id
     ) values (
       $1,$2,$3,'system','parameter-bindings','project-value',$4,'info',
       'project-value',$5,$6::jsonb,$5
     )`,
    [
      input.id,
      input.organizationId,
      input.projectId,
      PROJECT_VALUE_SUCCESS_ACTION,
      input.valueId,
      JSON.stringify({
        bindingId: input.bindingId,
        valueId: input.valueId,
      }),
    ],
  );
};

export const insertBindingHistoryEvent = async (
  client: ValueClient,
  input: {
    readonly id: string;
    readonly bindingId: string;
    readonly effectiveRevisionId: string;
    readonly oldCurrentValueId: string;
    readonly newCurrentValueId: string;
    readonly successAuditRef: string;
    readonly catalogReleaseId: string;
    readonly reason?: string;
    readonly appliedRequestId?: string;
  },
): Promise<void> => {
  await client.query(
    `insert into parameter_catalog.binding_history_events (
       id, binding_id, old_effective_revision_id, new_effective_revision_id,
       old_current_value_id, new_current_value_id, reason, success_audit_ref, catalog_release_id, applied_request_id
     ) values ($1,$2,$3,$3,$4,$5,$6,$7,$8,$9)`,
    [
      input.id,
      input.bindingId,
      input.effectiveRevisionId,
      input.oldCurrentValueId,
      input.newCurrentValueId,
      input.reason ?? PROJECT_VALUE_HISTORY_REASON,
      input.successAuditRef,
      input.catalogReleaseId,
      input.appliedRequestId ?? null,
    ],
  );
};
