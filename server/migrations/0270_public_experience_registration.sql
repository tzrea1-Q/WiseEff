create table public_experience_registration (
  singleton boolean primary key default true check (singleton),
  enabled boolean,
  organization_id text references organizations(id) on delete set null
);
-- Null keeps an explicitly enabled legacy deployment observable until an administrator saves.
insert into public_experience_registration(singleton) values(true);

do $$ declare role_name text; begin
  for role_name in select rolname from pg_roles
    where has_table_privilege(oid, 'public.log_domains', 'INSERT')
      and oid <> (select relowner from pg_class where oid='public.public_experience_registration'::regclass)
      and rolname <> 'PUBLIC'
  loop
    execute format('grant select, update on public.public_experience_registration to %I', role_name);
  end loop;
end; $$;
