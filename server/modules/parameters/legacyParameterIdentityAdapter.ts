/**
 * Explicit transitional adapter for pre-cutover flat parameter identity.
 *
 * Post-cutover activity code must never call these helpers (they fail closed).
 * Table/column name literals for retired flat identity live only in this module
 * so legacyDependencyGuard can allowlist it alongside migrations/cutovers.
 */

import { randomUUID } from "node:crypto";

import type { AuthContext } from "../auth/types";
import type { Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import {
  isParameterIdentityCutoverComplete,
  legacyParameterIdentityTablesRetired
} from "./cutoverAwareIdentity";
import { LEGACY_IDENTITY_SQL } from "./legacyParameterIdentityNames";

export { LEGACY_IDENTITY_SQL };

async function mustUseSemantic(db: Queryable): Promise<boolean> {
  return (await isParameterIdentityCutoverComplete(db)) || (await legacyParameterIdentityTablesRetired(db));
}

export async function assertPreCutoverParameterIdentity(db: Queryable): Promise<void> {
  if (await mustUseSemantic(db)) {
    throw new ApiError(
      "GONE",
      "Pre-cutover parameter identity adapter is unreachable after identity cutover.",
      410,
      { diagnostic: "legacy-parameter-identity-retired" }
    );
  }
}

/**
 * Pre-cutover only: ensure a linked PPV row exists for typed-edit draft uniqueness
 * that still keys on project_parameter_value_id. Unreachable after cutover.
 */
export async function ensurePreCutoverLinkedParameterValue(
  db: Queryable,
  auth: AuthContext,
  input: {
    projectId: string;
    bindingId: string;
    parameterSpecId: string;
    propertyKey: string;
    currentRaw: string;
  }
): Promise<{ id: string }> {
  await assertPreCutoverParameterIdentity(db);

  const existing = await db.query<{ id: string }>(
    `
    select ppv.id
    from ${LEGACY_IDENTITY_SQL.valuesTable} ppv
    where ppv.organization_id = $1
      and ppv.project_id = $2
      and ppv.source_node_path like '%' || $3
    order by ppv.updated_at desc
    limit 1
    `,
    [auth.organization.id, input.projectId, input.propertyKey]
  );
  if (existing.rows[0]) return { id: existing.rows[0].id };

  const definitionId = randomUUID();
  const ppvId = randomUUID();
  await db.query(
    `
    insert into ${LEGACY_IDENTITY_SQL.definitionsTable} (
      id, organization_id, name, description, explanation, config_format,
      module, default_range, unit, risk
    ) values ($1, $2, $3, '', '', 'dts', 'pre-cutover-link', '', '', 'Low')
    `,
    [definitionId, auth.organization.id, input.propertyKey]
  );
  await db.query(
    `
    insert into ${LEGACY_IDENTITY_SQL.valuesTable} (
      id, organization_id, project_id, parameter_definition_id,
      current_value, ${LEGACY_IDENTITY_SQL.recommendedValueColumn}, value_version, updated_by_user_id,
      source_file_name, source_node_path
    ) values ($1, $2, $3, $4, $5, '', 1, $6, null, $7)
    `,
    [
      ppvId,
      auth.organization.id,
      input.projectId,
      definitionId,
      input.currentRaw,
      auth.user.id,
      `binding/${input.bindingId}/${input.propertyKey}`
    ]
  );
  return { id: ppvId };
}

export async function deletePreCutoverProjectParameterValues(
  db: Queryable,
  input: { organizationId: string; projectId: string }
): Promise<void> {
  await assertPreCutoverParameterIdentity(db);
  await db.query(
    `
    delete from ${LEGACY_IDENTITY_SQL.valuesTable}
    where organization_id = $1
      and project_id = $2
    `,
    [input.organizationId, input.projectId]
  );
}

export async function loadPreCutoverWritebackSource(
  db: Queryable,
  auth: AuthContext,
  input: { projectId: string; parameterDefinitionId: string }
): Promise<{ sourceFileName: string | null; sourceNodePath: string | null } | null> {
  await assertPreCutoverParameterIdentity(db);
  const result = await db.query<{
    source_file_name: string | null;
    source_node_path: string | null;
  }>(
    `
    select source_file_name, source_node_path
    from ${LEGACY_IDENTITY_SQL.valuesTable}
    where organization_id = $1
      and project_id = $2
      and parameter_definition_id = $3
    limit 1
    `,
    [auth.organization.id, input.projectId, input.parameterDefinitionId]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    sourceFileName: row.source_file_name,
    sourceNodePath: row.source_node_path
  };
}

export async function countPreCutoverProjectParameters(
  db: Queryable,
  organizationId: string
): Promise<Map<string, number>> {
  await assertPreCutoverParameterIdentity(db);
  const result = await db.query<{ project_id: string; parameter_count: string }>(
    `
    select project_id, count(*)::int as parameter_count
    from ${LEGACY_IDENTITY_SQL.valuesTable}
    where organization_id = $1
    group by project_id
    `,
    [organizationId]
  );
  return new Map(result.rows.map((row) => [row.project_id, Number(row.parameter_count)]));
}
