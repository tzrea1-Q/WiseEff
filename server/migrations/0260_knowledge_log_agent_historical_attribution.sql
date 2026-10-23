-- Event labels are separate from live account/ownership links, which may be
-- detached on deletion. Cross-organization administrators retain their identity.
create function knowledge_log_agent_identity_snapshot(actor_id text, identity_kind text, provenance text, event_organization_id text)
returns jsonb language plpgsql stable as $$
declare actor_name text;
begin
  if identity_kind = 'organization' then
    select name into actor_name from organizations where id = actor_id;
  elsif identity_kind = 'credential' then
    select name into actor_name from log_integration_credentials where id = actor_id and organization_id = event_organization_id;
  else
    select u.name into actor_name from users u where u.id = actor_id and (
      u.organization_id = event_organization_id or exists (
        select 1 from user_role_bindings r where r.user_id = u.id and r.organization_id = u.organization_id
          and r.role_id = 'platform-admin' and r.project_id is null
      )
    );
  end if;
  return jsonb_build_object('id', actor_id, 'name', actor_name,
    'source', case when actor_name is null then 'unknown' else provenance end);
end $$;

create function capture_knowledge_log_agent_attribution() returns trigger language plpgsql as $$
declare
  actor_column text;
  actor_id text;
  snapshot jsonb;
  row_data jsonb := to_jsonb(new);
begin
  if tg_op = 'INSERT' then
    snapshot := jsonb_build_object('organization',
      knowledge_log_agent_identity_snapshot(new.organization_id, 'organization', 'recorded', new.organization_id), 'actors', '{}'::jsonb);
  else
    snapshot := old.historical_attribution;
  end if;
  foreach actor_column in array string_to_array(tg_argv[0], ',') loop
    actor_id := row_data ->> actor_column;
    if tg_op = 'INSERT' or (
      actor_column = any(string_to_array(tg_argv[1], ','))
      and actor_id is not null and (snapshot #>> array['actors', actor_column, 'id']) is null
    ) then
      snapshot := jsonb_set(snapshot, array['actors', actor_column],
        knowledge_log_agent_identity_snapshot(actor_id,
          case when actor_column = 'created_by_credential_id' then 'credential' else 'user' end, 'recorded',
          snapshot #>> '{organization,id}'));
    end if;
  end loop;
  new.historical_attribution := snapshot;
  return new;
end $$;

-- Finish deferred publication checks before the backfill's follow-up table DDL.
set constraints all immediate;

do $$
declare
  item record;
  actor_column text;
  actor_expression text;
  publication_guard_state "char";
begin
  for item in select * from (values
    ('knowledge_entries', 'created_by_user_id', ''),
    ('knowledge_revisions', 'author_user_id', ''),
    ('knowledge_files', '', ''),
    ('knowledge_parameter_references', 'created_by_user_id', ''),
    ('knowledge_definition_references', 'created_by_user_id', ''),
    ('log_records', 'submitted_by_user_id,created_by_credential_id', ''),
    ('log_file_objects', 'uploaded_by_user_id,created_by_credential_id', ''),
    ('log_feedback', 'user_id', ''),
    ('log_skill_revisions', 'created_by_user_id,published_by_user_id', 'published_by_user_id'),
    ('log_skill_samples', 'uploaded_by_user_id', ''),
    ('agent_sessions', 'actor_user_id', ''),
    ('agent_approvals', 'requested_by_user_id,decided_by_user_id', 'decided_by_user_id')
  ) as targets(table_name, actor_columns, decision_columns) loop
    execute format('alter table %I add column historical_attribution jsonb', item.table_name);
    actor_expression := '''{}''::jsonb';
    foreach actor_column in array string_to_array(item.actor_columns, ',') loop
      actor_expression := actor_expression || format(
        ' || jsonb_build_object(%L, knowledge_log_agent_identity_snapshot(%I, %L, ''legacy-current'', organization_id))',
        actor_column, actor_column, case when actor_column = 'created_by_credential_id' then 'credential' else 'user' end);
    end loop;
    -- Current-at-migration labels are never presented as known past names.
    if item.table_name = 'log_skill_revisions' then
      select tgenabled into publication_guard_state from pg_trigger
        where tgrelid = 'log_skill_revisions'::regclass and tgname = 'log_skill_revision_immutable';
      execute 'alter table log_skill_revisions disable trigger log_skill_revision_immutable';
    end if;
    execute format('update %I set historical_attribution = jsonb_build_object(''organization'',
      knowledge_log_agent_identity_snapshot(organization_id, ''organization'', ''legacy-current'', organization_id), ''actors'', %s)',
      item.table_name, actor_expression);
    if item.table_name = 'log_skill_revisions' and publication_guard_state <> 'D' then
      execute 'alter table log_skill_revisions enable ' ||
        case publication_guard_state when 'A' then 'always ' when 'R' then 'replica ' else '' end ||
        'trigger log_skill_revision_immutable';
    end if;
    execute format('alter table %I alter column historical_attribution set not null', item.table_name);
    execute format('create trigger aa_historical_attribution before insert or update on %I
      for each row execute function capture_knowledge_log_agent_attribution(%L, %L)',
      item.table_name, item.actor_columns, item.decision_columns);
  end loop;
end $$;
