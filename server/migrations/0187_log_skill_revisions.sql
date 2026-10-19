create table log_skill_revisions (
  id text primary key,
  organization_id text not null references organizations(id),
  skill_id text not null,
  revision_number integer not null check (revision_number > 0),
  status text not null check (status in ('draft', 'published', 'superseded')),
  spec jsonb not null check ((spec->>'schemaVersion') is not distinct from 'skill/v1'),
  content_hash text not null,
  created_by_user_id text references users(id) on delete set null,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  published_by_user_id text references users(id) on delete set null,
  unique (id, organization_id),
  unique (skill_id, revision_number),
  foreign key (skill_id, organization_id) references log_domains(id, organization_id) on delete cascade
);
create unique index log_skill_revisions_draft_idx on log_skill_revisions(skill_id) where status = 'draft';
create unique index log_skill_revisions_published_idx on log_skill_revisions(skill_id) where status = 'published';

insert into log_skill_revisions (id, organization_id, skill_id, revision_number, status, spec,
  content_hash, created_at, published_at)
select 'skill-revision-1:' || id, organization_id, id, 1, 'published',
  jsonb_strip_nulls(jsonb_build_object('schemaVersion', 'skill/v1',
    'formatProfile', format_profile, 'modelOverride', model_override)),
  encode(sha256(convert_to(jsonb_strip_nulls(jsonb_build_object('schemaVersion', 'skill/v1',
    'formatProfile', format_profile, 'modelOverride', model_override))::text, 'UTF8')), 'hex'),
  created_at, created_at
from log_domains;

alter table log_analysis_runs add column skill_revision_id text,
  add foreign key (skill_revision_id, organization_id) references log_skill_revisions(id, organization_id);
update log_analysis_runs a set skill_revision_id = s.id
from log_records r join log_skill_revisions s on s.skill_id = r.log_domain_id and s.organization_id = r.organization_id
where a.log_record_id = r.id and a.organization_id = r.organization_id;

-- Content and provenance freeze at publication. The only permitted transition
-- on a published row is superseding it in the same publish transaction.
create function protect_log_skill_revision() returns trigger language plpgsql as $$
begin
  -- Identity deletion owns revision cleanup; direct revision writes stay frozen.
  if tg_op = 'DELETE' and pg_trigger_depth() > 1
    and not exists (select 1 from log_domains where id = old.skill_id and organization_id = old.organization_id) then
    return old;
  end if;
  -- Account deletion retains historical content while clearing actor references,
  -- as required by 0117. Only the FK trigger may perform this redaction.
  if tg_op = 'UPDATE' and pg_trigger_depth() > 1
    and (to_jsonb(new) - 'created_by_user_id' - 'published_by_user_id') =
        (to_jsonb(old) - 'created_by_user_id' - 'published_by_user_id')
    and (new.created_by_user_id is not distinct from old.created_by_user_id
      or (new.created_by_user_id is null and not exists (select 1 from users where id = old.created_by_user_id)))
    and (new.published_by_user_id is not distinct from old.published_by_user_id
      or (new.published_by_user_id is null and not exists (select 1 from users where id = old.published_by_user_id))) then
    return new;
  end if;
  if old.status <> 'draft' and
    (tg_op = 'DELETE' or new.status <> 'superseded' or old.status <> 'published'
      or (to_jsonb(new) - 'status') is distinct from (to_jsonb(old) - 'status')) then
    raise exception 'Published skill revisions are immutable';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
create trigger log_skill_revision_immutable before update or delete on log_skill_revisions
  for each row execute function protect_log_skill_revision();

-- A partial unique index supplies at-most-one; the deferred constraint also
-- requires a published revision at commit, including for legacy identity writes.
create function require_log_skill_published_revision() returns trigger language plpgsql as $$
declare
  target_id text;
begin
  if tg_table_name = 'log_domains' then target_id := new.id;
  elsif tg_op = 'DELETE' then target_id := old.skill_id;
  else target_id := new.skill_id;
  end if;
  if exists (select 1 from log_domains where id = target_id)
    and not exists (select 1 from log_skill_revisions where skill_id = target_id and status = 'published') then
    raise exception 'A skill requires one published revision';
  end if;
  return null;
end $$;
create constraint trigger log_skill_requires_publication after insert or update on log_domains
  deferrable initially deferred for each row execute function require_log_skill_published_revision();
create constraint trigger log_skill_revision_requires_publication after insert or update or delete on log_skill_revisions
  deferrable initially deferred for each row execute function require_log_skill_published_revision();

do $$
declare role_name text;
begin
  for role_name in select rolname from pg_roles
    where has_table_privilege(oid, 'public.log_domains', 'INSERT')
      and oid <> (select relowner from pg_class where oid = 'public.log_skill_revisions'::regclass)
      and rolname <> 'PUBLIC'
  loop
    execute format('grant select, insert, update, delete on public.log_skill_revisions to %I', role_name);
  end loop;
end $$;
