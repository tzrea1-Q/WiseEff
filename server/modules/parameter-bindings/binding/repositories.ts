import { createHash } from "node:crypto";

import type pg from "pg";

import {
  serializeContract,
  ParameterBindingId,
  ProjectValueId,
} from "../../parameter-catalog-contract/index";

export type BindingWriterClient = {
  query: pg.PoolClient["query"];
};

export type BindingRow = {
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

export type RegistrationAgreementRow = {
  id: string;
  organization_id: string;
  subject_id: string;
  status: "active" | "retired";
};

export const IDENTITY_PLACEHOLDER_SOURCE = "canonical-binding-identity";

export const deriveBindingId = (input: {
  readonly organizationId: string;
  readonly projectId: string;
  readonly logicalNodeId: string;
  readonly registrationId: string;
  readonly subjectId: string;
  readonly definitionId: string;
}): ParameterBindingId =>
  ParameterBindingId(
    `pbind_${createHash("sha256")
      .update(
        serializeContract({
          definitionId: input.definitionId,
          logicalNodeId: input.logicalNodeId,
          organizationId: input.organizationId,
          projectId: input.projectId,
          registrationId: input.registrationId,
          subjectId: input.subjectId,
        }),
      )
      .digest("hex")}`,
  );

export const derivePlaceholderValueId = (bindingId: string): ProjectValueId =>
  ProjectValueId(
    `pval_${createHash("sha256")
      .update(serializeContract({ bindingId, source: IDENTITY_PLACEHOLDER_SOURCE }))
      .digest("hex")}`,
  );

export const placeholderValueDigest = (): string =>
  `sha256:${createHash("sha256").update(serializeContract({})).digest("hex")}`;

export const loadProjectOwner = async (
  client: BindingWriterClient,
  projectId: string,
  organizationId: string,
): Promise<boolean> => {
  const result = await client.query(
    `select 1
       from public.projects
      where id = $1
        and organization_id = $2
      for share`,
    [projectId, organizationId],
  );
  return result.rows.length === 1;
};

export const loadRegistrationForAgreement = async (
  client: BindingWriterClient,
  registrationId: string,
): Promise<RegistrationAgreementRow | null> => {
  const result = await client.query<RegistrationAgreementRow>(
    `select id, organization_id, subject_id, status
       from parameter_catalog.organization_subject_registrations
      where id = $1
      for update`,
    [registrationId],
  );
  return result.rows[0] ?? null;
};

export const loadBindingByComposite = async (
  client: BindingWriterClient,
  input: {
    readonly projectId: string;
    readonly logicalNodeId: string;
    readonly definitionId: string;
  },
): Promise<BindingRow | null> => {
  const result = await client.query<BindingRow>(
    `select id, organization_id, catalog_release_id, project_id, logical_node_id,
            registration_id, subject_id, definition_id, effective_revision_id, current_value_id
       from parameter_catalog.project_parameter_bindings
      where project_id = $1
        and logical_node_id = $2
        and definition_id = $3
      for update`,
    [input.projectId, input.logicalNodeId, input.definitionId],
  );
  return result.rows[0] ?? null;
};

export const insertBinding = async (
  client: BindingWriterClient,
  input: {
    readonly id: string;
    readonly organizationId: string;
    readonly catalogReleaseId: string;
    readonly projectId: string;
    readonly logicalNodeId: string;
    readonly registrationId: string;
    readonly subjectId: string;
    readonly definitionId: string;
    readonly effectiveRevisionId: string;
    readonly currentValueId: string;
  },
): Promise<BindingRow | null> => {
  const result = await client.query<BindingRow>(
    `insert into parameter_catalog.project_parameter_bindings (
       id, organization_id, catalog_release_id, project_id, logical_node_id,
       registration_id, subject_id, definition_id, effective_revision_id, current_value_id
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     on conflict (project_id, logical_node_id, definition_id) do nothing
     returning id, organization_id, catalog_release_id, project_id, logical_node_id,
               registration_id, subject_id, definition_id, effective_revision_id, current_value_id`,
    [
      input.id,
      input.organizationId,
      input.catalogReleaseId,
      input.projectId,
      input.logicalNodeId,
      input.registrationId,
      input.subjectId,
      input.definitionId,
      input.effectiveRevisionId,
      input.currentValueId,
    ],
  );
  return result.rows[0] ?? null;
};

export const insertIdentityPlaceholderValue = async (
  client: BindingWriterClient,
  input: {
    readonly id: string;
    readonly bindingId: string;
    readonly definitionId: string;
    readonly definitionRevisionId: string;
  },
): Promise<void> => {
  await client.query(
    `insert into parameter_catalog.project_parameter_values (
       id, binding_id, definition_id, definition_revision_id,
       source_ref, config_revision_id, value_digest, value_kind, value
     ) values ($1,$2,$3,$4,$5,$6,$7,'json','{}'::jsonb)`,
    [
      input.id,
      input.bindingId,
      input.definitionId,
      input.definitionRevisionId,
      IDENTITY_PLACEHOLDER_SOURCE,
      IDENTITY_PLACEHOLDER_SOURCE,
      placeholderValueDigest(),
    ],
  );
};

export const casEffectiveRevision = async (
  client: BindingWriterClient,
  input: {
    readonly id: string;
    readonly expectedEffectiveRevisionId: string;
    readonly nextEffectiveRevisionId: string;
    readonly nextCatalogReleaseId: string;
  },
): Promise<boolean> => {
  const result = await client.query(
    `update parameter_catalog.project_parameter_bindings
        set effective_revision_id = $3,
            catalog_release_id = $4,
            updated_at = now()
      where id = $1
        and effective_revision_id = $2`,
    [
      input.id,
      input.expectedEffectiveRevisionId,
      input.nextEffectiveRevisionId,
      input.nextCatalogReleaseId,
    ],
  );
  return (result.rowCount ?? 0) === 1;
};
