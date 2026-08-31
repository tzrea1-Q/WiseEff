begin transaction isolation level repeatable read read only;
\pset format csv

select
  ns.nspname as schema_name,
  rel.relname as relation_name,
  trg.tgname as trigger_name,
  pg_get_triggerdef(trg.oid, true) as definition,
  proc.proname as function_name,
  trg.tgenabled as enabled_mode
from pg_trigger trg
inner join pg_class rel on rel.oid = trg.tgrelid
inner join pg_namespace ns on ns.oid = rel.relnamespace
inner join pg_proc proc on proc.oid = trg.tgfoid
where ns.nspname = 'public'
  and not trg.tgisinternal
order by rel.relname, trg.tgname;

commit;
