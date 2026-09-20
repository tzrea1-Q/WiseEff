-- #849/#853: freeze the entire historical source graph, not only the selected row.
-- 0151 remains immutable. The migration runner owns this transaction and fence.
lock table public.dts_config_set, public.project_parameter_files,
  public.project_parameter_file_versions, public.dts_config_revisions,
  public.dts_config_revision_members, public.dts_logical_nodes,
  public.dts_logical_node_revisions, public.dts_node_occurrences,
  public.dts_property_occurrences, public.dts_occurrence_effects,
  parameter_catalog.project_value_source_pins in share row exclusive mode;

grant update (id) on public.dts_config_revisions to catalog_migration_owner;

create or replace function parameter_catalog.protect_pinned_source_provenance()
returns trigger language plpgsql security definer
set search_path = pg_catalog, parameter_catalog
as $$
declare
  old_revision text;
  new_revision text;
  revision_ids text[];
begin
  if tg_op <> 'INSERT' then
    if tg_table_name = 'dts_config_revisions' then old_revision := old.id;
    else old_revision := old.config_revision_id; end if;
  end if;
  if tg_op <> 'DELETE' then
    if tg_table_name = 'dts_config_revisions' then new_revision := new.id;
    else new_revision := new.config_revision_id; end if;
  end if;
  revision_ids := array[old_revision, new_revision];
  -- Child-first legacy writers must refuse contention, never wait backwards.
  perform id from public.dts_config_revisions
    where id = any(revision_ids) order by id for update nowait;
  -- First-pin tuple barriers and migration fences use this exact no-op only.
  if tg_table_name = 'dts_config_revisions' and tg_op = 'UPDATE'
     and new is not distinct from old then return new; end if;
  if exists (select 1 from parameter_catalog.project_value_source_pins
             where config_revision_id = any(revision_ids)) then
    raise exception using errcode = '55000', message = 'Pinned source graph is immutable';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger dts_config_revisions_pinned_provenance_immutable on public.dts_config_revisions;
create trigger dts_config_revisions_pinned_provenance_immutable
before insert or update or delete on public.dts_config_revisions
for each row execute function parameter_catalog.protect_pinned_source_provenance();
-- The member trigger already covers all three operations in 0151.
drop trigger dts_logical_node_revisions_pinned_provenance_immutable on public.dts_logical_node_revisions;
create trigger dts_logical_node_revisions_pinned_provenance_immutable
before insert or update or delete on public.dts_logical_node_revisions
for each row execute function parameter_catalog.protect_pinned_source_provenance();
drop trigger dts_node_occurrences_pinned_provenance_immutable on public.dts_node_occurrences;
create trigger dts_node_occurrences_pinned_provenance_immutable
before insert or update or delete on public.dts_node_occurrences
for each row execute function parameter_catalog.protect_pinned_source_provenance();
drop trigger dts_property_occurrences_pinned_provenance_immutable on public.dts_property_occurrences;
create trigger dts_property_occurrences_pinned_provenance_immutable
before insert or update or delete on public.dts_property_occurrences
for each row execute function parameter_catalog.protect_pinned_source_provenance();
drop trigger dts_occurrence_effects_pinned_provenance_immutable on public.dts_occurrence_effects;
create trigger dts_occurrence_effects_pinned_provenance_immutable
before insert or update or delete on public.dts_occurrence_effects
for each row execute function parameter_catalog.protect_pinned_source_provenance();

create function parameter_catalog.protect_pinned_source_file()
returns trigger language plpgsql security definer
set search_path = pg_catalog, parameter_catalog
as $$
declare
  identity_ids text[];
  revision_ids text[];
  members_before jsonb;
  members_after jsonb;
begin
  identity_ids := array[old.id];
  if tg_op = 'UPDATE' then identity_ids := array_append(identity_ids, new.id); end if;
  -- Discover every reference, including currently unpinned revisions, before
  -- locking. Checking only pins here would miss a concurrent first pin.
  select coalesce(jsonb_agg(jsonb_build_array(id, config_revision_id, file_id, file_version_id)
                            order by id), '[]'::jsonb),
         array_agg(distinct config_revision_id order by config_revision_id)
    into members_before, revision_ids
    from public.dts_config_revision_members
    where (tg_table_name = 'project_parameter_files' and file_id = any(identity_ids))
       or (tg_table_name = 'project_parameter_file_versions' and file_version_id = any(identity_ids));
  perform id from public.dts_config_revisions
    where id = any(revision_ids) order by id for update nowait;
  select coalesce(jsonb_agg(jsonb_build_array(id, config_revision_id, file_id, file_version_id)
                            order by id), '[]'::jsonb)
    into members_after from public.dts_config_revision_members
    where (tg_table_name = 'project_parameter_files' and file_id = any(identity_ids))
       or (tg_table_name = 'project_parameter_file_versions' and file_version_id = any(identity_ids));
  if members_after is distinct from members_before then
    raise exception using errcode = '40001', message = 'Source membership changed; retry the whole transaction';
  end if;
  if exists (select 1 from parameter_catalog.project_value_source_pins
             where config_revision_id = any(revision_ids)) then
    if tg_table_name = 'project_parameter_files' and tg_op = 'UPDATE'
       and (to_jsonb(new) - array['file_name','current_version_id','updated_at'])
           is not distinct from (to_jsonb(old) - array['file_name','current_version_id','updated_at']) then
      return new;
    end if;
    raise exception using errcode = '55000', message = 'Pinned source file identity and version are immutable';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger project_parameter_files_pinned_source_immutable
before update or delete on public.project_parameter_files
for each row execute function parameter_catalog.protect_pinned_source_file();
create trigger project_parameter_file_versions_pinned_source_immutable
before update or delete on public.project_parameter_file_versions
for each row execute function parameter_catalog.protect_pinned_source_file();

create function parameter_catalog.fence_first_source_pin()
returns trigger language plpgsql security definer
set search_path = pg_catalog, parameter_catalog
as $$
begin
  perform id from public.dts_config_revisions
    where id = new.config_revision_id order by id for update nowait;
  if not exists (select 1 from parameter_catalog.project_value_source_pins
                 where config_revision_id = new.config_revision_id) then
    -- A real tuple version, not only a row lock: an older REPEATABLE READ
    -- writer must fail serialization before it can observe an unpinned graph.
    update public.dts_config_revisions set id = id where id = new.config_revision_id;
  end if;
  if not exists (select 1 from public.dts_config_revisions revision
                 join parameter_catalog.project_parameter_source_occurrences occurrence
                   on occurrence.id = new.source_occurrence_id
                  and occurrence.organization_id = revision.organization_id
                  and occurrence.project_id = revision.project_id
                  and occurrence.config_set_id = revision.config_set_id
                 where revision.id = new.config_revision_id and revision.organization_id = new.organization_id
                   and revision.project_id = new.project_id) then
    raise exception using errcode = '23503', message = 'Source pin revision owner mismatch';
  end if;
  return new;
end;
$$;
create trigger project_value_source_pin_first_pin_fence
before insert on parameter_catalog.project_value_source_pins
for each row execute function parameter_catalog.fence_first_source_pin();

alter function parameter_catalog.protect_pinned_source_file() owner to catalog_migration_owner;
alter function parameter_catalog.fence_first_source_pin() owner to catalog_migration_owner;
revoke all on function parameter_catalog.protect_pinned_source_file(),
  parameter_catalog.fence_first_source_pin()
from public, catalog_synchronizer_role, parameter_governance_writer_role,
  catalog_publication_coordinator_role, catalog_baseline_reader_role;

-- Upgrade previously pinned revisions to the same tuple barrier under the fence.
update public.dts_config_revisions revision set id = revision.id
where exists (select 1 from parameter_catalog.project_value_source_pins pin
              where pin.config_revision_id = revision.id);
