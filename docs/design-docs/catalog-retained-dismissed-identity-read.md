# Retained MOD dismissed identity read contract

Chinese: [只读契约](../zh-CN/design-docs/catalog-retained-dismissed-identity-read.md)

## Source and identity

Migration 0182 provides `parameter_catalog.list_retained_dismissed_compatible_identities(organizationId)` through `readRetainedDismissedCompatibleIdentities` in `catalog-kernel/interface`. The 0137 legacy source registry identifies `parameter-module-dismissed-compatible` by `array['id']` with `dismissed-compatible-organization-owner`. The existing owner resolver accepts a known ID; neither it nor Mapping/Archive enumerates all retained historical source rows and their complete compatible.

The new read returns every retained row in the explicitly requested organization as `{organizationId, id, compatible}`. `id` is the original historical row ID, not a Review Item. `compatible` is unmodified, including case and punctuation. No Discovery joins, page cap, compatible grouping or normalization apply. IDs are unique and ordered by UTF-8 bytes (`COLLATE "C"`). The client rejects malformed, duplicate, unordered or cross-organization responses and propagates SQL errors; these are not empty inventories. An organization with no retained rows legitimately returns `[]`.

This is the complete **retained row inventory**, not a reconstruction of already-deleted dismiss/restore events. Comparison preserves protected row identities, probes the retired HTTP route with the original compatible, and observes canonical state in the row's organization. Equal compatibles in different organizations remain different cases. Existing unavailable cases remain report blockers.

## Authorization

The read-only `STABLE SECURITY DEFINER` function has a fixed `pg_catalog, parameter_catalog` search path and qualified source table. Its owner, `catalog_migration_owner`, already holds source SELECT from 0138. PUBLIC has no EXECUTE.

The new opt-in `catalog_legacy_identity_reader_role` is NOLOGIN/NOINHERIT, with schema USAGE and EXECUTE for this function only. Its scope is **all organizations for maintenance comparison**, explicitly selecting one organization per call. It is not a tenant end-user capability. It has no direct source table/column SELECT or DML. Migration 0182 assigns no LOGIN memberships, and does not expand `wiseeff_mod_d02_source_reader`, capture, the API account or the publication reader. A deployment owner must explicitly bind a maintenance LOGIN and its approved scope before target acceptance; application AuthContext is not that database role.

Dedicated PostgreSQL tests use a temporary non-superuser LOGIN, deny reads before membership and after revocation, deny raw SELECT/UPDATE and SET ROLE to the owner, and read both organizations within a read-only transaction after the explicit test-only grant. This establishes local capability behavior, not deployed credentials or a production runner. Full comparison fixtures still use their migration/admin connection; that evidence must remain separate.

## Verification and handoff

The existing 201+1 fixture verifies all 202 original IDs and all 215 cases in both stages. Six missing-Subject cases remain unqueryable, with 209 declared expected differences. Fresh zero inventory, real Governance pagination and failure propagation remain covered.

The 0181 fingerprint `bd79fcababc6baa972d0935d1e837a5dc78195a225563d92be7a717af4e97797` remains a historical stage. Fresh/0181-upgraded PostgreSQL measures the new 0182 fingerprint `2ab9046e3ceb66ab9f91b1d7eb96e5d929f9b25f8b3fda0bb0c190fcac761fd5`; old migration receipts/checksums and retained rows must remain unchanged. Shared migration-tail/ACL proof adaptation belongs to A integration; no frozen assertions or existing history are relaxed here.

Native Catalog must independently confirm retirement of `S12-MOD:legacy-catalog-raw-read:3d36995998094eb1:b170050e2ad90587`. Recording retirement is not allowance. The inherited 173 observations remain strict-gate blockers. This contract does not expand D02 capture, change Archive selection, install a production runner, activate P11–P16, or authorize deployment.
