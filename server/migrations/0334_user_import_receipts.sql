create table public.user_import_receipts (
  id uuid not null,
  organization_id text not null references public.organizations(id),
  actor_user_id text references public.users(id) on delete set null,
  actor_id_snapshot text not null,
  created_at timestamptz not null default now(),
  item_count integer not null check (item_count between 1 and 500),
  intent_digest text not null check (intent_digest ~ '^[a-f0-9]{64}$'),
  results jsonb not null check (jsonb_typeof(results) = 'array'),
  unique (id, organization_id, actor_user_id)
);

grant select on public.user_import_receipts to catalog_migration_owner;
do $$ declare role_name text; begin
  for role_name in select rolname from pg_roles where has_table_privilege(oid, 'public.log_domains', 'INSERT')
    and oid <> (select relowner from pg_class where oid='public.user_import_receipts'::regclass) and rolname <> 'PUBLIC'
  loop
    execute format('grant select, insert, update, delete on public.user_import_receipts to %I', role_name);
  end loop;
end $$;
do $$ declare installed text; changed text; begin
  select pg_get_functiondef('parameter_catalog.preview_organization_deletion_0276(text,text)'::regprocedure) into strict installed;
  changed:=replace(installed,'for target in select * from (values', $inventory$for target in select * from (values
    ('public.user_import_receipts','accounts','r.organization_id=$1'),$inventory$);
  if changed=installed then raise exception 'Organization ownership inventory seam was not found'; end if;
  execute changed;
end $$;
