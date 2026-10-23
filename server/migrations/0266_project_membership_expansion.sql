-- Participation is separate from user_role_bindings, which retains review/merge duties.
create table public.project_members (
  organization_id text not null,
  project_id text not null,
  user_id text not null,
  roles text[] not null check (
    cardinality(roles) > 0 and array_position(roles, null) is null
    and roles <@ array['hardware-user','software-user','hardware-committer','software-committer']::text[]
  ),
  created_at timestamptz not null default now(),
  primary key (organization_id, project_id, user_id),
  foreign key (project_id, organization_id) references public.projects(id, organization_id) on delete cascade,
  foreign key (user_id, organization_id) references public.users(id, organization_id) on delete cascade
);
create index project_members_user_idx on public.project_members(user_id, organization_id);

-- Expand valid existing business grants, including inactive accounts, without changing
-- their IDs, active state or old authorization. Admin management needs no membership.
insert into public.project_members(organization_id, project_id, user_id, roles)
select p.organization_id, p.id, u.id, array_agg(distinct b.role_id order by b.role_id)
from public.projects p
join public.users u on u.organization_id = p.organization_id
join public.user_role_bindings b on b.user_id = u.id and b.organization_id = u.organization_id
  and (b.project_id is null or b.project_id = p.id)
where b.role_id in ('hardware-user','software-user','hardware-committer','software-committer')
group by p.organization_id, p.id, u.id;

-- Retain the existing grant boundary for each runtime role, including read-only readers.
do $$ declare member_grant record; begin
  for member_grant in select distinct grantee, privilege_type from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'user_role_bindings'
      and privilege_type in ('SELECT','INSERT','UPDATE','DELETE') and grantee <> 'PUBLIC'
  loop
    execute format('grant %s on public.project_members to %I', member_grant.privilege_type, member_grant.grantee);
  end loop;
end $$;
