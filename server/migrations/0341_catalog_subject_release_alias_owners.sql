-- Alias roots record the owner's scope at their own introduction. A legacy
-- first-owner claim still applies to aliases introduced without a snapshot.
create or replace function parameter_catalog.set_catalog_alias_owner()
returns trigger language plpgsql security definer
set search_path = pg_catalog, parameter_catalog as $$
declare actual_owner text;
begin
  select case when membership.rules_snapshot is null then subject.owner_subject_id
    else membership.rules_snapshot->>'ownerSubjectId' end into actual_owner
  from catalog_subjects subject
  left join catalog_release_subjects membership on membership.subject_id=subject.id
    and membership.release_id=new.introduced_release_id
  where subject.id=new.subject_id;
  if new.owner_subject_id is not null and new.owner_subject_id is distinct from actual_owner then
    raise exception using errcode = '23514', message = 'Catalog alias owner differs from subject owner';
  end if;
  new.owner_subject_id := actual_owner;
  return new;
end $$;

create or replace function parameter_catalog.assert_catalog_alias_owner()
returns trigger language plpgsql security definer
set search_path = pg_catalog, parameter_catalog as $$
begin
  if exists (
    select 1 from parameter_catalog.catalog_subject_aliases alias
    join parameter_catalog.catalog_subjects subject on subject.id=alias.subject_id
    left join catalog_release_subjects membership on membership.subject_id=subject.id
      and membership.release_id=alias.introduced_release_id
    where alias.id=new.id and alias.owner_subject_id is distinct from
      (case when membership.rules_snapshot is null then subject.owner_subject_id
        else membership.rules_snapshot->>'ownerSubjectId' end)
  ) then
    raise exception using errcode = '23514', message = 'Catalog alias owner differs from subject owner',
      constraint = 'catalog_alias_owner_matches_subject_ck';
  end if;
  return null;
end $$;
