-- Preserve the trusted execution initiator on the #614 parameter governance
-- write paths.  A user id is an accountable principal only; it is nullable
-- for System executions, which carry an explicit service/job identity instead.

alter table parameter_drafts
  alter column user_id drop not null,
  add column if not exists initiator_type text not null default 'user',
  add column if not exists initiator_system_kind text,
  add column if not exists initiator_system_name text,
  add column if not exists initiator_session_id text,
  add column if not exists initiator_tool_call_id text,
  add column if not exists initiator_approval_id text;

alter table parameter_review_decisions
  alter column reviewer_user_id drop not null,
  add column if not exists initiator_type text not null default 'user',
  add column if not exists initiator_system_kind text,
  add column if not exists initiator_system_name text,
  add column if not exists initiator_session_id text,
  add column if not exists initiator_tool_call_id text,
  add column if not exists initiator_approval_id text;

alter table parameter_history_entries
  add column if not exists initiator_type text not null default 'user',
  add column if not exists initiator_system_kind text,
  add column if not exists initiator_system_name text,
  add column if not exists initiator_session_id text,
  add column if not exists initiator_tool_call_id text,
  add column if not exists initiator_approval_id text;

alter table project_parameter_values
  add column if not exists initiator_type text not null default 'user',
  add column if not exists initiator_system_kind text,
  add column if not exists initiator_system_name text,
  add column if not exists initiator_session_id text,
  add column if not exists initiator_tool_call_id text,
  add column if not exists initiator_approval_id text;

alter table project_parameter_file_versions
  add column if not exists initiator_type text not null default 'user',
  add column if not exists initiator_system_kind text,
  add column if not exists initiator_system_name text,
  add column if not exists initiator_session_id text,
  add column if not exists initiator_tool_call_id text,
  add column if not exists initiator_approval_id text;

alter table project_parameter_file_candidates
  add column if not exists initiator_type text not null default 'user',
  add column if not exists initiator_system_kind text,
  add column if not exists initiator_system_name text,
  add column if not exists initiator_session_id text,
  add column if not exists initiator_tool_call_id text,
  add column if not exists initiator_approval_id text;

alter table dts_config_revisions
  add column if not exists initiator_type text not null default 'user',
  add column if not exists initiator_system_kind text,
  add column if not exists initiator_system_name text,
  add column if not exists initiator_session_id text,
  add column if not exists initiator_tool_call_id text,
  add column if not exists initiator_approval_id text;

alter table project_parameter_binding_revisions
  add column if not exists initiator_type text not null default 'user',
  add column if not exists initiator_system_kind text,
  add column if not exists initiator_system_name text,
  add column if not exists initiator_session_id text,
  add column if not exists initiator_tool_call_id text,
  add column if not exists initiator_approval_id text;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'parameter_drafts',
    'parameter_review_decisions',
    'parameter_history_entries',
    'project_parameter_values',
    'project_parameter_file_versions',
    'project_parameter_file_candidates',
    'dts_config_revisions',
    'project_parameter_binding_revisions'
  ] loop
    execute format(
      'alter table %I drop constraint if exists %I',
      table_name,
      table_name || '_initiator_type_check'
    );
    execute format(
      'alter table %I add constraint %I check (initiator_type in (''user'', ''agent'', ''system''))',
      table_name,
      table_name || '_initiator_type_check'
    );
    execute format(
      'alter table %I drop constraint if exists %I',
      table_name,
      table_name || '_system_identity_check'
    );
    execute format(
      'alter table %I add constraint %I check (
        (initiator_type = ''system'' and initiator_system_kind in (''service'', ''job'')
          and initiator_system_name is not null and length(btrim(initiator_system_name)) > 0)
        or initiator_type <> ''system''
      )',
      table_name,
      table_name || '_system_identity_check'
    );
  end loop;
end;
$$;


create index if not exists parameter_drafts_initiator_idx
  on parameter_drafts (organization_id, project_id, initiator_type, updated_at desc);

create unique index if not exists parameter_drafts_binding_initiator_unique
  on parameter_drafts (
    project_id,
    project_parameter_binding_id,
    initiator_type,
    coalesce(user_id, ''),
    coalesce(initiator_system_kind, ''),
    coalesce(initiator_system_name, '')
  )
  where edit_subject_kind = 'binding' and project_parameter_binding_id is not null;

create unique index if not exists parameter_drafts_enablement_initiator_unique
  on parameter_drafts (
    project_id,
    logical_node_id,
    initiator_type,
    coalesce(user_id, ''),
    coalesce(initiator_system_kind, ''),
    coalesce(initiator_system_name, '')
  )
  where edit_subject_kind = 'node-enablement' and logical_node_id is not null;

create index if not exists parameter_review_decisions_initiator_idx
  on parameter_review_decisions (organization_id, request_id, initiator_type, created_at desc);
