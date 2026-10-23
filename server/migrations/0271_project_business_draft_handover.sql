-- A working draft belongs to its project even when its current custodian leaves.
-- user_id remains the live working-tip owner; immutable attribution records who
-- originally staged the work (including Agent provenance), independently.
alter table parameter_drafts drop constraint parameter_drafts_user_id_fkey;
alter table parameter_drafts add constraint parameter_drafts_user_id_fkey foreign key(user_id) references users(id) on delete set null;

alter table project_parameter_file_candidates add column responsible_user_id text references users(id) on delete set null;
update project_parameter_file_candidates set responsible_user_id=created_by_user_id;
create function initialize_source_candidate_responsibility() returns trigger language plpgsql as $$
begin new.responsible_user_id:=new.created_by_user_id; return new; end $$;
create trigger initialize_candidate_responsibility before insert on project_parameter_file_candidates for each row execute function initialize_source_candidate_responsibility();

do $$ declare item record; begin
  for item in select * from (values ('parameter_drafts','user_id'),
    ('project_parameter_value_drafts','user_id'),('project_parameter_initialization_drafts','created_by_user_id')) as drafts(table_name,actor_column)
  loop
    execute format('alter table %I add column historical_attribution jsonb not null default ''{}''::jsonb',item.table_name);
    execute format('create trigger zz_historical_attribution_capture before insert or update on %I for each row execute function capture_parameter_history_attribution(''legacy-current'',%L)',item.table_name,item.actor_column);
    execute format('update %I set historical_attribution=''{}''::jsonb',item.table_name);
    execute format('drop trigger zz_historical_attribution_capture on %I',item.table_name);
    execute format('create trigger zz_historical_attribution_capture before insert or update on %I for each row execute function capture_parameter_history_attribution(''recorded'',%L)',item.table_name,item.actor_column);
  end loop;
end $$;

create function preserve_project_draft_execution() returns trigger language plpgsql as $$
begin
  if tg_op='UPDATE' and old.historical_attribution ? 'execution' then
    new.historical_attribution := new.historical_attribution || jsonb_build_object('execution',old.historical_attribution->'execution');
  else
    new.historical_attribution := new.historical_attribution || jsonb_build_object('execution',jsonb_build_object(
      'initiatorType',new.initiator_type,'sessionId',new.initiator_session_id,'toolCallId',new.initiator_tool_call_id,
      'approvalId',new.initiator_approval_id,'systemKind',new.initiator_system_kind,'systemName',new.initiator_system_name));
  end if;
  return new;
end $$;
create trigger zzz_original_execution before insert or update on parameter_drafts for each row execute function preserve_project_draft_execution();
update parameter_drafts set historical_attribution=historical_attribution;

-- The original execution is retained above. An orphan working tip has no live
-- initiator; only the nested FK deletion may clear the old User/Agent owner.
create function project_draft_owner_deleted() returns trigger language plpgsql as $$
begin
  if pg_trigger_depth()>1 and old.user_id is not null and new.user_id is null and old.initiator_type in ('user','agent') then
    new.initiator_type:='legacy';
    new.initiator_session_id:=null; new.initiator_tool_call_id:=null; new.initiator_approval_id:=null;
    new.initiator_system_kind:=null; new.initiator_system_name:=null;
  end if;
  return new;
end $$;
create trigger aa_project_draft_owner_deleted before update of user_id on parameter_drafts for each row execute function project_draft_owner_deleted();

-- Distinct departed owners may leave competing drafts for the same binding.
-- Keep every orphan rather than conflating them under the old empty owner key.
drop index parameter_drafts_binding_initiator_unique;
create unique index parameter_drafts_binding_initiator_unique on parameter_drafts(
  project_id,project_parameter_binding_id,initiator_type,
  coalesce(user_id,case when initiator_type='legacy' then id else '' end),
  coalesce(initiator_system_kind,''),coalesce(initiator_system_name,''))
  where edit_subject_kind='binding' and project_parameter_binding_id is not null;

-- Preserve the need for later review stages even after their assignees are
-- cleared by account deletion or explicitly left pending during handover.
alter table parameter_change_requests add column staged_workflow boolean not null default false;
update parameter_change_requests set staged_workflow=(status<>'submitted' or workflow_hardware_committer_user_id is not null or workflow_software_committer_user_id is not null or workflow_software_user_id is not null);
create function initialize_parameter_staged_workflow() returns trigger language plpgsql as $$
begin
  new.staged_workflow := new.workflow_hardware_committer_user_id is not null or new.workflow_software_committer_user_id is not null or new.workflow_software_user_id is not null;
  return new;
end $$;
create trigger initialize_staged_workflow before insert on parameter_change_requests for each row execute function initialize_parameter_staged_workflow();
