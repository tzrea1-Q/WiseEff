-- DTS string literals may contain more than one comma inside a *single* compatible.
-- Extend 0336's exact byte-preserving grammar, without changing historical DDL.
-- Spaces after any comma are preserved; empty segments, all other whitespace,
-- control characters and wildcards remain prohibited. PostgreSQL CHECK
-- constraints call this predicate, so CREATE OR REPLACE is sufficient.
create or replace function parameter_catalog.is_canonical_compatible_selector(value text)
returns boolean
language sql
immutable
strict
set search_path = pg_catalog, parameter_catalog
return value ~ '^[A-Za-z0-9][A-Za-z0-9+._/-]*(, *[A-Za-z0-9][A-Za-z0-9+._/-]*)*$';
