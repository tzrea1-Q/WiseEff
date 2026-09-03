import { createHash } from "node:crypto";

import type pg from "pg";

import {
  serializeContract,
  ProjectValueId,
  type ContractJsonValue,
} from "../../parameter-catalog-contract/index";
import type { ProjectValueKind, ProjectValuePayload } from "./types";

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
  logical_node_id: string;
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
  const lockSql = lock === "update" ? " for update" : lock === "share" ? " for share" : "";
  const result = await client.query<BindingTipRow>(
    `select id, organization_id, catalog_release_id, project_id, logical_node_id,
            registration_id, subject_id, definition_id, effective_revision_id, current_value_id
       from parameter_catalog.project_parameter_bindings
      where id = $1${lockSql}`,
    [bindingId],
  );
  return result.rows[0] ?? null;
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
  },
): Promise<boolean> => {
  const result = await client.query(
    `update parameter_catalog.project_parameter_bindings
        set current_value_id = $3,
            updated_at = now()
      where id = $1
        and current_value_id = $2`,
    [input.bindingId, input.expectedTip, input.nextTip],
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
  },
): Promise<void> => {
  await client.query(
    `insert into parameter_catalog.binding_history_events (
       id, binding_id, old_effective_revision_id, new_effective_revision_id,
       old_current_value_id, new_current_value_id, reason, success_audit_ref, catalog_release_id
     ) values ($1,$2,$3,$3,$4,$5,$6,$7,$8)`,
    [
      input.id,
      input.bindingId,
      input.effectiveRevisionId,
      input.oldCurrentValueId,
      input.newCurrentValueId,
      PROJECT_VALUE_HISTORY_REASON,
      input.successAuditRef,
      input.catalogReleaseId,
    ],
  );
};
