create table public.organization_teams (
  id text primary key,
  organization_id text not null references public.organizations(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 80),
  created_at timestamptz not null default now(),
  unique(id,organization_id)
);
create unique index organization_teams_name_unique on public.organization_teams(organization_id,lower(btrim(name)));
create table public.organization_team_members (
  team_id text not null,
  organization_id text not null,
  user_id text not null,
  primary key(team_id,user_id),
  foreign key(team_id,organization_id) references public.organization_teams(id,organization_id) on delete cascade,
  foreign key(user_id,organization_id) references public.users(id,organization_id) on delete cascade
);
create index organization_team_members_user_idx on public.organization_team_members(user_id,organization_id);

-- Mirror the existing member-directory grants without granting team writes to read-only runtimes.
do $$ declare team_grant record; table_name text; begin
  for team_grant in select grantee,privilege_type from information_schema.role_table_grants
    where table_schema='public' and information_schema.role_table_grants.table_name='users'
      and privilege_type in ('SELECT','INSERT','UPDATE','DELETE') and grantee<>'PUBLIC'
  loop
    if team_grant.privilege_type='SELECT' or pg_has_role(team_grant.grantee,'catalog_publication_coordinator_role','MEMBER') then
      foreach table_name in array array['organization_teams','organization_team_members'] loop
        execute format('grant %s on public.%I to %I',team_grant.privilege_type,table_name,team_grant.grantee);
      end loop;
    end if;
  end loop;
end $$;
