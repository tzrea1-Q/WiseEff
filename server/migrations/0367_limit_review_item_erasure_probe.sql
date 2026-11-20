-- Only the migration owner performing authorized erasure may consult the
-- private row capability. Normal review decisions use the identity checks.
create or replace function parameter_catalog.protect_review_item_identity()
returns trigger
language plpgsql
set search_path = pg_catalog, parameter_catalog
as $$
begin
  if TG_OP in ('UPDATE','DELETE') and current_user='catalog_migration_owner' then
    if parameter_catalog.definition_purge_allows_change(TG_TABLE_SCHEMA,TG_TABLE_NAME,to_jsonb(OLD),TG_OP) then
      if TG_OP='DELETE' then return OLD; end if;
      return NEW;
    end if;
  end if;
  if TG_OP='DELETE' then
    raise exception using errcode = '55000', message = 'Review items cannot be deleted';
  end if;
  if new.id is distinct from old.id
     or new.organization_id is distinct from old.organization_id
     or new.evidence_fingerprint is distinct from old.evidence_fingerprint
     or new.matcher_revision is distinct from old.matcher_revision
     or new.catalog_release_id is distinct from old.catalog_release_id
     or new.reason is distinct from old.reason
     or new.reopened_from_item_id is distinct from old.reopened_from_item_id
     or new.reopen_reason is distinct from old.reopen_reason then
    raise exception using errcode = '55000', message = 'Review item evidence identity is immutable';
  end if;
  return new;
end;
$$;
