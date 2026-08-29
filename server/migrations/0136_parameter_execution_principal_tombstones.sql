-- Preserve the accountable principal for retained Agent evidence when the
-- authenticated user account is permanently deleted.  The live user foreign
-- key is still nulled by the account-deletion policy; this non-FK snapshot is
-- an opaque principal id, not a synthetic user, and is valid only alongside
-- an Agent initiator and its complete correlation.

create table if not exists parameter_execution_principal_tombstones (
  principal_user_id text primary key,
  organization_id text not null references organizations(id),
  deleted_at timestamptz not null default now(),
  unique (principal_user_id, organization_id)
);

create index if not exists parameter_execution_principal_tombstones_org_idx
  on parameter_execution_principal_tombstones (organization_id, deleted_at desc);

do $$
declare
  table_name text;
  constraint_name text;
begin
  foreach table_name in array array[
    'parameter_drafts',
    'parameter_review_decisions',
    'parameter_history_entries',
    'project_parameter_values',
    'project_parameter_file_versions',
    'project_parameter_file_candidates',
    'dts_config_revisions',
    'parameter_submission_rounds',
    'parameter_change_requests'
  ] loop
    constraint_name := table_name || '_principal_tombstone_fk';
    execute format(
      'alter table %I add column if not exists initiator_principal_user_id text',
      table_name
    );
    if not exists (
      select 1
      from pg_constraint
      where conname = constraint_name
    ) then
      if table_name = 'project_parameter_file_versions' then
        -- File versions inherit organization scope through their file and do
        -- not carry a denormalized organization_id column.
        execute format(
          'alter table %I add constraint %I foreign key
             (initiator_principal_user_id)
           references parameter_execution_principal_tombstones
             (principal_user_id)
           on delete restrict not valid',
          table_name,
          constraint_name
        );
      else
        execute format(
          'alter table %I add constraint %I foreign key
             (initiator_principal_user_id, organization_id)
           references parameter_execution_principal_tombstones
             (principal_user_id, organization_id)
           on delete restrict not valid',
          table_name,
          constraint_name
        );
      end if;
    end if;
  end loop;
end;
$$;

-- The account-deletion FK action is a nested UPDATE.  Snapshot only that
-- server-generated transition, before the discriminated union is checked;
-- direct application updates with an Agent and no live principal remain
-- rejected unless they explicitly carry a real tombstone row.
create or replace function parameter_execution_identity_default_user()
returns trigger
language plpgsql
as $$
declare
  old_principal_user_id text;
  principal_organization_id text;
begin
  old_principal_user_id := to_jsonb(old)->>tg_argv[0];

  if new.initiator_type = 'agent'
     and (to_jsonb(new)->>tg_argv[0]) is null
     and old_principal_user_id is not null
     and pg_trigger_depth() > 1 then
    if tg_table_name = 'project_parameter_file_versions' then
      select files.organization_id
      into principal_organization_id
      from project_parameter_files files
      where files.id = to_jsonb(new)->>'file_id';
    else
      principal_organization_id := to_jsonb(new)->>'organization_id';
    end if;
    insert into parameter_execution_principal_tombstones (principal_user_id, organization_id)
    values (old_principal_user_id, principal_organization_id)
    on conflict (principal_user_id) do nothing;
    new.initiator_principal_user_id := old_principal_user_id;
  elsif new.initiator_type in ('user', 'system', 'legacy') then
    new.initiator_principal_user_id := null;
  end if;

  if new.initiator_type = 'user'
     and (to_jsonb(new)->>tg_argv[0]) is null
     and old_principal_user_id is not null
     and pg_trigger_depth() > 1 then
    new.initiator_type := 'legacy';
    new.initiator_system_kind := null;
    new.initiator_system_name := null;
    new.initiator_session_id := null;
    new.initiator_tool_call_id := null;
    new.initiator_approval_id := null;
  end if;

  if new.initiator_type = 'legacy'
     and (to_jsonb(new)->>tg_argv[0]) is not null then
    new.initiator_type := 'user';
    new.initiator_principal_user_id := null;
  end if;

  if tg_table_name = 'project_parameter_file_versions'
     and new.initiator_principal_user_id is not null then
    select files.organization_id
    into principal_organization_id
    from project_parameter_files files
    where files.id = to_jsonb(new)->>'file_id';
    if not exists (
      select 1
      from parameter_execution_principal_tombstones tombstone
      where tombstone.principal_user_id = new.initiator_principal_user_id
        and tombstone.organization_id = principal_organization_id
    ) then
      raise exception 'Agent principal tombstone is outside the file Organization scope'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

do $$
declare
  spec record;
begin
  for spec in
    select * from (values
      ('parameter_drafts'::text, 'user_id'::text),
      ('parameter_review_decisions'::text, 'reviewer_user_id'::text),
      ('parameter_history_entries'::text, 'changed_by_user_id'::text),
      ('project_parameter_values'::text, 'updated_by_user_id'::text),
      ('project_parameter_file_versions'::text, 'created_by_user_id'::text),
      ('project_parameter_file_candidates'::text, 'created_by_user_id'::text),
      ('dts_config_revisions'::text, 'created_by_user_id'::text),
      ('parameter_submission_rounds'::text, 'submitter_user_id'::text),
      ('parameter_change_requests'::text, 'submitter_user_id'::text)
    ) as t(table_name, user_column)
  loop
    execute format('alter table %I drop constraint if exists %I',
      spec.table_name, spec.table_name || '_execution_identity_check');
    execute format(
      'alter table %I add constraint %I check (
        (
          initiator_type = ''user''
          and %I is not null
          and initiator_principal_user_id is null
          and initiator_system_kind is null
          and initiator_system_name is null
          and initiator_session_id is null
          and initiator_tool_call_id is null
          and initiator_approval_id is null
        )
        or (
          initiator_type = ''agent''
          and (
            (%I is not null and initiator_principal_user_id is null)
            or (%I is null and initiator_principal_user_id is not null)
          )
          and initiator_session_id is not null
          and length(btrim(initiator_session_id)) > 0
          and initiator_tool_call_id is not null
          and length(btrim(initiator_tool_call_id)) > 0
          and initiator_approval_id is not null
          and length(btrim(initiator_approval_id)) > 0
          and initiator_system_kind is null
          and initiator_system_name is null
        )
        or (
          initiator_type = ''system''
          and %I is null
          and initiator_principal_user_id is null
          and initiator_system_kind is not null
          and initiator_system_kind in (''service'', ''job'')
          and initiator_system_name is not null
          and length(btrim(initiator_system_name)) > 0
          and initiator_session_id is null
          and initiator_tool_call_id is null
          and initiator_approval_id is null
        )
        or (
          initiator_type = ''legacy''
          and %I is null
          and initiator_principal_user_id is null
          and initiator_system_kind is null
          and initiator_system_name is null
          and initiator_session_id is null
          and initiator_tool_call_id is null
          and initiator_approval_id is null
        )
      ) not valid',
      spec.table_name,
      spec.table_name || '_execution_identity_check',
      spec.user_column,
      spec.user_column,
      spec.user_column,
      spec.user_column,
      spec.user_column
    );
  end loop;
end;
$$;
