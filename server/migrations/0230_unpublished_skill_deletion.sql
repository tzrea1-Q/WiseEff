-- Retain experiment object ownership after sample replacement or case removal.
create table public.log_skill_artifact_objects (
  organization_id text not null,
  skill_id text not null,
  object_key text not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (organization_id,skill_id,object_key),
  foreign key (skill_id,organization_id) references public.log_domains(id,organization_id) on delete cascade
);
insert into public.log_skill_artifact_objects(organization_id,skill_id,object_key)
select organization_id,skill_id,object_key from public.log_skill_samples
union select organization_id,skill_id,sample_object_key from public.log_skill_dry_runs
union select organization_id,skill_id,storage_key from public.log_source_snapshots
union select organization_id,skill_id,u->>'objectKey' from public.log_skill_analysis_cases c
  cross join lateral jsonb_array_elements(c.uploads) u where u->>'objectKey' is not null
on conflict do nothing;

-- A receipt survives deletion and object-store failure; it contains no source text.
create table public.log_skill_deletions (
  organization_id text not null,
  skill_id text primary key,
  skill_name text not null,
  skill_key text not null,
  preview_version text not null check (preview_version ~ '^[0-9a-f]{64}$'),
  pending_object_keys text[] not null default '{}',
  retained_objects integer not null default 0 check (retained_objects >= 0),
  erased_by text not null,
  erased_at timestamptz not null default clock_timestamp()
);
create index log_skill_deletions_org_idx on public.log_skill_deletions(organization_id,erased_at desc);

create function public.reject_deleted_log_skill_identity() returns trigger language plpgsql as $$
begin
  if exists(select 1 from public.log_skill_deletions where skill_id=new.id) then
    raise exception using errcode='55000',message='Deleted experiment skill identity cannot be recreated';
  end if;
  return new;
end; $$;
create trigger log_skill_deleted_identity before insert or update of id on public.log_domains
  for each row execute function public.reject_deleted_log_skill_identity();

do $$
declare role_name text;
begin
  for role_name in select rolname from pg_roles
    where has_table_privilege(oid,'public.log_domains','INSERT')
      and oid<>(select relowner from pg_class where oid='public.log_skill_deletions'::regclass)
      and rolname<>'PUBLIC'
  loop
    execute format('grant select,insert,update,delete on public.log_skill_artifact_objects,public.log_skill_deletions to %I',role_name);
  end loop;
end; $$;
