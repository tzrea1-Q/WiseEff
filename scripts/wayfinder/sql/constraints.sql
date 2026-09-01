begin transaction isolation level repeatable read read only;
\pset format csv

select
  ns.nspname as schema_name,
  rel.relname as relation_name,
  con.conname as constraint_name,
  case con.contype
    when 'p' then 'primary-key'
    when 'f' then 'foreign-key'
    when 'u' then 'unique'
    when 'c' then 'check'
    when 'x' then 'exclusion'
    else 'other'
  end as constraint_kind,
  pg_get_constraintdef(con.oid, true) as definition,
  con.condeferrable as deferrable,
  con.condeferred as initially_deferred,
  con.convalidated as validated
from pg_constraint con
inner join pg_class rel on rel.oid = con.conrelid
inner join pg_namespace ns on ns.oid = rel.relnamespace
where ns.nspname = 'public'
order by rel.relname, con.conname;

commit;
