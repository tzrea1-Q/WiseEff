create table if not exists workflow_publication (
  singleton boolean primary key default true check (singleton),
  workflows jsonb not null check (jsonb_typeof(workflows) = 'object'),
  version integer not null default 0 check (version >= 0),
  updated_at timestamptz,
  updated_by_user_id text references users(id) on delete set null
);

-- Only workflows already launched at this migration are initially published.
-- Future catalog additions are absent here and therefore remain unpublished.
insert into workflow_publication (singleton, workflows)
values (true, '{"parameter-management":true,"debugging":true,"log-analysis":true,"knowledge":true}'::jsonb)
on conflict (singleton) do nothing;

do $$
declare role_name text;
begin
  for role_name in select rolname from pg_roles
    where has_table_privilege(oid, 'public.log_domains', 'INSERT')
      and oid <> (select relowner from pg_class where oid = 'public.workflow_publication'::regclass)
      and rolname <> 'PUBLIC'
  loop
    execute format('grant select, insert, update, delete on public.workflow_publication to %I', role_name);
  end loop;
end; $$;
