alter table public.shared_dtsi_drafts add column change_description text not null default ''
  check(length(change_description)<=1000);

create table public.shared_dtsi_revisions (
  id text primary key,
  resource_id text not null,
  organization_id text not null,
  version integer not null check(version>0),
  name text not null,
  draft_revision integer not null check(draft_revision>0),
  change_description text not null check(length(btrim(change_description)) between 1 and 1000),
  manifest jsonb not null check(jsonb_typeof(manifest)='object'),
  digest text not null,
  created_by_user_id text not null,
  created_at timestamptz not null default now(),
  unique(resource_id,version),
  unique(id,resource_id,organization_id),
  foreign key(resource_id,organization_id) references public.shared_dtsi_resources(id,organization_id)
    on delete cascade deferrable initially deferred,
  foreign key(organization_id) references public.organizations(id) on delete cascade
);
create table public.shared_dtsi_revision_members (
  revision_id text not null,
  member_id text not null,
  resource_id text not null,
  organization_id text not null,
  source_name text not null,
  content text not null check(octet_length(content)<=2097152),
  checksum text not null,
  size_bytes integer not null check(size_bytes>=0),
  primary key(revision_id,member_id),
  unique(revision_id,source_name),
  foreign key(revision_id,resource_id,organization_id) references public.shared_dtsi_revisions(id,resource_id,organization_id)
    on delete cascade deferrable initially deferred,
  foreign key(member_id,resource_id,organization_id) references public.shared_dtsi_members(id,resource_id,organization_id)
    on delete cascade deferrable initially deferred,
  foreign key(organization_id) references public.organizations(id) on delete cascade
);
create table public.shared_dtsi_publication_previews (
  id text primary key,
  resource_id text not null,
  organization_id text not null,
  draft_id text not null,
  draft_revision integer not null,
  base_revision_id text,
  actor_user_id text not null,
  actor_fingerprint text not null,
  name text not null,
  change_description text not null,
  manifest jsonb not null,
  members jsonb not null,
  digest text not null,
  created_at timestamptz not null default now(),
  idempotency_key text,
  published_revision_id text,
  unique(organization_id,actor_user_id,idempotency_key),
  check((idempotency_key is null)=(published_revision_id is null)),
  foreign key(resource_id,organization_id) references public.shared_dtsi_resources(id,organization_id)
    on delete cascade deferrable initially deferred,
  foreign key(published_revision_id,resource_id,organization_id) references public.shared_dtsi_revisions(id,resource_id,organization_id)
    deferrable initially deferred,
  foreign key(organization_id) references public.organizations(id) on delete cascade
);

create function public.guard_shared_dtsi_revision() returns trigger language plpgsql as $$
begin
  -- Organization erasure owns its cascade; ordinary resource operations retain history.
  if TG_OP='DELETE' and not exists(select 1 from public.organizations where id=OLD.organization_id) then return OLD; end if;
  raise exception using errcode='55000',message='Published shared DTSI source is immutable';
end $$;
create function public.guard_shared_dtsi_preview() returns trigger language plpgsql as $$
begin
  if (to_jsonb(NEW)-'idempotency_key'-'published_revision_id') is distinct from
     (to_jsonb(OLD)-'idempotency_key'-'published_revision_id')
    or OLD.published_revision_id is not null then
    raise exception using errcode='55000',message='Shared DTSI preview intent is immutable';
  end if;
  return NEW;
end $$;
create trigger shared_dtsi_revision_immutable before update or delete on public.shared_dtsi_revisions
  for each row execute function public.guard_shared_dtsi_revision();
create trigger shared_dtsi_revision_member_immutable before update or delete on public.shared_dtsi_revision_members
  for each row execute function public.guard_shared_dtsi_revision();
create trigger shared_dtsi_preview_immutable before update on public.shared_dtsi_publication_previews
  for each row execute function public.guard_shared_dtsi_preview();

do $$ declare source_grant record; target text; begin
  for source_grant in select grantee,privilege_type from information_schema.role_table_grants
    where table_schema='public' and table_name='project_parameter_files'
      and privilege_type in ('SELECT','INSERT','UPDATE') and grantee<>'PUBLIC'
  loop
    if source_grant.privilege_type in ('SELECT','INSERT') then
      foreach target in array array['shared_dtsi_revisions','shared_dtsi_revision_members'] loop
        execute format('grant %s on public.%I to %I',source_grant.privilege_type,target,source_grant.grantee);
      end loop;
    end if;
    execute format('grant %s on public.shared_dtsi_publication_previews to %I',source_grant.privilege_type,source_grant.grantee);
  end loop;
  foreach target in array array['shared_dtsi_revisions','shared_dtsi_revision_members','shared_dtsi_publication_previews'] loop
    execute format('create trigger organization_lifecycle_guard before insert or update or delete on public.%I for each row execute function public.guard_organization_lifecycle()',target);
  end loop;
end $$;
