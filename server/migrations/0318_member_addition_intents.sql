-- A reservation carries no preview proof, request body, reason or digest.
-- Its mutation identity remains a fence even after an applied receipt is erased.
create table public.member_addition_intents (
  id text primary key,
  organization_id text not null,
  project_id text not null,
  config_set_id text not null,
  actor_user_id text references public.users(id) on delete set null,
  registration_id uuid,
  mutation_id uuid,
  status text not null default 'pending' check(status in ('pending','applied','stopped')),
  acknowledged boolean not null default false,
  created_at timestamptz not null default now(),
  registration_audit_id text not null unique references public.audit_events(id) on delete restrict,
  stop_audit_id text unique references public.audit_events(id) on delete restrict,
  ack_audit_id text unique references public.audit_events(id) on delete restrict,
  foreign key(config_set_id,organization_id,project_id) references public.dts_config_set(id,organization_id,project_id) on delete restrict,
  check ((actor_user_id is null and registration_id is null and mutation_id is null)
      or (actor_user_id is not null and registration_id is not null and mutation_id is not null)),
  check ((status='stopped')=(stop_audit_id is not null)),
  check (acknowledged=(ack_audit_id is not null)),
  check (not acknowledged or status in ('applied','stopped'))
);
create unique index member_addition_intent_registration_uk on public.member_addition_intents(organization_id,actor_user_id,registration_id) where actor_user_id is not null;
create unique index member_addition_intent_mutation_uk on public.member_addition_intents(organization_id,project_id,actor_user_id,mutation_id) where actor_user_id is not null;

create function public.guard_member_addition_intent() returns trigger language plpgsql set search_path=pg_catalog,public,parameter_catalog as $$
declare event_id text; event_action text;
begin
  if tg_op='DELETE' then
    if parameter_catalog.definition_purge_allows_change(tg_table_schema,tg_table_name,to_jsonb(old),'DELETE') then return old; end if;
    raise exception using errcode='55000',message='Member operation identity is immutable';
  end if;
  if tg_op='UPDATE' and pg_trigger_depth()>1 and old.actor_user_id is not null and new.actor_user_id is null
     and not exists(select 1 from public.users where id=old.actor_user_id)
     and to_jsonb(new)-array['actor_user_id','registration_id','mutation_id']=to_jsonb(old)-array['actor_user_id','registration_id','mutation_id'] then
    new.registration_id:=null; new.mutation_id:=null; return new;
  end if;
  if tg_op='INSERT' then
    if new.status<>'pending' or new.acknowledged then raise exception using errcode='23514',message='Member operation must start pending'; end if;
    event_id:=new.registration_audit_id; event_action:='member-operation-reserved';
  else
    if to_jsonb(new)-array['status','acknowledged','stop_audit_id','ack_audit_id'] is distinct from to_jsonb(old)-array['status','acknowledged','stop_audit_id','ack_audit_id'] then
      raise exception using errcode='55000',message='Member operation identity is immutable';
    end if;
    if old.status='pending' and new.status='applied' and new.acknowledged=old.acknowledged
       and new.stop_audit_id is not distinct from old.stop_audit_id and new.ack_audit_id is not distinct from old.ack_audit_id then
      if not exists(select 1 from public.project_parameter_value_change_requests r join public.audit_events a on a.id=r.applied_audit_ref
        where r.organization_id=new.organization_id and r.project_id=new.project_id and r.source_revision_config_set_id=new.config_set_id
          and r.submitter_user_id=new.actor_user_id and r.source_revision_mutation_id=new.mutation_id::text
          and r.request_kind='member_addition' and r.status='approved' and r.applied_source_result is not null
          and a.organization_id=new.organization_id and a.project_id=new.project_id and a.target_id=r.id and a.action='value-change-applied') then
        raise exception using errcode='23514',message='Member operation has no applied receipt';
      end if;
      return new;
    elsif old.status='pending' and new.status='stopped' and new.acknowledged=old.acknowledged and new.ack_audit_id is not distinct from old.ack_audit_id then
      event_id:=new.stop_audit_id;event_action:='member-operation-stopped';
    elsif old.status in ('applied','stopped') and new.status=old.status and not old.acknowledged and new.acknowledged
      and new.stop_audit_id is not distinct from old.stop_audit_id then
      event_id:=new.ack_audit_id;event_action:='member-operation-acknowledged';
    else raise exception using errcode='55000',message='Invalid member operation transition'; end if;
  end if;
  if not exists(select 1 from public.audit_events a where a.id=event_id and a.organization_id=new.organization_id
    and a.project_id=new.project_id and a.actor_user_id=new.actor_user_id and a.action=event_action
    and a.target_type='member-addition-intent' and a.target_id=new.id and a.metadata->>'configSetId'=new.config_set_id) then
    raise exception using errcode='23514',message='Member operation requires its exact audit';
  end if;
  return new;
end $$;
create trigger a_member_addition_intent_guard before insert or update or delete on public.member_addition_intents for each row execute function public.guard_member_addition_intent();
create trigger organization_lifecycle_guard before insert or update or delete on public.member_addition_intents for each row execute function public.guard_organization_lifecycle();

grant select,delete on public.member_addition_intents to catalog_migration_owner;
do $$ declare role_name text; begin
  for role_name in select rolname from pg_roles where not rolsuper and has_table_privilege(oid,'public.users','UPDATE')
    and pg_has_role(oid,'catalog_publication_coordinator_role','MEMBER') loop
    execute format('grant select,insert,update(status,acknowledged,stop_audit_id,ack_audit_id) on public.member_addition_intents to %I',role_name);
    execute format('revoke delete on public.member_addition_intents from %I',role_name);
  end loop;
end $$;

do $$ declare installed text; changed text; begin
  -- Project deletion permanently reserves its ID; its exact owned intents may
  -- be removed by the same capability closure before the ConfigSet disappears.
  select pg_get_functiondef('parameter_catalog.purge_project(text,text,text,text)'::regprocedure) into strict installed;
  changed:=replace(installed,'for entry in select * from (values', $project$for entry in select * from (values
    (-6,'public.member_addition_intents','organization_id=$1 and project_id=$2'),$project$);
  if changed=installed then raise exception 'Project intent purge seam missing'; end if; execute changed;
  select pg_get_functiondef('parameter_catalog.lock_project_erasure(text,text,text)'::regprocedure) into strict installed;
  changed:=replace(installed,'lock table public.project_shared_dtsi_references,',
    'lock table public.member_addition_intents,public.project_shared_dtsi_references,');
  if changed=installed then raise exception 'Project intent lock seam missing'; end if; execute changed;
  select pg_get_functiondef('parameter_catalog.preview_organization_deletion_0276(text,text)'::regprocedure) into strict installed;
  changed:=replace(installed,'for target in select * from (values', $inventory$for target in select * from (values
    ('public.member_addition_intents','projects','r.organization_id=$1'),$inventory$);
  if changed=installed then raise exception 'Organization intent inventory seam missing'; end if; execute changed;
  select pg_get_functiondef('parameter_catalog.purge_organization_parameter_assets(text,text,text)'::regprocedure) into strict installed;
  changed:=replace(installed,'  -- Fixed ownership closure, never recursive FK discovery or arbitrary tables.', $locks$  lock table public.member_addition_intents in share row exclusive mode;
  -- Fixed ownership closure, never recursive FK discovery or arbitrary tables.$locks$);
  if changed=installed then raise exception 'Organization intent lock seam missing'; end if; installed:=changed;
  changed:=replace(installed,'for entry in select * from (values', $closure$for entry in select * from (values
    ('public.member_addition_intents','organization_id=$1'),$closure$);
  if changed=installed then raise exception 'Organization intent purge seam missing'; end if; execute changed;
  select pg_get_functiondef('public.guard_organization_lifecycle()'::regprocedure) into strict installed;
  changed:=replace(installed,'if tg_op=''DELETE'' and ((tg_table_schema=', $guard$if tg_op='DELETE' and tg_table_schema='public' and tg_table_name='member_addition_intents'
    and parameter_catalog.definition_purge_allows_change(TG_TABLE_SCHEMA,TG_TABLE_NAME,old_value,'DELETE') then return old; end if;
  if tg_op='DELETE' and ((tg_table_schema=$guard$);
  if changed=installed then raise exception 'Organization intent lifecycle seam missing'; end if; installed:=changed;
  changed:=replace(installed,'compare_old:=old_value; compare_new:=new_value;', $detach$compare_old:=old_value; compare_new:=new_value;
      if tg_table_schema='public' and tg_table_name='member_addition_intents' and old_value->>'actor_user_id' is not null
        and new_value->>'actor_user_id' is null and new_value->>'registration_id' is null and new_value->>'mutation_id' is null then
        compare_old:=old_value-array['registration_id','mutation_id'];compare_new:=new_value-array['registration_id','mutation_id'];
      end if;$detach$);
  if changed=installed then raise exception 'Organization intent attribution seam missing'; end if; execute changed;
end $$;
