-- Platform cleanup facts deliberately outlive both the target and its accounts.
-- target_organization_id is a historical target, not ownership of tenant content.
create table public.organization_erasures (
  id text primary key,
  target_organization_id text not null unique,
  actor_user_id text not null,
  status text not null check(status in ('queued','running','failed','deleted')),
  stage text not null check(stage in ('domains','management','finalize','complete')),
  counts jsonb not null,
  attempts integer not null default 0,
  error_code text,
  lease_owner text,
  lease_expires_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz
);
-- Existing runtime installs do not rerun provisioning on upgrade. Only the
-- application API's established public account writer receives this boundary.
do $$ declare role_name text; begin
  for role_name in select rolname from pg_roles where not rolsuper
    and has_table_privilege(oid,'public.users','UPDATE')
    and pg_has_role(oid,'catalog_publication_coordinator_role','MEMBER')
  loop execute format('grant select,insert,update,delete on public.organization_erasures to %I',role_name); end loop;
end $$;
alter table public.organizations drop constraint organizations_status_check;
alter table public.organizations add constraint organizations_status_check check(status in ('active','suspended','deleting'));

-- A deleting owner rejects ALL old suspension exceptions, including profile,
-- lifecycle restore and admitted completion. Only the current durable cleanup
-- lease may DELETE this explicit management set. Domain adapters add their own
-- bounded operations; this is not a business-write/maintenance bypass.
do $$
declare installed text; changed text;
begin
  select pg_get_functiondef('public.guard_organization_lifecycle()'::regprocedure) into strict installed;
  changed := replace(installed,'declare old_value jsonb;','declare user_links text[]; link text; detach boolean; compare_old jsonb; compare_new jsonb; old_value jsonb;');
  changed := replace(changed,
    'if tg_table_name=''organizations'' and tg_op=''INSERT'' then return new; end if;',
    $guard$if tg_table_name='organizations' and tg_op='INSERT' then
    if exists(select 1 from public.organization_erasures where target_organization_id=new_value->>'id') then
      raise exception using errcode='55000',message='Organization erasure cannot be reversed';
    end if;
    return new;
  end if;
  for org in select distinct id from unnest(array[
    case when old_value is not null then public.lifecycle_organization(tg_table_schema,tg_table_name,old_value) end,
    case when new_value is not null then public.lifecycle_organization(tg_table_schema,tg_table_name,new_value) end]) id where id is not null order by id
  loop
    select status into state from public.organizations where id=org for share;
    -- FK deletion may detach a departed B account from retained A content even
    -- while A is suspended. This admits no ordinary update, business change,
    -- timestamp/history rewrite, or change under a deleting foreign owner.
    if state='suspended' and tg_op='UPDATE' and pg_trigger_depth()>1 and exists(
      select 1 from public.organization_erasures e where e.status='running' and e.stage='management'
        and e.target_organization_id<>org and e.id=current_setting('wiseeff.organization_erasure_id',true)
        and e.lease_owner=current_setting('wiseeff.organization_erasure_lease',true) and e.lease_expires_at>clock_timestamp()) then
      select array_agg(a.attname::text) into user_links from pg_constraint c
        join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
        where c.conrelid=tg_relid and c.contype='f' and c.confrelid='public.users'::regclass
          and cardinality(c.conkey)=1 and cardinality(c.confkey)=1 and c.confdeltype='n';
      compare_old:=old_value; compare_new:=new_value;
      -- These two existing projections run before this guard: 0271's draft
      -- owner-deleted projection and 0136's DTS deleted principal. Their live
      -- execution fields may change, never business/history/timestamps.
      if tg_table_schema='public' and (
          (tg_table_name='parameter_drafts' and old_value->>'initiator_type' in ('user','agent') and old_value->>'user_id' is not null and new_value->>'user_id' is null)
          or (tg_table_name='dts_config_revisions' and old_value->>'initiator_type'='user' and old_value->>'created_by_user_id' is not null and new_value->>'created_by_user_id' is null))
        and new_value->>'initiator_type'='legacy'
        and new_value->>'initiator_session_id' is null and new_value->>'initiator_tool_call_id' is null
        and new_value->>'initiator_approval_id' is null and new_value->>'initiator_system_kind' is null
        and new_value->>'initiator_system_name' is null then
        compare_old:=old_value-array['initiator_type','initiator_session_id','initiator_tool_call_id','initiator_approval_id','initiator_system_kind','initiator_system_name'];
        compare_new:=new_value-array['initiator_type','initiator_session_id','initiator_tool_call_id','initiator_approval_id','initiator_system_kind','initiator_system_name'];
      elsif tg_table_schema='public' and tg_table_name='dts_config_revisions'
        and old_value->>'initiator_type'='agent' and new_value->>'initiator_type'='agent'
        and old_value->>'created_by_user_id' is not null and new_value->>'created_by_user_id' is null
        and old_value->>'initiator_principal_deleted'='false' and new_value->>'initiator_principal_deleted'='true' then
        compare_old:=old_value-'initiator_principal_deleted'; compare_new:=new_value-'initiator_principal_deleted';
      end if;
      if cardinality(user_links)>0 and compare_old-user_links=compare_new-user_links then
        detach:=old_value is distinct from new_value;
        foreach link in array user_links loop
          if old_value->link is distinct from new_value->link and (
            old_value->>link is null or new_value->>link is not null
            or not coalesce(nullif(current_setting('wiseeff.organization_erasure_users',true),'')::jsonb ? (old_value->>link),false)
            or exists(select 1 from public.users where id=old_value->>link)) then detach:=false; end if;
        end loop;
        if detach then return new; end if;
      end if;
    end if;
    if state='deleting' then
      if tg_op='DELETE' and tg_table_schema='public' and tg_table_name=any(array[
        'organizations','users','user_role_bindings','local_registration_role_requests',
        'organization_invitations','organization_teams','organization_team_members'])
        and exists(select 1 from public.organization_erasures e
          where e.target_organization_id=org and e.status='running' and e.stage='management'
            and e.id=current_setting('wiseeff.organization_erasure_id',true)
            and e.lease_owner=current_setting('wiseeff.organization_erasure_lease',true)
            and e.lease_expires_at>clock_timestamp()) then return old; end if;
      raise exception using errcode='55000',message='Organization is being permanently erased',detail=org;
    end if;
  end loop;$guard$);
  if changed=installed or position('declare user_links' in changed)=0 or position('Organization erasure cannot be reversed' in changed)=0 then raise exception 'Lifecycle insertion branch was not found'; end if;
  execute changed;
end $$;
