-- #906 C: retain a draft choice when the 0165 FK is SET NULL on draft deletion.
-- 0174 is already applied; this only adds a forward identity snapshot.
alter table public.project_parameter_value_change_targets
  add column frozen_draft_id text;

-- The existing target guard makes this one-time backfill impossible. Dropping
-- and recreating its trigger in this migration transaction keeps the guard
-- in place for every committed schema state.
drop trigger project_parameter_value_change_target_immutable
  on public.project_parameter_value_change_targets;
update public.project_parameter_value_change_targets
   set frozen_draft_id = draft_id where draft_id is not null;
create trigger project_parameter_value_change_target_immutable
before update or delete on public.project_parameter_value_change_targets
for each row execute function parameter_catalog.protect_batch_value_target();

create function parameter_catalog.freeze_batch_target_draft_id()
returns trigger language plpgsql security definer
set search_path = pg_catalog, parameter_catalog as $$
begin
  new.frozen_draft_id := new.draft_id;
  return new;
end;
$$;
create trigger project_parameter_value_change_target_draft_choice
before insert on public.project_parameter_value_change_targets
for each row execute function parameter_catalog.freeze_batch_target_draft_id();
alter table public.project_parameter_value_change_targets
  add constraint project_parameter_value_change_targets_frozen_draft_ck
    check ((draft_id is null or draft_id = frozen_draft_id) is true);
alter function parameter_catalog.freeze_batch_target_draft_id()
  owner to catalog_migration_owner;
revoke all on function parameter_catalog.freeze_batch_target_draft_id()
  from public, catalog_synchronizer_role, parameter_governance_writer_role;
