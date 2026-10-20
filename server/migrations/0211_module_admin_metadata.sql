-- Explicit importance choices apply to every module kind; existing modules keep
-- their inherited business-category importance until an admin chooses a value.
alter table public.parameter_modules
  add column importance_override boolean not null default false;

-- Placement projections read module name/parent live. Keep their concurrency
-- token in sync with those edits without granting API logins direct Catalog writes.
create function parameter_catalog.refresh_edited_module_placements()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, parameter_catalog
as $$
begin
  update parameter_catalog.subject_placements
  set updated_at = clock_timestamp(), origin = 'curated'
  where organization_id = new.organization_id and module_id = new.id;
  return null;
end;
$$;
alter function parameter_catalog.refresh_edited_module_placements() owner to catalog_migration_owner;
revoke all on function parameter_catalog.refresh_edited_module_placements() from public;
create trigger parameter_module_placement_metadata_version
after update on public.parameter_modules
for each row when (
  (old.name, old.parent_id, old.description, old.scope, old.sort_order, old.importance, old.importance_override)
  is distinct from
  (new.name, new.parent_id, new.description, new.scope, new.sort_order, new.importance, new.importance_override)
)
execute function parameter_catalog.refresh_edited_module_placements();
