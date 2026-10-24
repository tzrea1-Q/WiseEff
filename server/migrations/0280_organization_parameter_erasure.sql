-- Exact pre-IO keys survive an uncertain acknowledgement/transaction outcome.
-- ponytail: keep these small obligations until Organization erasure; reclaim
-- acknowledged keys earlier if sustained upload volume warrants it.
create table public.parameter_object_writes(id text primary key,organization_id text not null,object_ref text not null);
alter table public.parameter_object_writes owner to catalog_migration_owner;
revoke all on public.parameter_object_writes from public;
create function parameter_catalog.reserve_parameter_object_write(p_org text,p_ref text) returns text
language plpgsql security definer set search_path=pg_catalog,public as $$
declare reservation_id text:=gen_random_uuid()::text;
begin
  lock table public.parameter_object_writes in row exclusive mode;
  -- No Organization row lock: an admitted writer may already hold it on the
  -- metadata connection. The eraser fences this receipt table before reading.
  if not exists(select 1 from public.organizations where id=p_org and status='active') then
    raise exception using errcode='55000',message='Organization cannot write parameter objects'; end if;
  insert into public.parameter_object_writes values(reservation_id,p_org,p_ref); return reservation_id;
end $$;
create function parameter_catalog.lock_parameter_object_write(p_id text) returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
declare org text;
begin
  lock table public.parameter_object_writes in row exclusive mode;
  select organization_id into org from public.parameter_object_writes where id=p_id for update;
  if org is null or not exists(select 1 from public.organizations where id=org and status='active') then
    raise exception using errcode='55000',message='Organization cannot write parameter objects'; end if;
end $$;
create table parameter_catalog.catalog_archive_writes(id text primary key,org text not null,object_ref text not null);
alter table parameter_catalog.catalog_archive_writes owner to catalog_migration_owner;
revoke all on parameter_catalog.catalog_archive_writes from public;
create function parameter_catalog.reserve_catalog_archive_write(p_identity text,p_kind text,p_scope text,p_ref text) returns text
language plpgsql security definer set search_path=pg_catalog,public,parameter_catalog as $$
declare org text; reservation_id text:=gen_random_uuid()::text;
begin
  lock table parameter_catalog.catalog_archive_writes in row exclusive mode;
  if not exists(select 1 from parameter_catalog.legacy_identities where id=p_identity and owner_scope_kind=p_kind and owner_scope_id=p_scope) then
    raise exception using errcode='23503',message='Archive owner does not match its identity'; end if;
  if p_kind='platform' then return null; end if;
  if p_kind='organization' then org:=p_scope; elsif p_kind='project' then select organization_id into org from public.projects where id=p_scope; end if;
  if org is null or not exists(select 1 from public.organizations where id=org and status='active') then
    raise exception using errcode='55000',message='Organization cannot create Catalog archives'; end if;
  insert into parameter_catalog.catalog_archive_writes values(reservation_id,org,p_ref);return reservation_id;
end $$;
create function parameter_catalog.lock_catalog_archive_write(p_id text) returns void
language plpgsql security definer set search_path=pg_catalog,public,parameter_catalog as $$
declare target_org text;
begin
  lock table parameter_catalog.catalog_archive_writes in row exclusive mode;
  select org into target_org from parameter_catalog.catalog_archive_writes where id=p_id for update;
  if target_org is null or not exists(select 1 from public.organizations where id=target_org and status='active') then
    raise exception using errcode='55000',message='Organization cannot create Catalog archives'; end if;
end $$;
create table parameter_catalog.organization_parameter_erasure_objects (
  erasure_id text not null references public.organization_erasures(id) on delete restrict,
  store text not null check(store in ('plane','catalog')), object_ref text not null,
  primary key(erasure_id,store,object_ref)
);
alter table parameter_catalog.organization_parameter_erasure_objects owner to catalog_migration_owner;
revoke all on parameter_catalog.organization_parameter_erasure_objects from public;

-- Only this back pointer needs deferral; placement -> registration stays RESTRICT.
alter table parameter_catalog.organization_subject_registrations drop constraint registration_current_placement_fk;
alter table parameter_catalog.organization_subject_registrations add constraint registration_current_placement_fk
  foreign key(id,current_placement_id) references parameter_catalog.subject_placements(registration_id,id) deferrable initially deferred;

-- Reuse the installed project closure, resolving only the two retired physical
-- identities through its existing verified-finalized compatibility boundary.
do $$ declare installed text; changed text; begin
  select pg_get_functiondef('parameter_catalog.lock_project_erasure(text,text,text)'::regprocedure) into strict installed;
  changed:=replace(installed,'    public.project_parameter_values,','');
  changed:=replace(changed,'perform parameter_catalog.require_project_erasure_admin(p_org,p_actor);',
    'execute format(''lock table %s in share row exclusive mode'',parameter_catalog.definition_purge_legacy_relation(''public.project_parameter_values'')); perform parameter_catalog.require_project_erasure_admin(p_org,p_actor);');
  if changed=installed then raise exception 'Project legacy lock seam was not found'; end if; execute changed;
  select pg_get_functiondef('parameter_catalog.purge_project(text,text,text,text)'::regprocedure) into strict installed;
  changed:=replace(installed,'(31,''public.project_parameter_values'',',
    '(31,parameter_catalog.definition_purge_legacy_relation(''public.project_parameter_values''),');
  if changed=installed then raise exception 'Project legacy value closure seam was not found'; end if; execute changed;
  select pg_get_functiondef('parameter_catalog.preview_organization_deletion_0276(text,text)'::regprocedure) into strict installed;
  changed:=replace(installed,'(''public.parameter_definitions'',''organization-parameters'',',
    '(parameter_catalog.definition_purge_legacy_relation(''public.parameter_definitions''),''organization-parameters'',');
  changed:=replace(changed,'(''public.project_parameter_values'',''projects'',',
    '(parameter_catalog.definition_purge_legacy_relation(''public.project_parameter_values''),''projects'',');
  if changed=installed then raise exception 'Organization legacy inventory seam was not found'; end if; execute changed;
end $$;

grant select,update on public.organization_erasures to catalog_migration_owner;
create function parameter_catalog.lock_organization_parameter_erasure(p_id text,p_actor text,p_lease text)
returns text language plpgsql security definer set search_path=pg_catalog,public,parameter_catalog,catalog_publication as $$
declare org text;
begin
  -- Same order as publication/Definition erasure, before any Organization lock.
  perform set_config('lock_timeout','2s',true);
  perform parameter_catalog.acquire_current_pointer_lock_exclusive();
  perform catalog_publication.acquire_publication_guard_lock();
  select target_organization_id into org from public.organization_erasures where id=p_id and status='running'
    and stage='domains' and lease_owner=p_lease and lease_expires_at>clock_timestamp() for update;
  if org is null then raise exception using errcode='55000',message='Current Organization erasure lease is required'; end if;
  if not exists(select 1 from public.users u join public.user_role_bindings r on r.user_id=u.id and r.organization_id=u.organization_id
    join public.roles role on role.id=r.role_id where u.id=p_actor and u.is_active and r.project_id is null and r.role_id='platform-admin'
    and 'platform:access'=any(role.permissions)) then raise exception using errcode='42501',message='Current platform administrator is required'; end if;
  perform set_config('wiseeff.organization_erasure_id',p_id,true);
  perform set_config('wiseeff.organization_erasure_lease',p_lease,true);
  return org;
end $$;

-- Add only fixed parameter-domain operations to the existing deleting fence.
do $$ declare installed text; changed text; begin
  select pg_get_functiondef('public.guard_organization_lifecycle()'::regprocedure) into strict installed;
  changed:=replace(installed,'if state=''deleting'' then', $guard$if state='deleting' then
      if exists(select 1 from public.organization_erasures e where e.target_organization_id=org and e.status='running'
        and e.stage='domains' and e.id=current_setting('wiseeff.organization_erasure_id',true)
        and e.lease_owner=current_setting('wiseeff.organization_erasure_lease',true) and e.lease_expires_at>clock_timestamp()) then
        if tg_op='DELETE' and ((tg_table_schema='parameter_catalog' and tg_table_name=any(array[
          'definition_proposals','definition_proposal_revisions','governance_command_idempotency','organization_subject_registrations','subject_placements',
          'parameter_observations','parameter_observation_matches','parameter_review_items','parameter_review_evidence',
          'project_parameter_bindings','project_parameter_values','project_parameter_source_occurrences','project_value_source_pins',
          'project_source_member_tombstones','binding_history_events'])) or
          (tg_table_schema='public' and tg_table_name=any(array[
          'projects','project_members','project_modules','project_parameter_bindings','project_parameter_values','project_parameter_binding_revisions',
          'project_parameter_files','project_parameter_file_versions','project_parameter_file_candidates','project_parameter_initialization_drafts',
          'project_parameter_initialization_reviews','project_parameter_value_drafts','project_parameter_value_change_requests','project_parameter_value_change_targets',
          'project_parameter_plane_archives','parameter_drafts','parameter_draft_identity_invalidations','parameter_definitions','parameter_change_requests',
          'legacy_parameter_definitions','legacy_project_parameter_values',
          'parameter_history_entries','parameter_import_batches','parameter_file_sync_conflicts','parameter_policy_targets','parameter_review_decisions',
          'parameter_submission_items','parameter_submission_rounds','parameter_modules','parameter_module_mappings','parameter_module_dismissed_compatibles',
          'parameter_specs','parameter_spec_versions','parameter_spec_matcher_overrides','parameter_spec_review_tasks',
          'parameter_spec_property_key_cutover_runs','parameter_spec_property_key_cutover_items','parameter_spec_version_cutover_runs','parameter_spec_version_cutover_items',
          'parameter_definition_reconciliation_items','parameter_definition_reconciliation_runs','legacy_parameter_migration_evidence','attribution_subjects',
          'business_categories','driver_registrations','driver_registration_placements','driver_schemas','driver_schema_versions','driver_schema_overlays',
          'driver_schema_overlay_properties','node_type_definitions','module_recognition_rules','identity_mapping_tasks','dts_config_set','dts_config_revisions',
          'dts_config_revision_members','dts_logical_nodes','dts_logical_node_revisions','dts_node_occurrences','dts_nodes','dts_properties','dts_phandle_refs',
          'dts_property_occurrences','dts_occurrence_effects','dts_property_specs','dts_property_occurrence_spec_decisions','dts_release_baseline',
          'dts_release_baseline_members','dts_validation_runs','dts_validation_diagnostics','dts_reload_runs','dts_reload_run_targets','dts_reload_device_residue',
          'dts_reload_org_defaults','dts_sensitive_node_rules','user_role_bindings','seed_initialization_runs']))) then return old; end if;
        if tg_op='UPDATE' and tg_table_schema='public' and (
          (tg_table_name='debug_nodes' and old_value-array['canonical_binding_id','canonical_project_id']=new_value-array['canonical_binding_id','canonical_project_id']) or
          (tg_table_name='node_operations' and old_value-array['canonical_binding_id','canonical_project_id','canonical_pin','project_parameter_binding_id']=new_value-array['canonical_binding_id','canonical_project_id','canonical_pin','project_parameter_binding_id']) or
          (tg_table_name='log_records' and old_value-'related_parameter_project_id'=new_value-'related_parameter_project_id') or
          (tg_table_name=any(array['agent_sessions','agent_tool_calls','agent_approvals']) and old_value-'project_id'=new_value-'project_id')) then return new; end if;
      end if;$guard$);
  if changed=installed then raise exception 'Deleting Organization fence was not found'; end if;
  execute changed;
end $$;

create function parameter_catalog.organization_parameter_archives(p_id text,p_actor text,p_lease text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,parameter_catalog as $$
declare org text; projects text[]; result jsonb;
begin
  org:=parameter_catalog.lock_organization_parameter_erasure(p_id,p_actor,p_lease);
  lock table public.parameter_object_writes,parameter_catalog.catalog_archive_writes in share row exclusive mode;
  lock table parameter_catalog.legacy_identities,parameter_catalog.parameter_catalog_archives in share row exclusive mode;
  select coalesce(array_agg(id),'{}') into projects from public.projects where organization_id=org;
  with owned as (select id from parameter_catalog.legacy_identities where
      (owner_scope_kind='organization' and owner_scope_id=org) or (owner_scope_kind='project' and owner_scope_id=any(projects))),
    identities as (select id from owned union select id from public.parameter_specs where organization_id=org
      union select id from parameter_catalog.project_parameter_bindings where organization_id=org
      union select v.id from parameter_catalog.project_parameter_values v join parameter_catalog.project_parameter_bindings b on b.id=v.binding_id where b.organization_id=org)
  select jsonb_build_object('archives',(select coalesce(jsonb_agg(to_jsonb(a)),'[]') from parameter_catalog.parameter_catalog_archives a where legacy_identity_id in(select id from owned)),
    'ownedIds',(select coalesce(jsonb_agg(id),'[]') from identities)) into result;
  return result;
end $$;

create function parameter_catalog.purge_organization_parameter_assets(p_id text,p_actor text,p_lease text)
returns void language plpgsql security definer set search_path=pg_catalog,public,parameter_catalog,catalog_publication as $$
#variable_conflict use_variable
declare org text; project record; entry record; relation text; deletion_order text[]:='{}'; keys jsonb; targets jsonb:='{}'; progress boolean; ids text[]; proposals text[]; legacy_ids text[];
begin
  org:=parameter_catalog.lock_organization_parameter_erasure(p_id,p_actor,p_lease);
  -- ponytail: finite maintenance fence serializes parameter writes; use scoped
  -- writer leases if this bounded cleanup becomes a throughput bottleneck.
  lock table public.parameter_object_writes,parameter_catalog.catalog_archive_writes in share row exclusive mode;
  lock table parameter_catalog.organization_subject_registrations,parameter_catalog.subject_placements,
    parameter_catalog.definition_proposals,parameter_catalog.definition_proposal_revisions,
    parameter_catalog.parameter_review_items,parameter_catalog.parameter_review_resolutions,
    parameter_catalog.legacy_identities,parameter_catalog.legacy_mapping_heads,parameter_catalog.legacy_mapping_versions,
    parameter_catalog.parameter_catalog_archives in share row exclusive mode;
  select coalesce(array_agg(id),'{}') into ids from public.projects where organization_id=org;
  select coalesce(array_agg(id),'{}') into proposals from parameter_catalog.definition_proposals where organization_id=org;
  select coalesce(array_agg(id),'{}') into legacy_ids from parameter_catalog.legacy_identities where
    (owner_scope_kind='organization' and owner_scope_id=org) or (owner_scope_kind='project' and owner_scope_id=any(ids));
  -- Capture physical custody before any parent disappears. Global Definition
  -- pending keys keep their own store-qualified platform custody.
  insert into parameter_catalog.organization_parameter_erasure_objects
    select p_id,ref.store,ref.object_ref from parameter_catalog.organization_deletion_object_references() ref
    where ref.org=org and ref.object_ref is not null and (
      ref.store='catalog' or exists(select 1 from public.parameter_object_writes w where w.organization_id=org and w.object_ref=ref.object_ref)
      or exists(select 1 from public.project_parameter_files f join public.project_parameter_file_versions v on v.file_id=f.id where f.organization_id=org and v.storage_key=ref.object_ref)
      or exists(select 1 from public.project_parameter_file_candidates c where c.organization_id=org and c.storage_key=ref.object_ref)
      or exists(select 1 from public.project_parameter_plane_archives a where a.organization_id=org and a.object_ref=ref.object_ref)
      or exists(select 1 from public.dts_reload_runs r where r.organization_id=org and ref.object_ref in (r.overlay_source_storage_key,r.overlay_artifact_storage_key))
      or exists(select 1 from parameter_catalog.project_erasures e where e.organization_id=org and ref.object_ref=any(e.pending_object_refs)))
    on conflict do nothing;
  set constraints all deferred;
  -- Retained Candidates and exact original approval tuples remain platform facts.
  select coalesce(jsonb_agg(jsonb_build_object('id',id)),'[]') into keys from catalog_publication.candidates where proposal_id=any(proposals);
  perform parameter_catalog.definition_purge_mark('catalog_publication.candidates',keys,'UPDATE');
  insert into catalog_publication.publication_authorizations(id,event_kind,candidate_id,artifact_digest,expected_base_release_id,expected_base_release_digest,
    proposal_revision_id,impact_report_digest,capability_contract_digest,policy_revision,actor_principal_id,approved_authorization_id)
    select 'cauth_org_erasure_'||md5(p_id||a.id),'revoke',a.candidate_id,a.artifact_digest,a.expected_base_release_id,a.expected_base_release_digest,
      a.proposal_revision_id,a.impact_report_digest,a.capability_contract_digest,a.policy_revision,p_actor,a.id
    from catalog_publication.publication_authorizations a join catalog_publication.candidates c on c.id=a.candidate_id
    where a.event_kind='approve' and (c.proposal_id=any(proposals) or c.identity_allocation->>'authorOrganizationId'=org)
      and not exists(select 1 from catalog_publication.publication_authorizations r where r.approved_authorization_id=a.id and r.event_kind='revoke');
  update catalog_publication.publication_jobs j set status='cancelled',lease_owner=null,lease_until=null,fencing_token=fencing_token+1,
    last_error_class='organization-erasure',last_error_reason='Organization authoring was permanently erased',updated_at=clock_timestamp()
    from catalog_publication.candidates c where c.id=j.candidate_id and j.status<>'active'
      and (c.proposal_id=any(proposals) or c.identity_allocation->>'authorOrganizationId'=org);
  update catalog_publication.candidates set proposal_id=null,proposal_revision_id=null where proposal_id=any(proposals);
  select coalesce(jsonb_agg(jsonb_build_object('id',id)),'[]') into keys from parameter_catalog.catalog_publication_intents where proposal_id=any(proposals);
  perform parameter_catalog.definition_purge_mark('parameter_catalog.catalog_publication_intents',keys,'DELETE');
  delete from parameter_catalog.catalog_publication_intents where proposal_id=any(proposals);
  -- These records can hold old project bindings alive; erase only this owner.
  delete from public.legacy_parameter_migration_evidence where organization_id=org;
  for project in select id from public.projects where organization_id=org order by id loop
    perform parameter_catalog.purge_project(org,project.id,p_actor,'organization-erasure:'||p_id);
  end loop;
  -- Fixed ownership closure, never recursive FK discovery or arbitrary tables.
  for entry in select * from (values
    ('parameter_catalog.parameter_review_resolutions','review_item_id in(select id from parameter_catalog.parameter_review_items where organization_id=$1)'),
    ('parameter_catalog.parameter_review_items','organization_id=$1'),
    ('parameter_catalog.parameter_review_evidence','organization_id=$1'),
    ('parameter_catalog.parameter_observation_matches','organization_id=$1'),
    ('parameter_catalog.parameter_observations','organization_id=$1'),
    ('parameter_catalog.definition_replacement_projects','organization_id=$1'),
    ('parameter_catalog.definition_replacements','organization_id=$1'),
    ('parameter_catalog.definition_replacement_previews','organization_id=$1'),
    ('parameter_catalog.definition_proposal_revisions','proposal_id=any($2)'),
    ('parameter_catalog.definition_proposals','organization_id=$1'),
    ('parameter_catalog.governance_command_idempotency','organization_id=$1'),
    ('parameter_catalog.subject_placements','organization_id=$1'),
    ('parameter_catalog.organization_subject_registrations','organization_id=$1'),
    ('parameter_catalog.parameter_catalog_comparison_results','comparison_case_id in(select id from parameter_catalog.parameter_catalog_comparison_cases where (protected_reference_owner_scope_kind=''organization'' and protected_reference_owner_scope_id=$1) or (protected_reference_owner_scope_kind=''project'' and protected_reference_owner_scope_id=any($3)))'),
    ('parameter_catalog.parameter_catalog_comparison_cases','(protected_reference_owner_scope_kind=''organization'' and protected_reference_owner_scope_id=$1) or (protected_reference_owner_scope_kind=''project'' and protected_reference_owner_scope_id=any($3))'),
    ('parameter_catalog.parameter_catalog_classification_ledger','legacy_identity_id=any($4)'),
    ('parameter_catalog.legacy_mapping_heads','legacy_identity_id=any($4)'),
    ('parameter_catalog.legacy_mapping_versions','legacy_identity_id=any($4)'),
    ('parameter_catalog.parameter_catalog_archives','legacy_identity_id=any($4)'),
    ('parameter_catalog.legacy_identities','id=any($4)'),
    ('public.parameter_definition_reconciliation_items','organization_id=$1'),('public.parameter_definition_reconciliation_runs','organization_id=$1'),
    ('public.parameter_policy_targets','organization_id=$1'),('public.parameter_spec_review_tasks','organization_id=$1'),
    ('public.parameter_spec_property_key_cutover_items','run_id in(select id from public.parameter_spec_property_key_cutover_runs where organization_id=$1)'),
    ('public.parameter_spec_version_cutover_items','run_id in(select id from public.parameter_spec_version_cutover_runs where organization_id=$1)'),
    ('public.parameter_spec_property_key_cutover_runs','organization_id=$1'),('public.parameter_spec_version_cutover_runs','organization_id=$1'),
    ('public.driver_schema_overlay_promotions','source_organization_id=$1'),
    ('public.driver_schema_overlay_properties','driver_schema_overlay_id in(select id from public.driver_schema_overlays where organization_id=$1)'),
    ('public.driver_schema_versions','driver_schema_id in(select id from public.driver_schemas where organization_id=$1)'),
    ('public.dts_property_specs','driver_schema_id in(select id from public.driver_schemas where organization_id=$1)'),
    ('public.driver_schema_overlays','organization_id=$1'),('public.driver_schemas','organization_id=$1'),
    ('public.parameter_spec_versions','parameter_spec_id in(select id from public.parameter_specs where organization_id=$1)'),
    ('public.parameter_specs','organization_id=$1'),(parameter_catalog.definition_purge_legacy_relation('public.parameter_definitions'),'organization_id=$1'),
    ('public.parameter_module_mappings','organization_id=$1'),('public.parameter_module_dismissed_compatibles','organization_id=$1'),
    ('public.module_recognition_rules','organization_id=$1'),('public.driver_registration_placements','organization_id=$1'),
    ('public.driver_registrations','attribution_subject_id in(select id from public.attribution_subjects where organization_id=$1)'),
    ('public.node_type_definitions','attribution_subject_id in(select id from public.attribution_subjects where organization_id=$1)'),
    ('public.parameter_modules','organization_id=$1'),
    ('public.attribution_subjects','organization_id=$1'),('public.business_categories','organization_id=$1'),
    ('public.seed_initialization_runs','organization_id=$1'),('public.dts_reload_org_defaults','organization_id=$1')
  ) owned(relation,predicate) loop
    execute format('select coalesce(jsonb_agg(parameter_catalog.definition_purge_key(%L::regclass,to_jsonb(r))),''[]'') from %s r where %s',entry.relation,entry.relation,entry.predicate)
      into keys using org,proposals,ids,legacy_ids;
    targets:=targets||jsonb_build_object(entry.relation,keys);
    deletion_order:=array_append(deletion_order,entry.relation);
    perform parameter_catalog.definition_purge_mark(entry.relation::regclass,keys,'DELETE');
  end loop;
  loop
    progress:=false;
    foreach relation in array deletion_order loop
      if not targets ? relation then continue; end if;
      begin
        execute format('delete from %s r where $1 @> jsonb_build_array(parameter_catalog.definition_purge_key(%L::regclass,to_jsonb(r)))',relation,relation) using targets->relation;
        targets:=targets-relation;progress:=true;
      exception when foreign_key_violation then null;
      end;
    end loop;
    exit when targets='{}';
    if not progress then raise exception using errcode='23503',message='Organization parameter assets have retained references outside their owner'; end if;
  end loop;
  -- Finalized physical legacy tables may exist only on upgraded installations.
  if parameter_catalog.definition_purge_legacy_relation('public.parameter_definitions')='public.legacy_parameter_definitions' then
    delete from public.legacy_project_parameter_values where organization_id=org;
    delete from public.legacy_parameter_definitions where organization_id=org;
  end if;
  update parameter_catalog.definition_erasures set organization_id=null where organization_id=org;
  update parameter_catalog.project_erasures set pending_object_refs='{}' where organization_id=org;
  delete from public.parameter_object_writes where organization_id=org;
  delete from parameter_catalog.catalog_archive_writes w where w.org=org;
  delete from parameter_catalog.definition_purge_rows where transaction_id=txid_current();
end $$;

create function parameter_catalog.organization_parameter_pending_objects(p_id text,p_actor text,p_lease text)
returns table(store text,object_ref text) language plpgsql security definer set search_path=pg_catalog,parameter_catalog,public as $$
begin
  perform parameter_catalog.lock_organization_parameter_erasure(p_id,p_actor,p_lease);
  return query select o.store,o.object_ref from parameter_catalog.organization_parameter_erasure_objects o where erasure_id=p_id order by o.store,o.object_ref;
end $$;
create function parameter_catalog.lock_parameter_erasure_object_references()
returns void language plpgsql security definer set search_path=pg_catalog,parameter_catalog,public as $$
declare sibling text;
begin
  -- Reference writers are fenced through the pointer and their actual tables.
  lock table public.knowledge_files,public.log_file_objects,public.log_files,public.log_original_uploads,public.log_artifact_objects,
    public.log_analysis_runs,public.log_skill_samples,public.log_skill_dry_runs,public.log_skill_analysis_cases,public.log_source_snapshots,
    public.log_skill_artifact_objects,public.product_feedback_attachments,public.product_feedback_attachment_uploads,
    public.project_parameter_file_versions,public.project_parameter_file_candidates,public.project_parameter_plane_archives,
    public.dts_reload_runs,parameter_catalog.parameter_catalog_archives,parameter_catalog.definition_erasures,
    parameter_catalog.project_erasures,parameter_catalog.log_erasures,public.log_skill_deletions,public.parameter_object_writes,parameter_catalog.catalog_archive_writes in share mode;
  -- Later accepted domains add only these fixed custody relations. Preserve
  -- their obligations without a migration-order-dependent function snapshot.
  foreach sibling in array array['public.knowledge_attachment_writes','public.log_object_writes',
    'parameter_catalog.organization_log_erasure_objects','public.organization_runtime_erasure_objects'] loop
    if to_regclass(sibling) is not null then execute format('lock table %s in share mode nowait',to_regclass(sibling)); end if;
  end loop;
end $$;
create function parameter_catalog.finish_organization_parameter_object(p_id text,p_actor text,p_lease text,p_store text,p_ref text,p_finish boolean)
returns boolean language plpgsql security definer set search_path=pg_catalog,parameter_catalog,public as $$
declare org text; retained boolean;
begin
  org:=parameter_catalog.lock_organization_parameter_erasure(p_id,p_actor,p_lease);
  if not exists(select 1 from parameter_catalog.organization_parameter_erasure_objects where erasure_id=p_id and store=p_store and object_ref=p_ref) then return true; end if;
  perform parameter_catalog.lock_parameter_erasure_object_references();
  select exists(select 1 from (
    select r.org,r.store,r.object_ref from parameter_catalog.organization_deletion_object_references() r
    except all select org,o.store,o.object_ref from parameter_catalog.organization_parameter_erasure_objects o where o.erasure_id=p_id
  ) r where r.store=p_store and r.object_ref=p_ref) into retained;
  if retained or p_finish then delete from parameter_catalog.organization_parameter_erasure_objects where erasure_id=p_id and store=p_store and object_ref=p_ref; end if;
  return retained;
end $$;

-- Global Definition custody survives its original Home and account. Fence the
-- same real producers and every other pending receipt through physical IO.
create function parameter_catalog.lock_definition_erasure_object(p_definition text,p_actor text,p_ref text)
returns boolean language plpgsql security definer set search_path=pg_catalog,parameter_catalog,public as $$
declare receipt parameter_catalog.definition_erasures%rowtype; retained boolean; v_store text; v_ref text;
begin
  perform set_config('lock_timeout','2s',true);
  perform parameter_catalog.acquire_current_pointer_lock_exclusive();
  perform catalog_publication.acquire_publication_guard_lock();
  if not exists(select 1 from public.users u join public.user_role_bindings r on r.user_id=u.id and r.organization_id=u.organization_id
    join public.roles role on role.id=r.role_id where u.id=p_actor and u.is_active and r.project_id is null and r.role_id='platform-admin'
    and 'platform:access'=any(role.permissions)) then raise exception using errcode='42501',message='Current platform administrator is required'; end if;
  select * into receipt from parameter_catalog.definition_erasures where definition_id=p_definition for update;
  if not found or not p_ref=any(receipt.pending_object_refs) then return false; end if;
  v_store:=split_part(p_ref,'::',1); v_ref:=substr(p_ref,length(v_store)+3);
  if v_store not in ('plane','catalog') or v_ref='' then raise exception using errcode='22023',message='Unknown Definition erasure object store'; end if;
  perform parameter_catalog.lock_parameter_erasure_object_references();
  select exists(select 1 from (
    select r.org,r.store,r.object_ref from parameter_catalog.organization_deletion_object_references() r
    -- Global pending references are platform-owned (org NULL), regardless of
    -- the old operator's Home retained on its receipt.
    except all select null::text,v_store,v_ref
  ) r where r.store=v_store and r.object_ref=v_ref) into retained;
  if retained then raise exception using errcode='55000',message='Definition object retains another live or pending reference'; end if;
  return true;
end $$;

create function parameter_catalog.list_platform_definition_erasures()
returns table(definition_id text,erased_at timestamptz,counts jsonb,pending_object_refs text[])
language sql stable security definer set search_path=pg_catalog,parameter_catalog as $$
  select definition_id,erased_at,counts,pending_object_refs from parameter_catalog.definition_erasures where cardinality(pending_object_refs)>0 order by erased_at,definition_id;
$$;

-- Extend the same typed reference source used by preview and physical cleanup.
do $$ declare installed text; changed text; begin
  select pg_get_functiondef('parameter_catalog.organization_deletion_object_references()'::regprocedure) into strict installed;
  changed:=replace(installed,'select organization_id,''plane'',storage_key from public.log_file_objects',
    'select e.target_organization_id,o.store,o.object_ref from parameter_catalog.organization_parameter_erasure_objects o join public.organization_erasures e on e.id=o.erasure_id union all select org,''catalog'',object_ref from parameter_catalog.catalog_archive_writes union all select organization_id,''plane'',object_ref from public.parameter_object_writes union all select organization_id,''plane'',storage_key from public.log_file_objects');
  if changed=installed then raise exception 'Typed Organization object reference seam was not found'; end if; execute changed;
end $$;
alter function parameter_catalog.preview_organization_deletion(text,text) rename to preview_organization_deletion_0279;
revoke all on function parameter_catalog.preview_organization_deletion_0279(text,text) from public,catalog_baseline_reader_role;
create function parameter_catalog.preview_organization_deletion(p_org text,p_actor text)
returns table(key text,category text,item_count bigint,state_digest text)
language plpgsql stable security definer set search_path=pg_catalog,public,parameter_catalog as $$
declare relation text;
begin
  return query select r.key,case when r.key='parameter_catalog.log_erasures' then 'logs' else r.category end,r.item_count,r.state_digest
    from parameter_catalog.preview_organization_deletion_0279(p_org,p_actor) r
    where r.key not in ('public.parameter_object_writes','public.legacy_parameter_definitions','public.legacy_project_parameter_values','catalog_publication.organization-proposal-artifacts');
  return query select 'catalog_publication.organization-proposal-artifacts','shared-references',count(*),'retained-platform-publication'
    from catalog_publication.candidates c where c.proposal_id in(select id from parameter_catalog.definition_proposals where organization_id=p_org)
      or c.identity_allocation->>'authorOrganizationId'=p_org;
  return query select 'public.parameter_object_writes','projects',count(*),
    encode(sha256(convert_to(coalesce(string_agg(to_jsonb(w)::text,'' order by id),''),'UTF8')),'hex') from public.parameter_object_writes w where organization_id=p_org;
  return query select 'parameter_catalog.catalog_archive_writes','legacy-archives',count(*),
    encode(sha256(convert_to(coalesce(string_agg(to_jsonb(w)::text,'' order by id),''),'UTF8')),'hex') from parameter_catalog.catalog_archive_writes w where org=p_org;
  -- Shared proofs retain their original bytes/tuples. A foreign-owned semantic
  -- mapping/selection or protected ciphertext graph is not a tenant delete edge.
  return query with owned as (
    select id from parameter_catalog.legacy_identities where (owner_scope_kind='organization' and owner_scope_id=p_org)
      or (owner_scope_kind='project' and owner_scope_id in(select id from public.projects where organization_id=p_org))
  ) select 'catalog.retained-comparison-selection','unclassified',count(*),'retained-proof' from parameter_catalog.parameter_catalog_comparison_results r
    join parameter_catalog.parameter_catalog_comparison_cases c on c.id=r.comparison_case_id where
    (r.selection_legacy_identity_id in(select id from owned) or r.mapping_version_id in(select id from parameter_catalog.legacy_mapping_versions where legacy_identity_id in(select id from owned)))
    and not coalesce((c.protected_reference_owner_scope_kind='organization' and c.protected_reference_owner_scope_id=p_org)
      or (c.protected_reference_owner_scope_kind='project' and c.protected_reference_owner_scope_id in(select id from public.projects where organization_id=p_org)),false) having count(*)>0;
  return query with owned as (
    select id from parameter_catalog.legacy_identities where (owner_scope_kind='organization' and owner_scope_id=p_org)
      or (owner_scope_kind='project' and owner_scope_id in(select id from public.projects where organization_id=p_org))
    union select id from public.parameter_specs where organization_id=p_org
    union select id from parameter_catalog.definition_proposals where organization_id=p_org
    union select id from parameter_catalog.project_parameter_bindings where organization_id=p_org
    union select v.id from parameter_catalog.project_parameter_values v join parameter_catalog.project_parameter_bindings b on b.id=v.binding_id where b.organization_id=p_org
  ) select 'catalog.retained-archive-protected-reference','unclassified',count(*),'retained-protected-graph' from parameter_catalog.parameter_catalog_archives a
    where not ((a.owner_scope_kind='organization' and a.owner_scope_id=p_org) or (a.owner_scope_kind='project' and a.owner_scope_id in(select id from public.projects where organization_id=p_org)))
      and exists(select 1 from jsonb_array_elements(a.protected_references) ref where ref->>'id' in(select id from owned)) having count(*)>0;
  foreach relation in array array['public.parameter_definitions','public.project_parameter_values'] loop
    begin
      if parameter_catalog.definition_purge_legacy_relation(relation)<>relation then
        relation:=parameter_catalog.definition_purge_legacy_relation(relation);
        key:=relation;category:='organization-parameters';
        execute format('select count(*),encode(sha256(convert_to(coalesce(string_agg(to_jsonb(r)::text,'''' order by r.id),''''),''UTF8'')),''hex'') from %s r where organization_id=$1',relation)
          into item_count,state_digest using p_org;return next;
      end if;
    exception when others then key:=relation;category:='unclassified';item_count:=1;state_digest:='legacy-owner-review';return next;
    end;
  end loop;
end $$;
alter function parameter_catalog.preview_organization_deletion(text,text) owner to catalog_migration_owner;
revoke all on function parameter_catalog.preview_organization_deletion(text,text) from public;
grant execute on function parameter_catalog.preview_organization_deletion(text,text) to catalog_baseline_reader_role;

grant select,delete on public.parameter_definition_reconciliation_items,public.parameter_definition_reconciliation_runs,
  public.parameter_policy_targets,public.parameter_spec_review_tasks,public.parameter_spec_property_key_cutover_items,
  public.parameter_spec_version_cutover_items,public.parameter_spec_property_key_cutover_runs,public.parameter_spec_version_cutover_runs,
  public.driver_schema_overlay_promotions,public.driver_schema_overlay_properties,public.driver_schema_versions,public.dts_property_specs,
  public.driver_schema_overlays,public.driver_schemas,public.parameter_spec_versions,public.parameter_specs,public.parameter_definitions,
  public.parameter_module_mappings,public.parameter_module_dismissed_compatibles,public.module_recognition_rules,public.driver_registration_placements,
  public.parameter_modules,public.driver_registrations,public.node_type_definitions,public.attribution_subjects,public.business_categories,
  public.seed_initialization_runs,public.dts_reload_org_defaults,public.legacy_parameter_migration_evidence to catalog_migration_owner;
grant select,update on public.log_files,public.log_original_uploads,public.log_artifact_objects,public.log_analysis_runs,public.log_skill_samples,
  public.log_skill_dry_runs,public.log_skill_analysis_cases,public.log_skill_artifact_objects,public.product_feedback_attachment_uploads,public.log_skill_deletions to catalog_migration_owner;
do $$ declare routine record; runtime record; begin
  for routine in select oid::regprocedure name from pg_proc where pronamespace='parameter_catalog'::regnamespace and proname in
    ('reserve_catalog_archive_write','lock_catalog_archive_write','reserve_parameter_object_write','lock_parameter_object_write','lock_organization_parameter_erasure','organization_parameter_archives','lock_parameter_erasure_object_references','lock_definition_erasure_object','purge_organization_parameter_assets','organization_parameter_pending_objects','finish_organization_parameter_object','list_platform_definition_erasures') loop
    execute format('alter function %s owner to catalog_migration_owner',routine.name);
    execute format('revoke all on function %s from public',routine.name);
  end loop;
  for runtime in select rolname from pg_roles where rolcanlogin and not rolsuper and not rolinherit
    and pg_has_role(oid,'parameter_governance_writer_role','MEMBER') and pg_has_role(oid,'parameter_governance_writer_role','SET') loop
    execute format('grant execute on function parameter_catalog.purge_organization_parameter_assets(text,text,text),parameter_catalog.organization_parameter_pending_objects(text,text,text),parameter_catalog.finish_organization_parameter_object(text,text,text,text,text,boolean),parameter_catalog.list_platform_definition_erasures() to %I',runtime.rolname);
    execute format('grant execute on function parameter_catalog.reserve_parameter_object_write(text,text),parameter_catalog.lock_parameter_object_write(text) to %I',runtime.rolname);
    execute format('grant execute on function parameter_catalog.lock_definition_erasure_object(text,text,text) to %I',runtime.rolname);
    execute format('grant execute on function parameter_catalog.organization_parameter_archives(text,text,text) to %I',runtime.rolname);
    execute format('revoke all on function parameter_catalog.preview_organization_deletion_0279(text,text) from %I',runtime.rolname);
  end loop;
end $$;
grant execute on function parameter_catalog.purge_organization_parameter_assets(text,text,text),parameter_catalog.organization_parameter_pending_objects(text,text,text),
  parameter_catalog.finish_organization_parameter_object(text,text,text,text,text,boolean),parameter_catalog.list_platform_definition_erasures() to parameter_governance_writer_role;
grant execute on function parameter_catalog.reserve_parameter_object_write(text,text),parameter_catalog.lock_parameter_object_write(text) to parameter_governance_writer_role;
grant execute on function parameter_catalog.lock_definition_erasure_object(text,text,text) to parameter_governance_writer_role;
grant execute on function parameter_catalog.organization_parameter_archives(text,text,text) to parameter_governance_writer_role;
