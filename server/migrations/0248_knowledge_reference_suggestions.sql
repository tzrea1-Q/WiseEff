create unique index knowledge_revisions_id_entry_organization_idx on knowledge_revisions(id, entry_id, organization_id);

create table knowledge_reference_suggestions (
  organization_id text not null references organizations(id),
  entry_id uuid not null,
  definition_id text not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'dismissed', 'withdrawn')),
  property_key text not null,
  mention_count integer not null check (mention_count > 0),
  snippet text not null,
  page integer check (page > 0),
  detected_revision_id uuid not null,
  updated_at timestamptz not null default now(),
  primary key (organization_id, entry_id, definition_id),
  foreign key (entry_id, organization_id) references knowledge_entries(id, organization_id) on delete cascade,
  foreign key (detected_revision_id, entry_id, organization_id) references knowledge_revisions(id, entry_id, organization_id) on delete cascade
);

do $$
declare role_name text;
begin
  for role_name in select rolname from pg_roles
    where has_table_privilege(oid,'public.log_domains','INSERT')
      and oid<>(select relowner from pg_class where oid='public.knowledge_reference_suggestions'::regclass)
      and rolname<>'PUBLIC'
  loop
    execute format('grant select,insert,update,delete on public.knowledge_reference_suggestions to %I',role_name);
  end loop;
end; $$;
