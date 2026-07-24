# DTS fixtures

## `synthetic-power-base.dts`

**Retired from product and seed paths.** Kept only for unit tests that need a minimal labeled stub (overlay merge, label-target checks, etc.).

Product demos and `db:seed:m1` use committed project-primary boards under `src/config/dts-seed/*-board.dts` as the source of truth. Seed integrity is enforced by CST parse (`parseDts`), not `dtc` compile.

When adding tests, prefer reading `aurora-board.dts` from `src/config/dts-seed/` when a full project-primary fixture is sufficient.
