begin transaction isolation level repeatable read read only;
\pset format csv
\pset tuples_only on
\qecho relation_name,row_count

select format(
  'select %L as relation_name, count(*)::bigint as row_count from %I.%I',
  table_name,
  table_schema,
  table_name
)
from information_schema.tables
where table_schema = 'public'
  and table_type = 'BASE TABLE'
  and (
    table_name in (
      'organizations',
      'projects',
      'attribution_subjects',
      'node_type_definitions',
      'legacy_parameter_migration_evidence'
    )
    or table_name like 'parameter\_%' escape '\'
    or table_name like 'project\_parameter\_%' escape '\'
    or table_name like 'driver\_%' escape '\'
    or table_name like 'dts\_%' escape '\'
  )
order by table_name
\gexec

commit;
