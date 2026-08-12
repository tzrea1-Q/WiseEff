-- Drop unused per-device DTS reload configuration overrides.
-- Effective reload contracts resolve from organisation defaults (or seeded defaults) only.
-- Residue bookkeeping (`dts_reload_device_residue`) is unrelated and remains.

drop table if exists dts_reload_device_overrides;
