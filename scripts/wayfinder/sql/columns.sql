begin transaction isolation level repeatable read read only;
\pset format csv

select
  cols.table_schema as schema_name,
  cols.table_name as relation_name,
  cols.ordinal_position,
  cols.column_name,
  cols.data_type,
  cols.udt_name,
  cols.is_nullable,
  (cols.column_default is not null) as has_default,
  cols.is_generated,
  cols.identity_generation
from information_schema.columns cols
where cols.table_schema = 'public'
order by cols.table_name, cols.ordinal_position;

commit;
