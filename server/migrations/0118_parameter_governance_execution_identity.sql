-- Keep the trusted initiator and the accountable principal distinct for the
-- #614 submission workflow.  System executions have no user principal, while
-- User and Agent executions retain the authenticated principal user.

alter table parameter_submission_rounds
  alter column submitter_user_id drop not null,
  add column if not exists initiator_type text not null default 'user',
  add column if not exists initiator_system_kind text,
  add column if not exists initiator_system_name text,
  add column if not exists initiator_session_id text,
  add column if not exists initiator_tool_call_id text,
  add column if not exists initiator_approval_id text;

alter table parameter_change_requests
  alter column submitter_user_id drop not null,
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
  foreach table_name in array array['parameter_submission_rounds', 'parameter_change_requests'] loop
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
          and initiator_system_name is not null and length(btrim(initiator_system_name)) > 0
          and submitter_user_id is null)
        or (initiator_type in (''user'', ''agent'') and submitter_user_id is not null
          and initiator_system_kind is null and initiator_system_name is null)
      )',
      table_name,
      table_name || '_system_identity_check'
    );
  end loop;
end;
$$;

-- Enablement rows are keyed by logical node and intentionally have no
-- project_parameter_binding_id.  Cutover-era NOT NULLs and the old user-only
-- draft indexes otherwise make a valid System/Agent enablement draft
-- impossible or conflate separate initiator owners.
alter table parameter_drafts
  alter column project_parameter_binding_id drop not null;

alter table parameter_change_requests
  alter column project_parameter_binding_id drop not null;

alter table parameter_submission_items
  alter column project_parameter_binding_id drop not null;

alter table parameter_history_entries
  alter column project_parameter_binding_id drop not null;

alter table parameter_drafts
  drop constraint if exists parameter_drafts_project_binding_user_key;

drop index if exists parameter_drafts_binding_user_unique;
drop index if exists parameter_drafts_project_binding_user_unique;
drop index if exists parameter_drafts_project_binding_user_key;

create unique index if not exists parameter_drafts_binding_initiator_unique
  on parameter_drafts (
    project_id,
    project_parameter_binding_id,
    initiator_type,
    coalesce(user_id, ''),
    coalesce(initiator_system_kind, ''),
    coalesce(initiator_system_name, '')
  )
  where edit_subject_kind = 'binding'
    and project_parameter_binding_id is not null;

