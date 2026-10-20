-- The legacy evidence row belongs to the erased identity's deletion closure.
-- Keep this privilege on the NOLOGIN erasure owner, not the runtime API role.
grant select,delete on public.legacy_parameter_migration_evidence to catalog_migration_owner;
