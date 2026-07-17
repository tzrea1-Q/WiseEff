import type { Client } from "pg";

import { withPgClient } from "./database";

export type SemanticFixtureCleanupScope = {
  organizationId: string;
  projectId: string;
  configSetNames?: string[];
  fileNames?: string[];
  parameterSpecIds?: string[];
  projectParameterValueIds?: string[];
};

async function deleteChangeRequestChain(
  client: Client,
  projectParameterValueIds: string[]
): Promise<void> {
  if (projectParameterValueIds.length === 0) return;

  const requests = await client.query<{ id: string; submission_round_id: string | null }>(
    `
    select id, submission_round_id
    from parameter_change_requests
    where project_parameter_value_id = any($1::text[])
    `,
    [projectParameterValueIds]
  );
  const requestIds = requests.rows.map((row) => row.id);
  const roundIds = Array.from(
    new Set(requests.rows.map((row) => row.submission_round_id).filter((id): id is string => Boolean(id)))
  );
  if (requestIds.length === 0) return;

  await client.query(`delete from parameter_review_decisions where request_id = any($1::text[])`, [requestIds]);
  await client.query(`delete from parameter_submission_items where change_request_id = any($1::text[])`, [
    requestIds
  ]);
  await client.query(`delete from parameter_history_entries where request_id = any($1::text[])`, [requestIds]);
  await client.query(`delete from parameter_change_requests where id = any($1::text[])`, [requestIds]);
  if (roundIds.length > 0) {
    await client.query(`delete from parameter_submission_rounds where id = any($1::text[])`, [roundIds]);
  }
}

async function resolveConfigSetIds(
  client: Client,
  organizationId: string,
  projectId: string,
  names: string[]
): Promise<string[]> {
  if (!organizationId?.trim() || !projectId?.trim()) {
    throw new Error("semanticFixtureCleanup requires organizationId and projectId");
  }
  if (names.length === 0) return [];
  const result = await client.query<{ id: string }>(
    `
    select cs.id
    from dts_config_set cs
    inner join projects p
      on p.id = cs.project_id
     and p.organization_id = cs.organization_id
    where cs.organization_id = $1
      and cs.project_id = $2
      and p.id = $2
      and p.organization_id = $1
      and cs.name = any($3::text[])
    `,
    [organizationId, projectId, names]
  );
  return result.rows.map((row) => row.id);
}

async function resolveFileIds(
  client: Client,
  organizationId: string,
  projectId: string,
  fileNames: string[],
  configSetIds: string[]
): Promise<string[]> {
  if (fileNames.length === 0 && configSetIds.length === 0) return [];
  const result = await client.query<{ id: string }>(
    `
    select id
    from project_parameter_files
    where organization_id = $1
      and project_id = $2
      and (
        file_name = any($3::text[])
        or config_set_id = any($4::text[])
      )
    `,
    [organizationId, projectId, fileNames, configSetIds]
  );
  return result.rows.map((row) => row.id);
}

async function resolveRevisionIds(client: Client, configSetIds: string[]): Promise<string[]> {
  if (configSetIds.length === 0) return [];
  const result = await client.query<{ id: string }>(
    `select id from dts_config_revisions where config_set_id = any($1::text[])`,
    [configSetIds]
  );
  return result.rows.map((row) => row.id);
}

async function resolveVersionIds(client: Client, fileIds: string[]): Promise<string[]> {
  if (fileIds.length === 0) return [];
  const result = await client.query<{ id: string }>(
    `select id from project_parameter_file_versions where file_id = any($1::text[])`,
    [fileIds]
  );
  return result.rows.map((row) => row.id);
}

/**
 * Prefix-scoped, FK-ordered cleanup for semantic/topology acceptance fixtures.
 * Idempotent: safe to run twice; only deletes rows tied to the provided names/IDs.
 */
export async function cleanupSemanticAcceptanceArtifacts(
  scope: SemanticFixtureCleanupScope
): Promise<void> {
  await withPgClient(async (client) => {
    await client.query("begin");
    try {
    const configSetIds = await resolveConfigSetIds(
      client,
      scope.organizationId,
      scope.projectId,
      scope.configSetNames ?? []
    );
    const revisionIds = await resolveRevisionIds(client, configSetIds);
    const fileIds = await resolveFileIds(
      client,
      scope.organizationId,
      scope.projectId,
      scope.fileNames ?? [],
      configSetIds
    );
    const versionIds = await resolveVersionIds(client, fileIds);

    await deleteChangeRequestChain(client, scope.projectParameterValueIds ?? []);

    if (scope.projectParameterValueIds && scope.projectParameterValueIds.length > 0) {
      await client.query(
        `delete from parameter_drafts where project_parameter_value_id = any($1::text[])`,
        [scope.projectParameterValueIds]
      );
      await client.query(
        `delete from parameter_file_sync_conflicts where project_parameter_value_id = any($1::text[])`,
        [scope.projectParameterValueIds]
      );
    }

    if (revisionIds.length > 0) {
      await client.query(
        `
        delete from parameter_spec_matcher_overrides
        where source_review_task_id in (
          select id from parameter_spec_review_tasks where config_revision_id = any($1::text[])
        )
        `,
        [revisionIds]
      );
      await client.query(
        `delete from dts_property_occurrence_spec_decisions where config_revision_id = any($1::text[])`,
        [revisionIds]
      );
      await client.query(`delete from parameter_spec_review_tasks where config_revision_id = any($1::text[])`, [
        revisionIds
      ]);
      await client.query(`delete from identity_mapping_tasks where config_revision_id = any($1::text[])`, [
        revisionIds
      ]);
      await client.query(
        `
        delete from dts_validation_diagnostics
        where validation_run_id in (
          select id from dts_validation_runs where config_revision_id = any($1::text[])
        )
        `,
        [revisionIds]
      );
      await client.query(`delete from dts_validation_runs where config_revision_id = any($1::text[])`, [
        revisionIds
      ]);
      await client.query(
        `delete from project_parameter_binding_revisions where config_revision_id = any($1::text[])`,
        [revisionIds]
      );
      await client.query(
        `
        delete from project_parameter_bindings
        where logical_node_id in (
          select id from dts_logical_nodes where config_set_id = any($1::text[])
        )
        `,
        [configSetIds]
      );
    }

    if (versionIds.length > 0) {
      await client.query(
        `update parameter_drafts set origin_file_version_id = null where origin_file_version_id = any($1::text[])`,
        [versionIds]
      );
      await client.query(
        `
        update parameter_change_requests
        set source_file_version_id = null
        where source_file_version_id = any($1::text[])
        `,
        [versionIds]
      );
      // Review tasks may reference property occurrences (ON DELETE CASCADE). Matcher
      // overrides reference those tasks without cascade, so clear overrides first or
      // occurrence deletes fail when cascading task deletes.
      await client.query(
        `
        delete from parameter_spec_matcher_overrides
        where source_review_task_id in (
          select t.id
          from parameter_spec_review_tasks t
          where t.property_occurrence_id in (
            select id from dts_property_occurrences where file_version_id = any($1::text[])
          )
             or t.config_revision_id in (
               select distinct m.config_revision_id
               from dts_config_revision_members m
               where m.file_version_id = any($1::text[])
             )
        )
        `,
        [versionIds]
      );
      await client.query(
        `
        delete from dts_property_occurrence_spec_decisions
        where review_task_id in (
          select t.id
          from parameter_spec_review_tasks t
          where t.property_occurrence_id in (
            select id from dts_property_occurrences where file_version_id = any($1::text[])
          )
             or t.config_revision_id in (
               select distinct m.config_revision_id
               from dts_config_revision_members m
               where m.file_version_id = any($1::text[])
             )
        )
           or property_occurrence_id in (
             select id from dts_property_occurrences where file_version_id = any($1::text[])
           )
           or config_revision_id in (
             select distinct m.config_revision_id
             from dts_config_revision_members m
             where m.file_version_id = any($1::text[])
           )
        `,
        [versionIds]
      );
      await client.query(
        `
        delete from parameter_spec_review_tasks
        where property_occurrence_id in (
          select id from dts_property_occurrences where file_version_id = any($1::text[])
        )
           or config_revision_id in (
             select distinct m.config_revision_id
             from dts_config_revision_members m
             where m.file_version_id = any($1::text[])
           )
        `,
        [versionIds]
      );
      await client.query(
        `delete from dts_config_revision_members where file_version_id = any($1::text[])`,
        [versionIds]
      );
      await client.query(`delete from dts_property_occurrences where file_version_id = any($1::text[])`, [
        versionIds
      ]);
      await client.query(`delete from dts_node_occurrences where file_version_id = any($1::text[])`, [versionIds]);
    }

    if (fileIds.length > 0) {
      await client.query(
        `
        delete from dts_release_baseline_members
        where file_id = any($1::text[])
           or file_version_id = any($2::text[])
        `,
        [fileIds, versionIds]
      );
      await client.query(
        `
        update project_parameter_files
        set current_version_id = null,
            config_set_id = null,
            config_set_role = null,
            config_set_sort_order = 0
        where id = any($1::text[])
        `,
        [fileIds]
      );
      if (versionIds.length > 0) {
        await client.query(`delete from project_parameter_file_versions where id = any($1::text[])`, [versionIds]);
      }
      await client.query(`delete from project_parameter_files where id = any($1::text[])`, [fileIds]);
    }

    if (configSetIds.length > 0) {
      await client.query(
        `delete from dts_release_baseline where config_set_id = any($1::text[])`,
        [configSetIds]
      );
      await client.query(`delete from dts_config_set where id = any($1::text[])`, [configSetIds]);
    }

    if (scope.parameterSpecIds && scope.parameterSpecIds.length > 0) {
      await client.query(
        `delete from parameter_spec_matcher_overrides where parameter_spec_id = any($1::text[])`,
        [scope.parameterSpecIds]
      );
      await client.query(
        `update parameter_spec_review_tasks set parameter_spec_id = null where parameter_spec_id = any($1::text[])`,
        [scope.parameterSpecIds]
      );
      await client.query(`delete from dts_property_specs where parameter_spec_id = any($1::text[])`, [
        scope.parameterSpecIds
      ]);
      await client.query(`delete from parameter_spec_versions where parameter_spec_id = any($1::text[])`, [
        scope.parameterSpecIds
      ]);
      await client.query(`delete from parameter_specs where id = any($1::text[])`, [scope.parameterSpecIds]);
    }
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    }
  });
}
