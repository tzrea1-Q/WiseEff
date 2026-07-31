-- Pre-cutover schemas still have project_parameter_value_id NOT NULL on workflow
-- tables. Node-enablement drafts/CRs omit PPV (ADR-0003), and identity-mapping
-- tests insert binding drafts with only project_parameter_binding_id.
-- Post-cutover databases already dropped these columns — skip when absent.

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'parameter_drafts'
      and column_name = 'project_parameter_value_id'
  ) then
    alter table parameter_drafts
      alter column project_parameter_value_id drop not null;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'parameter_change_requests'
      and column_name = 'project_parameter_value_id'
  ) then
    alter table parameter_change_requests
      alter column project_parameter_value_id drop not null;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'parameter_submission_items'
      and column_name = 'project_parameter_value_id'
  ) then
    alter table parameter_submission_items
      alter column project_parameter_value_id drop not null;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'parameter_history_entries'
      and column_name = 'project_parameter_value_id'
  ) then
    alter table parameter_history_entries
      alter column project_parameter_value_id drop not null;
  end if;
end $$;
