-- Reopening a review item preserves its lineage. Authorized erasure still
-- removes the exact rows marked by the existing Catalog maintenance functions.
create or replace function parameter_catalog.protect_review_item_identity()
returns trigger
language plpgsql
set search_path = pg_catalog, parameter_catalog
as $$
begin
  if tg_op in ('UPDATE', 'DELETE')
     and parameter_catalog.definition_purge_allows_change(tg_table_schema, tg_table_name, to_jsonb(old), tg_op) then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
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
