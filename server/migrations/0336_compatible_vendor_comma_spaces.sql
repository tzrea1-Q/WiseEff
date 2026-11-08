-- A DTS string literal may include spaces after its vendor comma. Keep the
-- complete compatible byte-for-byte as a Catalog identity; do not silently trim
-- or collapse spaces ("huawei, device" and "huawei,device" remain distinct).
-- Match the TypeScript canonical compatible parser: only ASCII spaces directly
-- after the comma are newly permitted, never tabs/newlines or other whitespace.
-- Replacing the immutable predicate preserves existing CHECK constraints,
-- ownership and grants; historical migration 0137 remains unchanged.
create or replace function parameter_catalog.is_canonical_compatible_selector(value text)
returns boolean
language sql
immutable
strict
set search_path = pg_catalog, parameter_catalog
return value ~ '^[A-Za-z0-9][A-Za-z0-9+._/-]*(, *[A-Za-z0-9][A-Za-z0-9+._/-]*)?$';
