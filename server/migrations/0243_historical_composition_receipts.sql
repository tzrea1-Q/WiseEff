-- Account deletion may detach live user FKs while immutable composition and
-- parameter receipts continue proving the historical operation.
do $$
declare installed text; changed text; detach text;
begin
  detach:=$detach$pg_trigger_depth()>1 and to_jsonb(old)->>'created_by_user_id' is not null
       and to_jsonb(new)->>'created_by_user_id' is null
       and not exists(select 1 from public.users where id=to_jsonb(old)->>'created_by_user_id')
       and to_jsonb(new)=case to_jsonb(old)->>'initiator_type'
         when 'user' then to_jsonb(old)||jsonb_build_object('created_by_user_id',null,'initiator_type','legacy',
           'initiator_principal_deleted',false,'initiator_system_kind',null,'initiator_system_name',null,
           'initiator_session_id',null,'initiator_tool_call_id',null,'initiator_approval_id',null)
         when 'agent' then to_jsonb(old)||jsonb_build_object('created_by_user_id',null,'initiator_principal_deleted',true)
         else to_jsonb(old)||jsonb_build_object('created_by_user_id',null) end$detach$;
  select pg_get_functiondef('parameter_catalog.protect_pinned_source_provenance()'::regprocedure) into strict installed;
  changed:=replace(installed,$old$and new is not distinct from old then return new; end if;$old$,
    'and (new is not distinct from old or ('||detach||')) then return new; end if;');
  if changed=installed then raise exception 'Pinned source attribution guard is unavailable'; end if;
  execute changed;
  select pg_get_functiondef('parameter_catalog.protect_pinned_source_file()'::regprocedure) into strict installed;
  changed:=replace(installed,E'begin\n',E'begin\n  if tg_op=''UPDATE'' and ('||detach||E') then return new; end if;\n');
  if changed=installed then raise exception 'Pinned file attribution guard is unavailable'; end if;
  execute changed;
end $$;

-- Recheck historical pins, versions and audit receipts on an approved request's
-- later FK update. Only the initial application must also match today's tips.
do $$
declare installed text; changed text; routine text;
begin
  foreach routine in array array['assert_member_addition_receipt','assert_configuration_restore_receipt','assert_member_exposed_properties'] loop
    select pg_get_functiondef(to_regprocedure('parameter_catalog.'||routine||'()')) into strict installed;
    changed:=replace(installed,'declare','declare historical_receipt boolean := false;');
    changed:=replace(changed,E'begin\n',E'begin\n  historical_receipt := tg_op=''UPDATE'' and tg_table_name=''project_parameter_value_change_requests'' and to_jsonb(old)->>''status''=''approved'';\n');
    if routine='assert_member_addition_receipt' then
      changed:=replace(changed,'and file.project_id=r.project_id and file.config_set_id=revision.config_set_id and file.current_version_id=member.file_version_id
        and file.config_set_role=member.role and file.config_set_sort_order=member.sort_order',
        'and file.project_id=r.project_id and (historical_receipt or (file.config_set_id=revision.config_set_id and file.current_version_id=member.file_version_id
        and file.config_set_role=member.role and file.config_set_sort_order=member.sort_order))');
      changed:=replace(changed,'and file.format=frozen->>''format'' and file.config_set_id=r.source_revision_config_set_id
          and file.current_version_id=member.file_version_id',
        'and file.format=frozen->>''format'' and (historical_receipt or (file.config_set_id=r.source_revision_config_set_id
          and file.current_version_id=member.file_version_id))');
      changed:=replace(changed,'pin.project_value_id=binding.current_value_id','(historical_receipt or pin.project_value_id=binding.current_value_id)');
      if position('and (historical_receipt or (file.config_set_id=revision.config_set_id' in changed)=0
        or position('and (historical_receipt or (file.config_set_id=r.source_revision_config_set_id' in changed)=0 then
        raise exception 'Member addition historical composition markers are unavailable';
      end if;
    elsif routine='assert_configuration_restore_receipt' then
      changed:=replace(changed,$old$or (select count(*) from public.project_parameter_files where organization_id=r.organization_id and project_id=r.project_id
      and config_set_id=r.source_revision_config_set_id)<>jsonb_array_length(r.source_revision_context->'members')$old$,
        $new$or (not historical_receipt and (select count(*) from public.project_parameter_files where organization_id=r.organization_id and project_id=r.project_id
      and config_set_id=r.source_revision_config_set_id)<>jsonb_array_length(r.source_revision_context->'members'))$new$);
      changed:=replace(changed,'and file.config_set_id=r.source_revision_config_set_id and file.current_version_id=version.id
          and file.config_set_role=case when member.role=''include'' then ''misc'' else member.role end and file.config_set_sort_order=member.sort_order',
        'and (historical_receipt or (file.config_set_id=r.source_revision_config_set_id and file.current_version_id=version.id
          and file.config_set_role=case when member.role=''include'' then ''misc'' else member.role end and file.config_set_sort_order=member.sort_order))');
      changed:=replace(changed,$old$or (select count(*) from parameter_catalog.current_project_parameter_bindings binding$old$,
        $new$or (not historical_receipt and (select count(*) from parameter_catalog.current_project_parameter_bindings binding$new$);
      changed:=replace(changed,$old$<>jsonb_array_length(result->'results') then$old$,$new$<>jsonb_array_length(result->'results')) then$new$);
      if position('not historical_receipt and (select count(*) from public.project_parameter_files' in changed)=0
        or position('not historical_receipt and (select count(*) from parameter_catalog.current_project_parameter_bindings' in changed)=0 then
        raise exception 'Configuration restore historical composition markers are unavailable';
      end if;
    else
      changed:=replace(changed,'from parameter_catalog.current_project_parameter_bindings binding','from parameter_catalog.project_parameter_bindings binding');
      changed:=replace(changed,'value.id=binding.current_value_id and value.binding_id=binding.id','(historical_receipt or value.id=binding.current_value_id) and value.binding_id=binding.id');
      changed:=replace(changed,'where binding.organization_id=request_row.organization_id',
        'where (historical_receipt or exists(select 1 from parameter_catalog.current_project_parameter_bindings current_binding where current_binding.id=binding.id))
      and binding.organization_id=request_row.organization_id');
      changed:=replace(changed,$old$and occurrence.config_set_id=request_row.member_config_set_id;
  if total$old$,$new$and occurrence.config_set_id=request_row.member_config_set_id
    and (not historical_receipt or exists(select 1 from parameter_catalog.project_value_source_pins pin
      where pin.binding_id=binding.id and pin.config_revision_id=request_row.applied_source_result->>'successorConfigRevisionId' and pin.value_state='present'));
  if total$new$);
      if position('and (not historical_receipt or exists(select 1 from parameter_catalog.project_value_source_pins pin' in changed)=0 then
        raise exception 'Member removal historical cohort marker is unavailable';
      end if;
    end if;
    if changed=installed then raise exception 'Historical composition receipt guard is unavailable: %',routine; end if;
    execute changed;
  end loop;
end $$;
