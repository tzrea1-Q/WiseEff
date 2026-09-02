begin transaction isolation level repeatable read read only;
\pset format csv

select
  schemaname as schema_name,
  tablename as relation_name,
  indexname as index_name,
  indexdef as definition
from pg_indexes
where schemaname = 'public'
order by tablename, indexname;

commit;
