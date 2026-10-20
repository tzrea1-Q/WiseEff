-- The erasure capability belongs only to the NOLOGIN migration owner. Ordinary
-- trigger callers must not gain a public SECURITY DEFINER entry point merely
-- to discover that no rows were marked for their transaction.
revoke execute on function parameter_catalog.definition_purge_allows_change(text,text,jsonb,text) from public;

do $$
declare routine record; original text; rewritten text; changed integer:=0;
  old_branch text:=E'if TG_OP in (''UPDATE'',''DELETE'') and parameter_catalog.definition_purge_allows_change(TG_TABLE_SCHEMA,TG_TABLE_NAME,to_jsonb(OLD),TG_OP) then\n    if TG_OP=''DELETE'' then return OLD; else return NEW; end if;\n  end if;';
  private_branch text:=E'if TG_OP in (''UPDATE'',''DELETE'') and current_user=''catalog_migration_owner'' then\n    if parameter_catalog.definition_purge_allows_change(TG_TABLE_SCHEMA,TG_TABLE_NAME,to_jsonb(OLD),TG_OP) then\n      if TG_OP=''DELETE'' then return OLD; else return NEW; end if;\n    end if;\n  end if;';
begin
  for routine in select distinct p.oid from pg_trigger t join pg_proc p on p.oid=t.tgfoid
    join pg_namespace n on n.oid=p.pronamespace
    where not t.tgisinternal and n.nspname in ('public','parameter_catalog','catalog_publication')
  loop
    original:=pg_get_functiondef(routine.oid);
    rewritten:=replace(original,old_branch,private_branch);
    if rewritten<>original then execute rewritten; changed:=changed+1; end if;
  end loop;
  if changed=0 then raise exception 'Missing definition erasure trigger capability branches'; end if;
end;
$$;
