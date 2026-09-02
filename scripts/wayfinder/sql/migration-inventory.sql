begin transaction isolation level repeatable read read only;
\pset format csv

select name, coalesce(checksum, '') as checksum
from schema_migrations
order by name;

commit;
