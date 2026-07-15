-- Close the pre-existing project-deletion cascade gap (predates P1; surfaced by
-- P2/P3 which made project_parameter_files central). Deleting a project must
-- cascade through its DTS artifact chain instead of raising foreign-key errors:
--   projects → project_parameter_files → project_parameter_file_versions
--            → dts_nodes/dts_properties/dts_phandle_refs (already cascade, 0042)
--            → dts_release_baseline_members
--            → parameter_file_sync_conflicts
-- and parameter_drafts.origin_file_version_id is detached (SET NULL) rather than
-- blocking. Append-only, idempotent: each block drops the FK currently guarding
-- the column (matched by referenced table) and re-adds it with the target action.

-- 1) project_parameter_files.project_id → ON DELETE CASCADE
do $$
declare cname text;
begin
  for cname in
    select con.conname from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    where rel.relname = 'project_parameter_files' and con.contype = 'f'
      and pg_get_constraintdef(con.oid) ilike '%references projects(id)%'
  loop execute format('alter table project_parameter_files drop constraint %I', cname); end loop;
  if not exists (select 1 from pg_constraint where conname = 'project_parameter_files_project_id_fkey') then
    alter table project_parameter_files
      add constraint project_parameter_files_project_id_fkey
      foreign key (project_id) references projects(id) on delete cascade;
  end if;
end $$;

-- 2) dts_release_baseline_members.file_id → ON DELETE CASCADE
do $$
declare cname text;
begin
  for cname in
    select con.conname from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    where rel.relname = 'dts_release_baseline_members' and con.contype = 'f'
      and pg_get_constraintdef(con.oid) ilike '%(file_id)%references project_parameter_files(id)%'
  loop execute format('alter table dts_release_baseline_members drop constraint %I', cname); end loop;
  if not exists (select 1 from pg_constraint where conname = 'dts_release_baseline_members_file_id_fkey') then
    alter table dts_release_baseline_members
      add constraint dts_release_baseline_members_file_id_fkey
      foreign key (file_id) references project_parameter_files(id) on delete cascade;
  end if;
end $$;

-- 3) dts_release_baseline_members.file_version_id → ON DELETE CASCADE
do $$
declare cname text;
begin
  for cname in
    select con.conname from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    where rel.relname = 'dts_release_baseline_members' and con.contype = 'f'
      and pg_get_constraintdef(con.oid) ilike '%(file_version_id)%references project_parameter_file_versions(id)%'
  loop execute format('alter table dts_release_baseline_members drop constraint %I', cname); end loop;
  if not exists (select 1 from pg_constraint where conname = 'dts_release_baseline_members_file_version_id_fkey') then
    alter table dts_release_baseline_members
      add constraint dts_release_baseline_members_file_version_id_fkey
      foreign key (file_version_id) references project_parameter_file_versions(id) on delete cascade;
  end if;
end $$;

-- 4) parameter_file_sync_conflicts child FKs → ON DELETE CASCADE
--    (a conflict about a deleted value/draft/version is meaningless)
do $$
declare cname text;
begin
  for cname in
    select con.conname from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    where rel.relname = 'parameter_file_sync_conflicts' and con.contype = 'f'
      and pg_get_constraintdef(con.oid) ilike '%(project_parameter_value_id)%references project_parameter_values(id)%'
  loop execute format('alter table parameter_file_sync_conflicts drop constraint %I', cname); end loop;
  if not exists (select 1 from pg_constraint where conname = 'parameter_file_sync_conflicts_value_fkey') then
    alter table parameter_file_sync_conflicts
      add constraint parameter_file_sync_conflicts_value_fkey
      foreign key (project_parameter_value_id) references project_parameter_values(id) on delete cascade;
  end if;

  for cname in
    select con.conname from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    where rel.relname = 'parameter_file_sync_conflicts' and con.contype = 'f'
      and pg_get_constraintdef(con.oid) ilike '%(file_version_id)%references project_parameter_file_versions(id)%'
  loop execute format('alter table parameter_file_sync_conflicts drop constraint %I', cname); end loop;
  if not exists (select 1 from pg_constraint where conname = 'parameter_file_sync_conflicts_file_version_fkey') then
    alter table parameter_file_sync_conflicts
      add constraint parameter_file_sync_conflicts_file_version_fkey
      foreign key (file_version_id) references project_parameter_file_versions(id) on delete cascade;
  end if;

  for cname in
    select con.conname from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    where rel.relname = 'parameter_file_sync_conflicts' and con.contype = 'f'
      and pg_get_constraintdef(con.oid) ilike '%(file_draft_id)%references parameter_drafts(id)%'
  loop execute format('alter table parameter_file_sync_conflicts drop constraint %I', cname); end loop;
  if not exists (select 1 from pg_constraint where conname = 'parameter_file_sync_conflicts_file_draft_fkey') then
    alter table parameter_file_sync_conflicts
      add constraint parameter_file_sync_conflicts_file_draft_fkey
      foreign key (file_draft_id) references parameter_drafts(id) on delete cascade;
  end if;

  for cname in
    select con.conname from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    where rel.relname = 'parameter_file_sync_conflicts' and con.contype = 'f'
      and pg_get_constraintdef(con.oid) ilike '%(ui_draft_id)%references parameter_drafts(id)%'
  loop execute format('alter table parameter_file_sync_conflicts drop constraint %I', cname); end loop;
  if not exists (select 1 from pg_constraint where conname = 'parameter_file_sync_conflicts_ui_draft_fkey') then
    alter table parameter_file_sync_conflicts
      add constraint parameter_file_sync_conflicts_ui_draft_fkey
      foreign key (ui_draft_id) references parameter_drafts(id) on delete cascade;
  end if;
end $$;

-- 5) parameter_drafts.origin_file_version_id → ON DELETE SET NULL (detach, don't delete drafts)
do $$
declare cname text;
begin
  for cname in
    select con.conname from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    where rel.relname = 'parameter_drafts' and con.contype = 'f'
      and pg_get_constraintdef(con.oid) ilike '%(origin_file_version_id)%references project_parameter_file_versions(id)%'
  loop execute format('alter table parameter_drafts drop constraint %I', cname); end loop;
  if not exists (select 1 from pg_constraint where conname = 'parameter_drafts_origin_file_version_fkey') then
    alter table parameter_drafts
      add constraint parameter_drafts_origin_file_version_fkey
      foreign key (origin_file_version_id) references project_parameter_file_versions(id) on delete set null;
  end if;
end $$;
