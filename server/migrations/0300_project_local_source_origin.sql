-- Local source edits use the existing approved source receipt and exact
-- logical-node/property graph proof when the effective physical origin moves.
do $$
declare installed text; changed text;
begin
  select pg_get_functiondef('parameter_catalog.source_origin_matches(text,text,text)'::regprocedure) into strict installed;
  changed := replace(installed,
    'request.request_kind in (''member_addition'',''configuration_restore'')',
    'request.request_kind in (''member_addition'',''configuration_restore'',''source_revision'')');
  changed := replace(changed,
    '''member_addition'',''member-removal'',''configuration_restore''',
    '''member_addition'',''member-removal'',''configuration_restore'',''source_revision''');
  if changed=installed then raise exception 'Source origin receipt guard is unavailable'; end if;
  execute changed;

  -- Preserve surviving transferred pins through the established immutable
  -- Definition-erasure receipt if another Definition shared this request.
  select pg_get_functiondef('parameter_catalog.purge_parameter_definition(text,jsonb,text,text)'::regprocedure) into strict installed;
  changed := replace(installed,
    'request.request_kind in (''member_addition'',''configuration_restore'')',
    'request.request_kind in (''member_addition'',''configuration_restore'',''source_revision'')');
  changed := replace(changed,
    '''member_addition'',''member-removal'',''configuration_restore''',
    '''member_addition'',''member-removal'',''configuration_restore'',''source_revision''');
  if changed=installed then raise exception 'Source erasure receipt guard is unavailable'; end if;
  execute changed;
end $$;
