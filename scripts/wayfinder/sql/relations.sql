begin transaction isolation level repeatable read read only;
\pset format csv

select
  n.nspname as schema_name,
  c.relname as relation_name,
  case c.relkind
    when 'r' then 'table'
    when 'p' then 'partitioned-table'
    when 'v' then 'view'
    when 'm' then 'materialized-view'
    when 'S' then 'sequence'
    when 'f' then 'foreign-table'
    else 'other'
  end as relation_kind,
  c.relpersistence as persistence
from pg_class c
inner join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')
order by c.relname;

commit;
