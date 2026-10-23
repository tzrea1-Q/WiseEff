create table public.organization_invitations (
  id text primary key,
  organization_id text not null references public.organizations(id) on delete cascade,
  label text not null check(length(btrim(label)) between 1 and 120),
  token_hash text not null unique,
  role_ids text[] not null check(cardinality(role_ids) between 1 and 7 and role_ids <@ array['guest','hardware-user','software-user','hardware-committer','software-committer','admin','platform-admin']::text[]),
  status text not null default 'pending' check(status in ('pending','revoked','accepted')),
  expires_at timestamptz not null,
  created_by_user_id text references public.users(id) on delete set null,
  accepted_user_id text references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  check((status='accepted')=(accepted_at is not null))
);
create index organization_invitations_organization_idx on public.organization_invitations(organization_id,created_at);

-- Follow the member-directory runtime grants; read-only runtimes cannot issue invitations.
do $$ declare invitation_grant record; begin
  for invitation_grant in select grantee,privilege_type from information_schema.role_table_grants
    where table_schema='public' and table_name='users' and privilege_type in ('SELECT','INSERT','UPDATE','DELETE') and grantee<>'PUBLIC'
  loop
    if invitation_grant.privilege_type='SELECT' or pg_has_role(invitation_grant.grantee,'catalog_publication_coordinator_role','MEMBER') then
      execute format('grant %s on public.organization_invitations to %I',invitation_grant.privilege_type,invitation_grant.grantee);
    end if;
  end loop;
end $$;
