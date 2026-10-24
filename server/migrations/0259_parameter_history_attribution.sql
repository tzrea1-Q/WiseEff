-- Historical labels are evidence, not live ownership or authorization pointers.
-- Keep nullable user FKs for account deletion; retain event-time identity separately.
create function public.capture_parameter_history_attribution() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
declare
  row_data jsonb := to_jsonb(new);
  previous_data jsonb;
  snapshot jsonb;
  organization_key text;
  organization_label text;
  actor_column text;
  actor_key text;
  actor_label text;
  capture_source text := tg_argv[0];
begin
  if tg_op = 'UPDATE' then
    snapshot := old.historical_attribution;
    previous_data := to_jsonb(old);
  end if;
  if snapshot is null or not (snapshot ? 'organization') then
    organization_key := row_data->>'organization_id';
    if tg_table_name = 'project_parameter_file_versions' then
      select file.organization_id into organization_key
        from public.project_parameter_files file where file.id = new.file_id;
    end if;
    select organization.name into organization_label
      from public.organizations organization where organization.id = organization_key;
    snapshot := jsonb_build_object('organization', jsonb_build_object(
      'id', organization_key, 'name', organization_label,
      'source', case when organization_label is null then 'unknown' else capture_source end), 'actors', '{}'::jsonb);
  end if;
  organization_key := snapshot->'organization'->>'id';
  foreach actor_column in array string_to_array(tg_argv[1], ',') loop
    actor_key := row_data->>actor_column;
    -- Capture a reviewer's first decision, but never replace a historical actor
    -- when their account is renamed, removed, or a live responsibility changes.
    if not (snapshot->'actors' ? actor_column)
      or (snapshot->'actors'->actor_column->>'id' is null and actor_key is not null
        and previous_data->>actor_column is null and (
          (actor_column in ('reviewer_user_id', 'reviewed_by_user_id')
            and previous_data->>'status' in ('pending', 'open') and row_data->>'status' not in ('pending', 'open'))
          or (actor_column in ('abandoned_by_user_id', 'activated_by_user_id')
            and previous_data->>replace(actor_column, '_by_user_id', '_at') is null
            and row_data->>replace(actor_column, '_by_user_id', '_at') is not null))) then
      select actor.name into actor_label from public.users actor where actor.id = actor_key
        and (organization_key is null or actor.organization_id = organization_key
          or exists (select 1 from public.user_role_bindings role where role.user_id = actor.id
            and role.organization_id = actor.organization_id and role.role_id = 'platform-admin' and role.project_id is null));
      snapshot := jsonb_set(snapshot, array['actors', actor_column], jsonb_build_object(
        'id', actor_key, 'name', actor_label,
        'source', case when actor_label is null then 'unknown' else capture_source end));
    end if;
  end loop;
  new.historical_attribution := snapshot;
  return new;
end $$;

do $$
declare
  history record;
  guard record;
  guards jsonb;
begin
  for history in select * from (values
    ('audit_events', 'actor_user_id'),
    ('parameter_history_entries', 'changed_by_user_id'),
    ('parameter_submission_rounds', 'submitter_user_id'),
    ('parameter_change_requests', 'submitter_user_id'),
    ('parameter_review_decisions', 'reviewer_user_id'),
    ('parameter_import_batches', 'created_by_user_id'),
    ('project_parameter_file_versions', 'created_by_user_id'),
    ('project_parameter_file_candidates', 'created_by_user_id,abandoned_by_user_id,activated_by_user_id'),
    ('project_parameter_initialization_reviews', 'submitted_by_user_id,reviewed_by_user_id'),
    ('project_parameter_value_change_requests', 'submitter_user_id,reviewer_user_id'),
    ('dts_config_revisions', 'created_by_user_id'),
    ('dts_release_baseline', 'created_by_user_id'),
    ('identity_mapping_tasks', 'reviewer_user_id'),
    ('parameter_spec_review_tasks', 'reviewer_user_id'),
    ('parameter_spec_version_cutover_runs', 'created_by_user_id'),
    ('parameter_spec_property_key_cutover_runs', 'created_by_user_id'),
    ('seed_initialization_runs', 'started_by_user_id')
  ) as histories(table_name, actor_columns) loop
    execute format('alter table public.%I add column historical_attribution jsonb not null default ''{}''::jsonb', history.table_name);
    -- Migration-only backfill must not replay immutable source or closed-review
    -- guards. The migration is transactional; restore every original trigger mode.
    guards := '[]'::jsonb;
    for guard in select tgname, tgenabled::text as enabled from pg_trigger
      where tgrelid = format('public.%I', history.table_name)::regclass and not tgisinternal and tgenabled <> 'D'
    loop
      guards := guards || jsonb_build_array(jsonb_build_object('name', guard.tgname, 'enabled', guard.enabled));
      execute format('alter table public.%I disable trigger %I', history.table_name, guard.tgname);
    end loop;
    execute format('create trigger zz_historical_attribution_capture before insert or update on public.%I
      for each row execute function public.capture_parameter_history_attribution(%L, %L)',
      history.table_name, 'legacy-current', history.actor_columns);
    -- Existing names can only be vouched for as names at migration time, never
    -- as the exact names in use when the old event happened. Missing stays missing.
    execute format('update public.%I set historical_attribution = ''{}''::jsonb', history.table_name);
    execute format('drop trigger zz_historical_attribution_capture on public.%I', history.table_name);
    execute format('create trigger zz_historical_attribution_capture before insert or update on public.%I
      for each row execute function public.capture_parameter_history_attribution(%L, %L)',
      history.table_name, 'recorded', history.actor_columns);
    for guard in select * from jsonb_to_recordset(guards) as modes(name text, enabled text) loop
      execute format('alter table public.%I enable %strigger %I', history.table_name,
        case guard.enabled when 'A' then 'always ' when 'R' then 'replica ' else '' end, guard.name);
    end loop;
  end loop;
end $$;
