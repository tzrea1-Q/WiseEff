-- Releasing happens at the release-baseline/file layer, not on config revisions.

do $$
declare
  published_count integer;
begin
  select count(*)::integer into published_count
  from dts_config_revisions
  where status = 'published';

  if published_count > 0 then
    raise exception
      '0086_retire_config_revision_published: % row(s) still hold status=published; refuse to narrow CHECK',
      published_count;
  end if;
end;
$$;

alter table dts_config_revisions
  drop constraint if exists dts_config_revisions_status_check;

alter table dts_config_revisions
  add constraint dts_config_revisions_status_check
  check (status in (
    'draft',
    'resolving',
    'needs_mapping',
    'invalid',
    'resolved',
    'validated',
    'validation_failed',
    'compiled',
    'pending_approval'
  ));
