-- 0167 added a file-only member-detach branch to a trigger also attached to
-- file versions. Keep the 0167 migration immutable and nest file-only fields
-- under the table guard so pinned version UPDATE/DELETE still raise 55000.
create or replace function parameter_catalog.protect_pinned_source_file()
returns trigger language plpgsql security definer
set search_path = pg_catalog, parameter_catalog as $$
declare
  identity_ids text[];
  revision_ids text[];
  members_before jsonb;
  members_after jsonb;
begin
  if tg_op = 'DELETE'
     and parameter_catalog.plane_disposal_allows_delete(tg_table_schema, tg_table_name, old.id) then
    return old;
  end if;
  identity_ids := array[old.id];
  if tg_op = 'UPDATE' then identity_ids := array_append(identity_ids, new.id); end if;
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
    if tg_table_name = 'project_parameter_files' and tg_op = 'UPDATE' then
      if (to_jsonb(new) - array['file_name','current_version_id','updated_at'])
          is not distinct from (to_jsonb(old) - array['file_name','current_version_id','updated_at']) then
        return new;
      end if;
      if old.config_set_id is not null and new.config_set_id is null
         and old.current_version_id = new.current_version_id
         and (to_jsonb(new) - array['config_set_id','config_set_role','config_set_sort_order','updated_at'])
             is not distinct from (to_jsonb(old) - array['config_set_id','config_set_role','config_set_sort_order','updated_at'])
         and exists (
           select 1 from parameter_catalog.project_source_member_tombstones tombstone
           where tombstone.organization_id=old.organization_id
             and tombstone.project_id=old.project_id
             and tombstone.config_set_id=old.config_set_id
             and tombstone.file_id=old.id
             and tombstone.file_version_id=old.current_version_id
         ) then
        return new;
      end if;
    end if;
    raise exception using errcode = '55000', message = 'Pinned source file identity and version are immutable';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
alter function parameter_catalog.protect_pinned_source_file() owner to catalog_migration_owner;
