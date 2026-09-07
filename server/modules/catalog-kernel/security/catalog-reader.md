# Additive Catalog runtime reader

Chinese: [中文](catalog-reader.zh-CN.md)

PR #824's owner explicitly authorized this limited contract evolution on 2026-09-07. Migration `0140_parameter_catalog_runtime_reader.sql` adds a capability; it does not edit historical 0138/0139 or approve runtime startup, publication, recovery, or any production operation.

## Old and new contract

At 0138, ordinary production identities cannot SELECT Catalog tables. That historical contract and its tests remain. After 0140, identities without an explicit reader membership still fail. A restricted LOGIN may receive `catalog_runtime_reader_role` with PostgreSQL 16 membership `INHERIT TRUE, SET FALSE, ADMIN FALSE`. The migration grants no memberships, manages no passwords and never alters an existing application login.

The capability is NOLOGIN, NOINHERIT, NOSUPERUSER, NOBYPASSRLS, NOCREATEDB, NOCREATEROLE and NOREPLICATION. Its complete grant is schema `parameter_catalog` USAGE and SELECT on the following ten tables. There are no function, sequence, default ACL, grant-option, owner, DML or other-domain grants.

| Formal query/caller | Necessary SELECT objects |
| --- | --- |
| `loadCurrentCatalog`, current pointer | `catalog_state`, `catalog_releases` |
| Current/pinned `loadProjection`, release/materialization/predecessor lineage | `catalog_releases`, `catalog_materializations` |
| Current/pinned subject projection | `catalog_release_subjects`, `catalog_subjects` |
| Current/pinned alias projection | `catalog_release_subject_aliases`, `catalog_subject_aliases` |
| Current/pinned exact definition heads and revision history | `catalog_release_definition_heads`, `parameter_definitions`, `definition_revisions`, `catalog_releases` |

The source of truth is the existing SQL in `runtime/currentSnapshot.ts` and `runtime/pinnedSnapshot.ts`, mirrored by `catalogReaderManifest.ts`. Driver/node-type subtype tables are not queried here and receive no grant. Kernel retains its public interface and owns its repeatable-read, read-only transactions. Catalog SELECT is not an applicable approved runtime pin. Report projection uses the distinct 0139 verifier capability; Governance keeps its existing separate command connection. No governance EXECUTE or system-identity function is introduced.

## Reuse and refusal

Roles are cluster-global. An existing reader is reused only if global role flags, outgoing memberships, inbound membership options, ownership and role settings pass. Direct ACLs for relations, columns, functions, schemas, databases, defaults, parameters, large objects, types, languages, tablespaces, foreign data wrappers and foreign servers must remain within the declared capability. Catalog PUBLIC ACLs, relevant future PUBLIC default ACLs and PUBLIC elevated parameter privileges must remain revoked. Contamination raises a typed SQLSTATE 42501; the migration does not revoke, normalize or overwrite the contaminated role.

No privileged user-defined SECURITY DEFINER outside the manifest may be executable by this reader. The audit checks EXECUTE and owner capabilities: reachable elevated roles, effective Catalog table/column permissions, Catalog schema CREATE and protected function EXECUTE. Missing schema USAGE does not establish unreachability: an already-parsed view expression can invoke a function in that schema. SQL-text inspection cannot prove dynamic bodies safe. Actual view rewrite dependencies are followed recursively, including materialized copies: a reader-accessible view chain containing an owner-rights hop to Catalog is an unmanifested interface and is refused. Invoker-only views retain caller permissions. Ordinary PostgreSQL builtins and business definers whose owners lack the elevated/Catalog capabilities are not blanket-denied. Grants directly held by an application's LOGIN for its separate business responsibilities are not grants to this NOLOGIN capability. The migration transaction explicitly orders `pg_catalog, public, pg_temp` so temporary relation/type names cannot shadow the audit's system catalogs.

An existing reader may have legitimate SELECT grants in other databases. PostgreSQL cannot read those databases' relation catalogs through this connection. This migration neither attests those ACLs nor changes them; effective-capability inspection is required for each actual runtime database. It does inspect cluster-visible ownership and memberships. Migration and runtime checks are complementary, and neither a role name nor NOLOGIN proves safety.

The existing migration runner transaction binds role creation, ACL grants and ledger checksum. Failed attempts roll back; committed retries are ledger no-ops. Concurrent database migration tests cover reuse of an already-created role after the same audit. A first-creation race has not been exercised and is not claimed as verified. No ledger removal or unconditional cleanup is part of recovery.

## Verification and ownership

`catalogReader.integration.test.ts` runs in its own PostgreSQL 16 Alpine cluster, using the existing owned-target component runner and private receipt. It must not run against an ambient/shared Catalog lane: several negatives intentionally mutate cluster-global capability state inside rolled-back transactions. Run the dedicated terminal command from an isolated development worktree, with the daemon ID obtained by independent local Docker identity inspection:

```sh
./node_modules/.bin/tsx scripts/run-upgrade-component-tests.ts --expected-daemon-id "$VERIFIED_DEVELOPMENT_DAEMON_ID" --suite reader-pg16
```

The runner creates and identity-checks its own container, network, volume and private database input. No production URL is accepted. It reports the actual image ID, platform, exit code and ownership-verified cleanup. Missing identity/receipt is failure, never a skip or a production fallback. The PG16 Alpine result does not replace the separate pgvector Catalog lane.

The suite executes the 0138 denial before 0140, installs an actual compiler/installer release chain, calls formal Kernel current/historical methods through a real restricted LOGIN, tests exact ACL/membership options, wrong pins, all Catalog DML and out-of-scope reads, privilege drift, future objects, independent business writes, and concurrent database reuse. It proves this reader component; API/worker startup approval and the complete controller remain separate integration milestones.

This file, its Chinese companion, the versioned manifest, migration, dedicated test and two component-runner selectors form the reader change unit. The parent owns shared contract fingerprints, generated schema, overall migration inventories, CI routing and the final independent Standards/Spec review. User authorization does not waive these checks or broaden other frozen contracts.
