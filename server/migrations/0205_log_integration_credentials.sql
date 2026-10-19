create table log_integration_credentials (
  id text primary key,
  organization_id text not null references organizations(id),
  name text not null check (length(btrim(name)) between 1 and 120),
  skill_id text,
  secret_hash text not null check (secret_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'active' check (status in ('active', 'revoked')),
  created_by text references users(id) on delete set null,
  created_at timestamptz not null default now(),
  rotated_at timestamptz,
  revoked_at timestamptz,
  last_used_at timestamptz,
  unique (id, organization_id),
  foreign key (skill_id, organization_id) references log_domains(id, organization_id),
  check ((status = 'active' and revoked_at is null) or (status = 'revoked' and revoked_at is not null))
);
create index log_integration_credentials_org_skill_idx on log_integration_credentials(organization_id, skill_id);

alter table log_records add column created_by_credential_id text;
alter table log_records add foreign key (created_by_credential_id, organization_id)
  references log_integration_credentials(id, organization_id);
alter table log_records add check (created_by_credential_id is null or submitted_by_user_id is null);
create index log_records_credential_idx on log_records(organization_id, created_by_credential_id);

alter table log_file_objects add column created_by_credential_id text;
alter table log_file_objects add foreign key (created_by_credential_id, organization_id)
  references log_integration_credentials(id, organization_id);
alter table log_file_objects add check (created_by_credential_id is null or uploaded_by_user_id is null);

-- Covers both archive APIs and direct domain status writes, in the same transaction.
create function revoke_archived_log_skill_credentials() returns trigger language plpgsql as $$
begin
  if new.status = 'archived' then
    update log_integration_credentials set status = 'revoked', revoked_at = clock_timestamp()
      where organization_id = new.organization_id and skill_id = new.id and status = 'active';
  end if;
  return new;
end $$;
create trigger revoke_archived_log_skill_credentials after update of status on log_domains
  for each row execute function revoke_archived_log_skill_credentials();

do $$
declare role_name text;
begin
  for role_name in select rolname from pg_roles
    where has_table_privilege(oid, 'public.log_domains', 'INSERT')
      and oid <> (select relowner from pg_class where oid = 'public.log_integration_credentials'::regclass)
      and rolname <> 'PUBLIC'
  loop
    execute format('grant select, insert, update, delete on public.log_integration_credentials to %I', role_name);
  end loop;
end $$;
