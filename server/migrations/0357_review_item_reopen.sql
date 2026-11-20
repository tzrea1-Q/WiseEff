alter table parameter_catalog.parameter_review_items
  add column reopened_from_item_id text,
  add column reopen_reason text,
  add constraint parameter_review_reopen_once unique (reopened_from_item_id),
  add constraint parameter_review_reopen_owner_fk
    foreign key (reopened_from_item_id, organization_id)
    references parameter_catalog.parameter_review_items (id, organization_id)
    deferrable initially deferred,
  add constraint parameter_review_reopen_reason_ck check (
    (reopened_from_item_id is null and reopen_reason is null) or
    (reopened_from_item_id is not null and reopened_from_item_id <> id and reopen_reason is not null and
      char_length(reopen_reason) between 1 and 1000 and btrim(reopen_reason) = reopen_reason)
  );

create or replace function parameter_catalog.protect_review_item_identity()
returns trigger
language plpgsql
set search_path = pg_catalog, parameter_catalog
as $$
begin
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
