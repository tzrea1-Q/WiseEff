-- Extend the shared-source fence with the same exact FK anonymization
-- projection as 0243. Business content and retained historical evidence stay immutable.
do $$ declare installed text; changed text; detach text; begin
  detach:=$detach$pg_trigger_depth()>1 and to_jsonb(old)->>'created_by_user_id' is not null
       and to_jsonb(new)->>'created_by_user_id' is null
       and not exists(select 1 from public.users where id=to_jsonb(old)->>'created_by_user_id')
       and to_jsonb(old)->>'initiator_type' in ('user','agent')
       and to_jsonb(new)=case to_jsonb(old)->>'initiator_type'
         when 'user' then to_jsonb(old)||jsonb_build_object('created_by_user_id',null,'initiator_type','legacy',
           'initiator_principal_deleted',false,'initiator_system_kind',null,'initiator_system_name',null,
           'initiator_session_id',null,'initiator_tool_call_id',null,'initiator_approval_id',null)
         when 'agent' then to_jsonb(old)||jsonb_build_object('created_by_user_id',null,'initiator_principal_deleted',true)
         end$detach$;
  select pg_get_functiondef('public.guard_project_shared_dtsi_source()'::regprocedure) into strict installed;
  changed:=replace(installed,E'begin\n',E'begin\n  if tg_op=''UPDATE'' and tg_table_name=''project_parameter_file_versions'' and ('||detach||E') then return new; end if;\n');
  if changed=installed then raise exception 'Shared source attribution guard is unavailable'; end if;
  execute changed;
end $$;
