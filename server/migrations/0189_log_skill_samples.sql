create table log_skill_samples (
  id text primary key,
  organization_id text not null references organizations(id),
  skill_id text not null unique,
  file_name text not null,
  size_bytes bigint not null check (size_bytes between 0 and 2097152),
  sha256 text not null,
  encoding text not null check (encoding in ('utf-8', 'utf-16le', 'utf-16be')),
  line_count integer not null check (line_count >= 0),
  object_key text not null,
  uploaded_by_user_id text references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (skill_id, organization_id) references log_domains(id, organization_id) on delete cascade
);
create index log_skill_samples_org_skill_idx on log_skill_samples(organization_id, skill_id);
do $$
declare role_name text;
begin
  for role_name in select rolname from pg_roles
    where has_table_privilege(oid, 'public.log_domains', 'INSERT')
      and oid <> (select relowner from pg_class where oid = 'public.log_skill_samples'::regclass)
      and rolname <> 'PUBLIC'
  loop
    execute format('grant select, insert, update, delete on public.log_skill_samples to %I', role_name);
  end loop;
end $$;
