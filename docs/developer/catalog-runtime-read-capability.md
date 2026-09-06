# Catalog runtime read capability candidate

Chinese: [中文](../zh-CN/developer/catalog-runtime-read-capability.md)

This is an unapproved capability proposal for the populated-upgrade Scratch candidate. It is not a production migration command or evidence that the complete API/worker can run under these roles. Migration `0140_parameter_catalog_runtime_read_capability.sql` requires an explicit decision on the two governance-writer function grants below before an operational entry point may apply it. The immutable `0138` manifest remains unchanged.

The existing `parameter_governance_writer_role` manifest permits only `assert_catalog_subject_active(text,text,text,text)`. That function returns `void`, validates a current release/subject, and holds the shared pointer lock. It cannot return a physical database identity or lock and return an organization-scoped destination module. Its placement trigger is not a callable query interface.

The proposed additions to that writer are exactly:

| Function EXECUTE | Return and purpose |
| --- | --- |
| `runtime_database_identity()` | Text containing the actual PostgreSQL system identifier and current database OID; pair the two real leased pool sessions before any business mutation. |
| `lock_governance_destination_module(text,text)` | Matching module ID, organization ID, parent ID and kind, while holding `FOR SHARE` in the writer transaction. |

These are additional capabilities, not an implementation already authorized by the old manifest. They do not grant Catalog SELECT/DML, public-table SELECT, migration/synchronizer membership, or trigger-function EXECUTE.

The proposed separate `catalog_runtime_reader_role` has twelve immutable Catalog SELECT grants, schema USAGE, and EXECUTE on the identity function and exact Proposal-success replay function. Replay returns only `resultSnapshot`, for the six successful Proposal actions with `info` severity; refusal metadata is unavailable. All three new functions have the fixed owner `catalog_migration_owner`, fixed `pg_catalog` search path, qualified relations and no PUBLIC EXECUTE. No LOGIN or password is created.

An existing cluster-global reader role must have safe attributes, no parent memberships, no current-database ownership and no explicit privileges beyond this manifest (non-grantable database CONNECT is allowed). Extra table/column DML, schema CREATE, function EXECUTE, default privileges and other object capabilities cause a typed refusal. Privileges in another database are neither adopted as target authority nor changed. A new database on the same cluster is supported when the existing role has no disallowed target-local capability. Ordinary retries validate checksums and use the existing migration ledger.

Proposal commands keep the writer's shared pointer lock and use a separately leased reader session with explicit `READ COMMITTED READ ONLY`. Both sessions call the installed identity function; comparing URLs is insufficient. A mismatch or unavailable identity throws a static `ProposalReadTargetError` before business writes and does not write audit to an unverified target. Normal business refusals retain their durable refusal audit. Organization authorization remains in the authenticated domain adapter; a shared database login and an organization argument do not establish per-user database isolation.

Management recovery must preserve database-local ACLs as well as role identities and memberships. In particular, `0140` revokes PUBLIC EXECUTE on `pg_catalog.pg_control_system()` in the managed database and grants only its protected owner access. Other system-function ACLs are unchanged. Do not assume a normal database dump restores this system-function ACL. A controlled capability receipt and management restore verification must preserve it, the new function owners/search paths/EXECUTE ACLs, and the lack of default-ACL expansion. Do not change another database or silently repair an existing overprivileged role.

The bounded real-PostgreSQL tests live in `server/modules/parameter-governance/proposals/runtimeRoles.integration.test.ts`, run through `vitest.runtime-bootstrap.config.ts` with an explicitly verified development daemon identity. They own a disposable PostgreSQL 16 Alpine cluster and use two restricted login connections. Synthetic successful commands are not release-verification reports or production approvals. Test evidence belongs to the parent delivery record; pending grants, complete HTTP authorization, ordinary business permissions, runtime pin production, and the complete populated controller remain separate acceptance items.
