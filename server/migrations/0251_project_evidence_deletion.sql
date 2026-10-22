-- Owner decision D1: project-owned deployment and offline migration evidence
-- follows project deletion. Retained objects are still checked through the
-- existing durable cleanup receipt and reference fence.
create or replace function parameter_catalog.purge_project(p_org text,p_project text,p_actor text,p_digest text) returns void
language plpgsql security definer set search_path=pg_catalog,parameter_catalog,public as $$
declare entry record; keys jsonb; targets jsonb:='{}'; refs text[]; remaining integer; progress boolean;
begin
 perform parameter_catalog.lock_project_erasure(p_org,p_project,p_actor);
 if exists(select 1 from parameter_catalog.project_erasures where organization_id=p_org and project_id=p_project) then return; end if;
 if not exists(select 1 from public.projects where organization_id=p_org and id=p_project) then raise exception using errcode='P0002',message='Project not found'; end if;
 select coalesce(array_agg(distinct storage_key),'{}') into refs from (
   select v.storage_key from public.project_parameter_file_versions v join public.project_parameter_files f on f.id=v.file_id where f.organization_id=p_org and f.project_id=p_project
   union all select storage_key from public.project_parameter_file_candidates where organization_id=p_org and project_id=p_project
   union all select object_ref from public.project_parameter_plane_archives where organization_id=p_org and project_id=p_project
   union all select overlay_source_storage_key from public.dts_reload_runs where organization_id=p_org and project_id=p_project
   union all select overlay_artifact_storage_key from public.dts_reload_runs where organization_id=p_org and project_id=p_project) objects
 where storage_key is not null;
 set constraints all deferred;
 for entry in select * from (values
    (-5,'parameter_catalog.plane_disposal_runs','organization_id=$1 and project_id=$2'),
    (-4,'public.project_parameter_plane_archives','organization_id=$1 and project_id=$2'),
    (-3,'public.dts_reload_device_residue','organization_id=$1 and project_id=$2'),
    (-2,'public.dts_reload_run_targets','reload_run_id in (select id from public.dts_reload_runs where organization_id=$1 and project_id=$2)'),
    (-1,'public.dts_reload_runs','organization_id=$1 and project_id=$2'),
    (0,'public.parameter_review_decisions','request_id in (select id from public.parameter_change_requests where organization_id=$1 and project_id=$2)'),
    (1,'public.parameter_submission_items','submission_round_id in (select id from public.parameter_submission_rounds where organization_id=$1 and project_id=$2)'),
    (2,'public.parameter_file_sync_conflicts','organization_id=$1 and project_id=$2'),
    (3,'public.project_parameter_value_change_targets','organization_id=$1 and project_id=$2'),
    (4,'public.project_parameter_value_drafts','organization_id=$1 and project_id=$2'),
    (5,'parameter_catalog.binding_history_events','binding_id in (select id from parameter_catalog.project_parameter_bindings where organization_id=$1 and project_id=$2)'),
    (6,'public.project_parameter_value_change_requests','organization_id=$1 and project_id=$2'),
    (7,'parameter_catalog.project_source_member_tombstones','organization_id=$1 and project_id=$2'),
    (8,'parameter_catalog.project_value_source_pins','organization_id=$1 and project_id=$2'),
    (9,'parameter_catalog.parameter_review_evidence','organization_id=$1 and observation_id in (select id from parameter_catalog.parameter_observations where organization_id=$1 and project_id=$2)'),
    (10,'parameter_catalog.parameter_observation_matches','organization_id=$1 and project_id=$2'),
    (11,'parameter_catalog.parameter_observations','organization_id=$1 and project_id=$2'),
    (12,'parameter_catalog.definition_replacement_projects','organization_id=$1 and project_id=$2'),
    (13,'parameter_catalog.project_parameter_values','binding_id in (select id from parameter_catalog.project_parameter_bindings where organization_id=$1 and project_id=$2)'),
    (14,'parameter_catalog.project_parameter_bindings','organization_id=$1 and project_id=$2'),
    (15,'parameter_catalog.project_parameter_source_occurrences','organization_id=$1 and project_id=$2'),
    (16,'public.parameter_drafts','organization_id=$1 and project_id=$2'),
    (17,'public.parameter_draft_identity_invalidations','organization_id=$1 and project_id=$2'),
    (18,'public.parameter_history_entries','organization_id=$1 and project_id=$2'),
    (19,'public.parameter_change_requests','organization_id=$1 and project_id=$2'),
    (20,'public.parameter_submission_rounds','organization_id=$1 and project_id=$2'),
    (21,'public.parameter_import_batches','organization_id=$1 and project_id=$2'),
    (22,'public.project_parameter_initialization_reviews','organization_id=$1 and project_id=$2'),
    (23,'public.project_parameter_initialization_drafts','organization_id=$1 and project_id=$2'),
    (24,'public.identity_mapping_tasks','organization_id=$1 and project_id=$2'),
    (25,'public.parameter_spec_review_tasks','organization_id=$1 and project_id=$2'),
    (26,'public.dts_property_occurrence_spec_decisions','organization_id=$1 and project_id=$2'),
    (27,'public.parameter_spec_matcher_overrides','organization_id=$1 and project_id=$2'),
    (28,'public.dts_sensitive_node_rules','organization_id=$1 and project_id=$2'),
    (29,'public.project_parameter_binding_revisions','binding_id in (select id from public.project_parameter_bindings where organization_id=$1 and project_id=$2)'),
    (30,'public.project_parameter_bindings','organization_id=$1 and project_id=$2'),
    (31,'public.project_parameter_values','organization_id=$1 and project_id=$2'),
    (32,'public.dts_release_baseline_members','baseline_id in (select id from public.dts_release_baseline where config_set_id in (select id from public.dts_config_set where organization_id=$1 and project_id=$2))'),
    (33,'public.dts_release_baseline','config_set_id in (select id from public.dts_config_set where organization_id=$1 and project_id=$2)'),
    (34,'public.dts_validation_diagnostics','validation_run_id in (select id from public.dts_validation_runs where config_revision_id in (select id from public.dts_config_revisions where organization_id=$1 and project_id=$2))'),
    (35,'public.dts_validation_runs','config_revision_id in (select id from public.dts_config_revisions where organization_id=$1 and project_id=$2)'),
    (36,'public.dts_occurrence_effects','config_revision_id in (select id from public.dts_config_revisions where organization_id=$1 and project_id=$2)'),
    (37,'public.dts_property_occurrences','config_revision_id in (select id from public.dts_config_revisions where organization_id=$1 and project_id=$2)'),
    (38,'public.dts_node_occurrences','config_revision_id in (select id from public.dts_config_revisions where organization_id=$1 and project_id=$2)'),
    (39,'public.dts_logical_node_revisions','config_revision_id in (select id from public.dts_config_revisions where organization_id=$1 and project_id=$2)'),
    (40,'public.dts_config_revision_members','config_revision_id in (select id from public.dts_config_revisions where organization_id=$1 and project_id=$2)'),
    (41,'public.dts_config_revisions','organization_id=$1 and project_id=$2'),
    (42,'public.dts_logical_nodes','organization_id=$1 and project_id=$2'),
    (43,'public.project_parameter_file_candidates','organization_id=$1 and project_id=$2'),
    (44,'public.dts_phandle_refs','from_property_id in (select p.id from public.dts_properties p join public.dts_nodes n on n.id=p.node_id join public.project_parameter_file_versions v on v.id=n.file_version_id join public.project_parameter_files f on f.id=v.file_id where f.organization_id=$1 and f.project_id=$2)'),
    (45,'public.dts_properties','node_id in (select n.id from public.dts_nodes n join public.project_parameter_file_versions v on v.id=n.file_version_id join public.project_parameter_files f on f.id=v.file_id where f.organization_id=$1 and f.project_id=$2)'),
    (46,'public.dts_nodes','file_version_id in (select v.id from public.project_parameter_file_versions v join public.project_parameter_files f on f.id=v.file_id where f.organization_id=$1 and f.project_id=$2)'),
    (47,'public.project_parameter_file_versions','file_id in (select id from public.project_parameter_files where organization_id=$1 and project_id=$2)'),
    (48,'public.project_parameter_files','organization_id=$1 and project_id=$2'),
    (49,'public.dts_config_set','organization_id=$1 and project_id=$2'),
    (50,'public.project_modules','organization_id=$1 and project_id=$2'),
    (51,'public.projects','organization_id=$1 and id=$2')
 ) owned(position,relation_name,predicate) order by position loop
   execute format('select coalesce(jsonb_agg(parameter_catalog.definition_purge_key(%L::regclass,to_jsonb(r))),''[]'') from %s r where %s',entry.relation_name,entry.relation_name,entry.predicate) into keys using p_org,p_project;
   targets:=targets||jsonb_build_object(entry.relation_name,keys);
   perform parameter_catalog.definition_purge_mark(entry.relation_name::regclass,keys,'DELETE');
 end loop;
 -- Detach surviving provenance; do not rewrite the independent object's content.
 select coalesce(jsonb_agg(parameter_catalog.definition_purge_key('parameter_catalog.project_parameter_values',to_jsonb(v))),'[]') into keys
 from parameter_catalog.project_parameter_values v where replaced_from_value_id in (
   select value->>'id' from jsonb_array_elements(targets->'parameter_catalog.project_parameter_values'));
 perform parameter_catalog.definition_purge_mark('parameter_catalog.project_parameter_values',keys,'UPDATE');
 update parameter_catalog.project_parameter_values set replaced_from_value_id=null,replaced_from_definition_id=null
 where keys @> jsonb_build_array(parameter_catalog.definition_purge_key('parameter_catalog.project_parameter_values',to_jsonb(project_parameter_values)));
 update public.debug_nodes set canonical_binding_id=null,canonical_project_id=null where organization_id=p_org and canonical_project_id=p_project;
 update public.node_operations set canonical_binding_id=null,canonical_project_id=null,canonical_pin=null,project_parameter_binding_id=null
 where organization_id=p_org and (canonical_project_id=p_project or project_parameter_binding_id in (select id from public.project_parameter_bindings where organization_id=p_org and project_id=p_project));
 update public.log_records set related_parameter_project_id=null where organization_id=p_org and related_parameter_project_id=p_project;
 update public.agent_sessions set project_id=null where organization_id=p_org and project_id=p_project;
 update public.agent_tool_calls set project_id=null where organization_id=p_org and project_id=p_project;
 update public.agent_approvals set project_id=null where organization_id=p_org and project_id=p_project;
 delete from public.user_role_bindings where organization_id=p_org and project_id=p_project;
 -- Completed legacy cutovers keep their run history, detached from this project.
 delete from public.parameter_spec_version_cutover_items where project_id=p_project;
 delete from public.parameter_spec_property_key_cutover_items where project_id=p_project;
 -- Exact closed rows only; FK ordering is retried for an acyclic dependency
 -- that may differ between populated supported upgrades. Unknown references fail closed.
 loop
   progress:=false;
   for entry in select key relation_name,value keys from jsonb_each(targets) where value<>'[]'::jsonb loop
     begin
       execute format('delete from %s r where $1 @> jsonb_build_array(parameter_catalog.definition_purge_key(%L::regclass,to_jsonb(r)))',entry.relation_name,entry.relation_name) using entry.keys;
       targets:=targets-entry.relation_name;
       progress:=true;
     exception when foreign_key_violation then null;
     end;
   end loop;
   select count(*) into remaining from jsonb_each(targets) where value<>'[]'::jsonb;
   exit when remaining=0;
   if not progress then raise exception using errcode='23503',message='Project has retained references outside its deletion scope',detail=targets::text; end if;
 end loop;
 select coalesce(array_agg(ref),'{}') into refs from unnest(refs) ref where not parameter_catalog.definition_erasure_object_is_referenced('plane',ref);
 insert into parameter_catalog.project_erasures(organization_id,project_id,preview_digest,erased_by,pending_object_refs) values(p_org,p_project,p_digest,p_actor,refs);
 delete from parameter_catalog.definition_purge_rows where transaction_id=txid_current();
end; $$;

-- Extend only the existing NOLOGIN definer's ownership closure.
grant select,delete on public.project_parameter_plane_archives,public.dts_reload_runs,
 public.dts_reload_run_targets,public.dts_reload_device_residue to catalog_migration_owner;
