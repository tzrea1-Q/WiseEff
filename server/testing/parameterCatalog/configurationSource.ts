import { randomUUID } from "node:crypto";
import { getRootPostgresPool, type Database, type Queryable } from "../../shared/database/client";
import type { AuthContext } from "../../modules/auth/types";
import { validCatalogReleaseBundle, refreshAuthoritativeSource } from "../../modules/catalog-kernel/compiler/__fixtures__/catalogReleaseBundle";
import { compileCatalogRelease } from "../../modules/catalog-kernel/compiler";
import { jsonCatalogReleaseSource } from "../../modules/catalog-kernel/interface";
import { installPublishedRelease } from "../../modules/catalog-kernel/install/installer";
import { CatalogSubjectId } from "../../modules/parameter-catalog-contract";
import { executeRegistration } from "../../modules/parameter-governance/registration";
import { createParameterModuleForAuth } from "../../modules/parameters/service";

/** Explicit local-test Catalog bootstrap, not publication-manager qualification.
 * Module creation and registration use their actual production owners.
 */
export async function installConfigurationSourceFixture(db: Database, auth: AuthContext, input: { subjectId: string; schemaId: string }) {
  const pool = getRootPostgresPool(db);
  if (!pool) throw new Error("Configuration fixture requires native PostgreSQL");
  const full = validCatalogReleaseBundle();
  const release = structuredClone(full.releases[0]!) as Parameters<typeof refreshAuthoritativeSource>[0];
  for (const document of release.documents) {
    if (document.kind === "subject") {
      document.content = { id: input.subjectId,kind: "configuration-schema",canonicalKey: input.schemaId,lifecycle: "active",
        selector: { kind: "configuration-schema-id",value: input.schemaId,provenance: { source: "issue-849" } },subtype: {},tombstone: null };
    } else if (document.kind === "alias") {
      document.content.subjectId = input.subjectId;
      document.content.selectorKind = "configuration-schema-id";
      document.content.normalizedSelector = `${input.schemaId}.v1`;
    } else {
      document.content.subjectId = input.subjectId;
      document.content.revision.matching.selectorKind = "configuration-schema-id";
      document.content.revision.valueSchema = { type: "number",minimum: 0 };
    }
  }
  refreshAuthoritativeSource(release);
  const bundle = { schemaVersion: full.schemaVersion,targetReleaseId: release.manifest.release.id,releases: [release] };
  const compiled = compileCatalogRelease(bundle);
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.error));
  const installed = await installPublishedRelease(pool,{ mode: "bootstrap",source: jsonCatalogReleaseSource(bundle),expectedTargetDigest: compiled.value.aggregateDigest });
  if (!installed.ok) throw new Error(JSON.stringify(installed.error));
  const module = await createParameterModuleForAuth(db,auth,{ name: "Configuration",kind: "business" });
  const registration = await executeRegistration(pool,{
    kind: "register",organizationId: auth.organization.id,subjectId: CatalogSubjectId(input.subjectId),subjectKind: "configuration-schema",
    expectedRelease: compiled.value.release,placement: { mode: "use-default" },destinationModuleId: module.id,
    method: "explicit",proof: { reason: "T1.1 JSON source" },idempotencyKey: "t11-json-registration",
    context: { actorKind: "org-admin",principalId: auth.user.id },
  });
  if (!registration.ok) throw new Error(JSON.stringify(registration.error));
}

type SourceState = {
  bindings: Array<{ id: string; currentValueId: string }>;
  files: Array<{ id: string; currentVersionId: string | null }>;
  values: Array<{ id: string; bindingId: string; revisionId: string; digest: string }>;
  pins: string[]; history: string[]; revisions: string[]; members: string[]; versions: string[]; candidates: string[];
  drafts: Array<{ id: string; candidateId: string; baseValueId: string; target: unknown }>;
  requests: Array<{ id: string; status: string; appliedValueId: string | null }>;
  audits: Array<{ id: string; target: string; action: string; trace: string }>;
};

/** Fixed, tenant/project-scoped native rollback witness; no caller-supplied SQL or relation names. */
export async function captureConfigurationSourceState(db: Queryable, input: { organizationId: string; projectId: string }): Promise<SourceState> {
  const result = await db.query<SourceState>(`with owned_bindings as (
      select id,current_value_id from parameter_catalog.project_parameter_bindings where organization_id=$1 and project_id=$2
    ), owned_files as (
      select id,current_version_id from project_parameter_files where organization_id=$1 and project_id=$2
    ) select
      (select coalesce(jsonb_agg(jsonb_build_object('id',id,'currentValueId',current_value_id) order by id),'[]') from owned_bindings) as bindings,
      (select coalesce(jsonb_agg(jsonb_build_object('id',id,'currentVersionId',current_version_id) order by id),'[]') from owned_files) as files,
      (select coalesce(jsonb_agg(jsonb_build_object('id',value.id,'bindingId',value.binding_id,'revisionId',value.config_revision_id,'digest',value.value_digest) order by value.id),'[]')
        from parameter_catalog.project_parameter_values value join owned_bindings binding on binding.id=value.binding_id) as values,
      (select coalesce(jsonb_agg(pin.id order by pin.id),'[]') from parameter_catalog.project_value_source_pins pin
        join owned_bindings binding on binding.id=pin.binding_id where pin.organization_id=$1 and pin.project_id=$2) as pins,
      (select coalesce(jsonb_agg(history.id order by history.id),'[]') from parameter_catalog.binding_history_events history
        join owned_bindings binding on binding.id=history.binding_id) as history,
      (select coalesce(jsonb_agg(id order by id),'[]') from dts_config_revisions where organization_id=$1 and project_id=$2) as revisions,
      (select coalesce(jsonb_agg(member.id order by member.id),'[]') from dts_config_revision_members member
        join dts_config_revisions revision on revision.id=member.config_revision_id where revision.organization_id=$1 and revision.project_id=$2) as members,
      (select coalesce(jsonb_agg(version.id order by version.id),'[]') from project_parameter_file_versions version join owned_files file on file.id=version.file_id) as versions,
      (select coalesce(jsonb_agg(id order by id),'[]') from project_parameter_file_candidates where organization_id=$1 and project_id=$2) as candidates,
      (select coalesce(jsonb_agg(jsonb_build_object('id',id,'candidateId',candidate_id,'baseValueId',base_current_value_id,'target',target_value) order by id),'[]')
        from project_parameter_value_drafts where organization_id=$1 and project_id=$2) as drafts,
      (select coalesce(jsonb_agg(jsonb_build_object('id',id,'status',status,'appliedValueId',applied_value_id) order by id),'[]')
        from project_parameter_value_change_requests where organization_id=$1 and project_id=$2) as requests,
      (select coalesce(jsonb_agg(jsonb_build_object('id',id,'target',target_id,'action',action,'trace',trace_id) order by id),'[]')
        from audit_events where organization_id=$1 and project_id=$2) as audits`, [input.organizationId,input.projectId]);
  return result.rows[0]!;
}

/** Native historical-state counterexample, only inside a caller-owned rollback probe.
 * The new revision shares genuine immutable member bytes with its predecessor;
 * only one sibling moves, reproducing a mixed-revision cohort without corrupting a pin.
 */
export async function seedMixedRevisionCohortProbe(
  tx: Queryable,
  input: { organizationId: string; projectId: string; bindingId: string; projectValueId: string },
) {
  const previous = (await tx.query<{ config_revision_id: string }>(
    `select pin.config_revision_id from parameter_catalog.project_value_source_pins pin
     join parameter_catalog.current_project_parameter_bindings binding on binding.id=pin.binding_id
       and binding.current_value_id=pin.project_value_id
     where pin.organization_id=$1 and pin.project_id=$2 and pin.binding_id=$3 and pin.project_value_id=$4 and pin.format='json'`,
    [input.organizationId,input.projectId,input.bindingId,input.projectValueId],
  )).rows;
  if (previous.length !== 1) throw new Error("Mixed-cohort fixture requires one exact current source pin");
  const revisionId = randomUUID();
  const valueId = randomUUID();
  await tx.query(`insert into dts_config_revisions(id,organization_id,project_id,config_set_id,revision_number,status,
    created_by_user_id,entry_file,include_search_paths,overlay_order,manifest_state)
    select $1,organization_id,project_id,config_set_id,
      (select max(other.revision_number)+1 from dts_config_revisions other where other.config_set_id=revision.config_set_id),
      status,created_by_user_id,entry_file,include_search_paths,overlay_order,manifest_state
    from dts_config_revisions revision where id=$2`, [revisionId,previous[0]!.config_revision_id]);
  await tx.query(`insert into dts_config_revision_members(id,config_revision_id,file_id,file_version_id,role,sort_order,source_name)
    select $1||':'||id,$1,file_id,file_version_id,role,sort_order,source_name from dts_config_revision_members where config_revision_id=$2`,
    [revisionId,previous[0]!.config_revision_id]);
  await tx.query(`insert into parameter_catalog.project_parameter_values(id,binding_id,definition_id,definition_revision_id,source_ref,config_revision_id,value_digest,value_kind,value)
    select $1,binding_id,definition_id,definition_revision_id,source_ref,$2,value_digest,value_kind,value
    from parameter_catalog.project_parameter_values where id=$3 and binding_id=$4`,
    [valueId,revisionId,input.projectValueId,input.bindingId]);
  await tx.query(`insert into parameter_catalog.project_value_source_pins(id,project_value_id,binding_id,definition_id,organization_id,project_id,
    source_occurrence_id,config_revision_id,file_id,file_version_id,format,property_occurrence_id,locator,locator_digest)
    select $1,$2,binding_id,definition_id,organization_id,project_id,source_occurrence_id,$3,file_id,file_version_id,format,property_occurrence_id,locator,locator_digest
    from parameter_catalog.project_value_source_pins where project_value_id=$4 and binding_id=$5 and format='json'`,
    [randomUUID(),valueId,revisionId,input.projectValueId,input.bindingId]);
  await tx.query(`update parameter_catalog.project_parameter_bindings set current_value_id=$1
    where id=$2 and organization_id=$3 and project_id=$4 and current_value_id=$5`,
    [valueId,input.bindingId,input.organizationId,input.projectId,input.projectValueId]);
  await tx.query("set constraints all immediate");
}
