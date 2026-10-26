create table public.shared_dtsi_resources (
  id text primary key,
  organization_id text not null references public.organizations(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 160),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(id,organization_id)
);
create index shared_dtsi_resources_org_updated on public.shared_dtsi_resources(organization_id,updated_at desc,id);

create table public.shared_dtsi_members (
  id text primary key,
  resource_id text not null,
  organization_id text not null,
  foreign key(resource_id,organization_id) references public.shared_dtsi_resources(id,organization_id) on delete cascade,
  unique(id,resource_id,organization_id)
);
create table public.shared_dtsi_drafts (
  id text primary key,
  resource_id text not null unique,
  organization_id text not null,
  revision integer not null default 1 check (revision>0),
  created_by_user_id text references public.users(id) on delete set null,
  updated_by_user_id text references public.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  foreign key(resource_id,organization_id) references public.shared_dtsi_resources(id,organization_id) on delete cascade,
  unique(id,resource_id,organization_id)
);
create table public.shared_dtsi_draft_members (
  draft_id text not null,
  member_id text not null,
  resource_id text not null,
  organization_id text not null,
  source_name text not null check (length(source_name) between 1 and 240),
  content text not null check (octet_length(content)<=2097152),
  primary key(draft_id,member_id),
  unique(draft_id,source_name),
  foreign key(draft_id,resource_id,organization_id) references public.shared_dtsi_drafts(id,resource_id,organization_id) on delete cascade,
  foreign key(member_id,resource_id,organization_id) references public.shared_dtsi_members(id,resource_id,organization_id) on delete cascade
);

-- Match the existing project-source runtime grants; read-only roles stay read-only.
do $$ declare source_grant record; target text; begin
  for source_grant in select grantee,privilege_type from information_schema.role_table_grants
    where table_schema='public' and table_name='project_parameter_files'
      and privilege_type in ('SELECT','INSERT','UPDATE','DELETE') and grantee<>'PUBLIC'
  loop
    foreach target in array array['shared_dtsi_resources','shared_dtsi_members','shared_dtsi_drafts','shared_dtsi_draft_members'] loop
      execute format('grant %s on public.%I to %I',source_grant.privilege_type,target,source_grant.grantee);
    end loop;
  end loop;
  foreach target in array array['shared_dtsi_resources','shared_dtsi_members','shared_dtsi_drafts','shared_dtsi_draft_members'] loop
    execute format('create trigger organization_lifecycle_guard before insert or update or delete on public.%I for each row execute function public.guard_organization_lifecycle()',target);
  end loop;
end $$;
