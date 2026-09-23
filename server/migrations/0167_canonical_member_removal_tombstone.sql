-- A removed member keeps its historical occurrence, Binding, Value, pin and
-- history rows.  A reviewed tombstone retires the Binding from current reads.
-- The 0151/0161/0165/0166 migrations remain immutable.

create table parameter_catalog.project_source_member_tombstones (
  id text primary key,
  organization_id text not null,
  project_id text not null,
  config_set_id text not null,
  file_id text not null,
  config_revision_id text not null,
  file_version_id text not null,
  binding_manifest jsonb not null check (jsonb_typeof(binding_manifest) = 'array'),
  audit_event_id text not null unique references public.audit_events(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (organization_id, project_id, config_set_id, file_id),
  foreign key (config_set_id, organization_id, project_id)
    references public.dts_config_set(id, organization_id, project_id) on delete restrict,
  foreign key (file_id, organization_id, project_id)
    references public.project_parameter_files(id, organization_id, project_id) on delete restrict,
  foreign key (config_revision_id, file_id, file_version_id)
    references public.dts_config_revision_members(config_revision_id, file_id, file_version_id) on delete restrict
);

-- 0154 protects every pinned file update. Keep that fence, admitting only a
-- same-version detach with a transaction-local tombstone; its deferred proof
-- below rejects an incomplete or forged receipt at COMMIT.
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
    if tg_table_name = 'project_parameter_files' and tg_op = 'UPDATE'
       and (to_jsonb(new) - array['file_name','current_version_id','updated_at'])
           is not distinct from (to_jsonb(old) - array['file_name','current_version_id','updated_at']) then
      return new;
    end if;
    if tg_table_name = 'project_parameter_files' and tg_op = 'UPDATE'
       and old.config_set_id is not null and new.config_set_id is null
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
    raise exception using errcode = '55000', message = 'Pinned source file identity and version are immutable';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

-- Historical source occurrences must survive a member leaving its ConfigSet.
-- The deferred guards below require a matching tombstone before COMMIT.
alter table parameter_catalog.project_parameter_source_occurrences
  drop constraint source_occurrence_file_owner_fk;
alter table parameter_catalog.project_parameter_source_occurrences
  add constraint source_occurrence_file_owner_fk
    foreign key (file_id, organization_id, project_id)
    references public.project_parameter_files(id, organization_id, project_id)
    on delete restrict deferrable initially deferred;

create or replace function parameter_catalog.assert_member_removal_tombstone()
returns trigger language plpgsql security definer
set search_path = pg_catalog, parameter_catalog, public as $$
declare
  expected jsonb;
begin
  if not exists (
    select 1 from public.project_parameter_files file
    join public.dts_config_revisions revision
      on revision.id=new.config_revision_id
     and revision.organization_id=new.organization_id
     and revision.project_id=new.project_id
     and revision.config_set_id=new.config_set_id
    where file.id=new.file_id and file.organization_id=new.organization_id
      and file.project_id=new.project_id and file.config_set_id is null
      and file.current_version_id=new.file_version_id
  ) then
    raise exception using errcode='23514', message='Removed member must retain its exact historical revision and file version';
  end if;
  if not exists (
    select 1 from public.audit_events audit
    where audit.id=new.audit_event_id and audit.organization_id=new.organization_id
      and audit.project_id=new.project_id and audit.actor_type='user'
      and audit.kind='parameter-topology-governance'
      and audit.action='source-member-removed'
      and audit.target_type='project-parameter-file' and audit.target_id=new.file_id
      and audit.metadata->>'tombstoneId'=new.id
      and audit.metadata->>'configSetId'=new.config_set_id
      and audit.metadata->>'configRevisionId'=new.config_revision_id
      and audit.metadata->>'fileVersionId'=new.file_version_id
      and audit.metadata->'bindings'=new.binding_manifest
  ) then
    raise exception using errcode='23514', message='Member removal has no exact user audit receipt';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'bindingId',binding.id,'valueId',value.id,'sourcePinId',pin.id
  ) order by binding.id),'[]'::jsonb) into expected
  from parameter_catalog.project_parameter_bindings binding
  join parameter_catalog.project_parameter_source_occurrences occurrence
    on occurrence.id=binding.source_occurrence_id
  join parameter_catalog.project_parameter_values value
    on value.id=binding.current_value_id and value.binding_id=binding.id
  join parameter_catalog.project_value_source_pins pin
    on pin.project_value_id=value.id and pin.binding_id=binding.id
   and pin.source_occurrence_id=occurrence.id
  where binding.organization_id=new.organization_id and binding.project_id=new.project_id
    and occurrence.config_set_id=new.config_set_id and occurrence.file_id=new.file_id
    and value.value_state='present'
    and pin.locator->>'kind' not in ('dts-delete','json-delete')
    and not exists (
      select 1 from parameter_catalog.definition_replacement_projects replacement
      where replacement.status='completed' and replacement.old_binding_id=binding.id
    )
    and pin.config_revision_id=new.config_revision_id and pin.file_version_id=new.file_version_id;
  if not exists (
       select 1 from parameter_catalog.project_parameter_source_occurrences occurrence
       where occurrence.organization_id=new.organization_id and occurrence.project_id=new.project_id
         and occurrence.config_set_id=new.config_set_id and occurrence.file_id=new.file_id
     ) or expected is distinct from new.binding_manifest
     or exists (
       select 1 from parameter_catalog.project_parameter_bindings binding
       join parameter_catalog.project_parameter_source_occurrences occurrence
         on occurrence.id=binding.source_occurrence_id
       join parameter_catalog.project_parameter_values value
         on value.id=binding.current_value_id and value.binding_id=binding.id
       where binding.organization_id=new.organization_id and binding.project_id=new.project_id
         and occurrence.config_set_id=new.config_set_id and occurrence.file_id=new.file_id
         and value.value_state='present'
         and not exists (
           select 1 from parameter_catalog.definition_replacement_projects replacement
           where replacement.status='completed' and replacement.old_binding_id=binding.id
         )
         and not exists (
           select 1 from parameter_catalog.project_value_source_pins pin
           where pin.project_value_id=binding.current_value_id and pin.binding_id=binding.id
             and pin.config_revision_id=new.config_revision_id and pin.file_version_id=new.file_version_id
             and pin.locator->>'kind' not in ('dts-delete','json-delete')
         )
     ) or exists (
       select 1 from parameter_catalog.current_project_parameter_bindings binding
       join parameter_catalog.project_parameter_source_occurrences occurrence
         on occurrence.id=binding.source_occurrence_id
       where binding.organization_id=new.organization_id and binding.project_id=new.project_id
         and occurrence.config_set_id=new.config_set_id and occurrence.file_id<>new.file_id
     ) then
    raise exception using errcode='23514', message='Member removal must cover the exact source cohort';
  end if;
  return null;
end;
$$;
create constraint trigger project_source_member_tombstone_proof_ck
after insert on parameter_catalog.project_source_member_tombstones
deferrable initially deferred for each row
execute function parameter_catalog.assert_member_removal_tombstone();

create or replace function parameter_catalog.assert_removed_member_has_tombstone()
returns trigger language plpgsql security definer
set search_path = pg_catalog, parameter_catalog, public as $$
begin
  if old.config_set_id is null and new.config_set_id is not null
     and exists (
       select 1 from parameter_catalog.project_source_member_tombstones tombstone
       where tombstone.organization_id=old.organization_id
         and tombstone.project_id=old.project_id and tombstone.file_id=old.id
     ) then
    raise exception using errcode='23514', message='A retired canonical member cannot be reattached';
  end if;
  if old.config_set_id is not null and new.config_set_id is distinct from old.config_set_id
     and exists (
       select 1 from parameter_catalog.project_parameter_source_occurrences occurrence
       where occurrence.organization_id=old.organization_id
         and occurrence.project_id=old.project_id
         and occurrence.config_set_id=old.config_set_id and occurrence.file_id=old.id
     ) and not exists (
       select 1 from parameter_catalog.project_source_member_tombstones tombstone
       where tombstone.organization_id=old.organization_id
         and tombstone.project_id=old.project_id
         and tombstone.config_set_id=old.config_set_id and tombstone.file_id=old.id
         and tombstone.file_version_id=old.current_version_id
     ) then
    raise exception using errcode='23514', message='Canonical member removal requires a reviewed tombstone';
  end if;
  return null;
end;
$$;
create constraint trigger project_parameter_file_canonical_member_tombstone_ck
after update of config_set_id on public.project_parameter_files
deferrable initially deferred for each row
execute function parameter_catalog.assert_removed_member_has_tombstone();

create or replace function parameter_catalog.reject_member_tombstone_change()
returns trigger language plpgsql security definer
set search_path = pg_catalog, parameter_catalog as $$
begin
  raise exception using errcode='55000', message='Source member tombstones are immutable';
end;
$$;
create trigger project_source_member_tombstone_immutable
before update or delete on parameter_catalog.project_source_member_tombstones
for each row execute function parameter_catalog.reject_member_tombstone_change();

create or replace view parameter_catalog.current_project_parameter_bindings as
select binding.*
from parameter_catalog.project_parameter_bindings binding
where not exists (
  select 1 from parameter_catalog.definition_replacement_projects replacement
  where replacement.status='completed' and replacement.old_binding_id=binding.id
)
and not exists (
  select 1 from parameter_catalog.project_parameter_values value
  where value.id=binding.current_value_id and value.value_state='deleted'
)
and not exists (
  select 1 from parameter_catalog.project_parameter_values value
  join parameter_catalog.project_value_source_pins pin
    on pin.project_value_id=value.id and pin.binding_id=value.binding_id
  where value.id=binding.current_value_id
    and pin.locator->>'kind' in ('dts-delete','json-delete')
)
and not exists (
  select 1 from parameter_catalog.project_parameter_source_occurrences occurrence
  join parameter_catalog.project_source_member_tombstones tombstone
    on tombstone.organization_id=occurrence.organization_id
   and tombstone.project_id=occurrence.project_id
   and tombstone.config_set_id=occurrence.config_set_id
   and tombstone.file_id=occurrence.file_id
  where occurrence.id=binding.source_occurrence_id
);

alter table parameter_catalog.project_source_member_tombstones owner to catalog_migration_owner;
alter function parameter_catalog.protect_pinned_source_file() owner to catalog_migration_owner;
alter function parameter_catalog.assert_member_removal_tombstone() owner to catalog_migration_owner;
alter function parameter_catalog.assert_removed_member_has_tombstone() owner to catalog_migration_owner;
alter function parameter_catalog.reject_member_tombstone_change() owner to catalog_migration_owner;
revoke all on table parameter_catalog.project_source_member_tombstones
  from public, catalog_synchronizer_role, parameter_governance_writer_role,
    catalog_publication_coordinator_role, catalog_baseline_reader_role;
revoke all on function parameter_catalog.assert_member_removal_tombstone(),
  parameter_catalog.assert_removed_member_has_tombstone(),
  parameter_catalog.reject_member_tombstone_change()
  from public, catalog_synchronizer_role, parameter_governance_writer_role,
    catalog_publication_coordinator_role, catalog_baseline_reader_role;
