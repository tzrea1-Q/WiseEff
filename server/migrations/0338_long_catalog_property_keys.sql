-- Preserve the exact property identity while accepting vendor DTS keys longer
-- than the Devicetree specification's 31-character limit. Existing CHECK
-- constraints call this function; replacing it preserves the constraint and ACL.
create or replace function parameter_catalog.is_canonical_property_key(value text)
returns boolean
language sql
immutable
strict
set search_path = pg_catalog, parameter_catalog
return value collate "C" ~ '^[A-Za-z0-9,._+?#-]{1,64}$'
  and left(value, 1) <> '#'
  and lower(value collate "C") not in (
    'compatible',
    'device_type',
    'gpio-controller',
    'interrupt-controller',
    'linux,phandle',
    'phandle',
    'ranges',
    'reg',
    'status',
    '#address-cells',
    '#gpio-cells',
    '#interrupt-cells',
    '#size-cells'
  );
