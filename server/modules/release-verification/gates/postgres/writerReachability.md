# V13 legacy database capability submatrix

[Chinese](writerReachability.zh-CN.md)

This change repairs a demonstrated V13 false pass. A separate restricted LOGIN
could update a legacy driver schema while the formal PostgreSQL V13 adapter
returned `passed`. It does not establish complete P13 retirement or authorize
runtime startup, restoration, queue consumption, or release.

## Scope and source ownership

The original four entries in `catalogRoleManifest.LEGACY_STRUCTURAL_TABLES`
remain unchanged. V13 observes those four relations plus these existing legacy
structural relations:

| Relation | Existing structural writer |
| --- | --- |
| `driver_schemas` | `parameter-specs/service.ts` `reattributeParameterSpec`; `parameter-specs/repository.ts` `upsertMatchedDriverSchema` |
| `driver_schema_versions` | `upsertMatchedDriverSchema` inserts the version |
| `dts_property_specs` | `reattributeParameterSpec` updates namespace and property key |

The retired `parameterSpecs.reattribute` route is already in the frozen route
manifest in `contracts/dtoSchemas/parameterCatalog.ts`. The seven-table list is
a proven database subset, not the complete legacy source or writer inventory.
No migration, grant, shared role manifest, format, gate identifier, failure code,
trusted baseline, or boundary allowance changes here.

## Threats and observation

The original direct-ACL and definer checks remain. Additional observations root
at actual LOGIN roles, follow PostgreSQL 16 SET membership edges, and use actual
table/column privileges for PUBLIC and inherited capabilities. Ownership is
observed separately. An unreachable NOLOGIN owner is not classified as a runtime
writer merely because it owns a table; granting a reachable membership changes
the result. INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES and TRIGGER capabilities
are blocking, including applicable column grants.

Executable user SECURITY DEFINER functions with an owner capable of changing a
scoped relation are unproven and blocking. Effective EXECUTE delegation follows
additional definer owners, including private inner functions. Recursive UNION
deduplicates LOGIN/owner pairs, so cycles terminate. A restricted owner with only
read access remains permissible. SQL text absence is never a safety proof.
Missing scoped relations and actual query failures return the existing typed
blocking V13 result without private diagnostics or repair writes.

The inherited `postgres` and `current_user` exclusions are compatibility behavior,
not a trusted production-role manifest. Controller-proven production identities,
all legacy tables, triggers, other function mechanisms, HTTP/Agent/review/jobs,
scripts and background writers remain separate obligations. The evidence scope
label enters the evidence digest; the report does not interpret it as a new gate
state. A passed database submatrix must not become a complete P13 fingerprint.
The missing-table test concerns the existing pre-retirement observation window;
it does not change P16 cleanup semantics.

## Reproduction and execution identity

Run `scripts/run-upgrade-component-tests.ts` with suite
`writer-reachability-pg16` and the independently verified local daemon identity.
Use the existing runner's authorized host admission; do not supply an ambient
database URL. It creates an owned temporary PG16 cluster and runs the real
adapter using a read-only LOGIN. Tests deliberately change synthetic roles,
ACLs, ownership, functions and one system-catalog SELECT grant inside that owned
cluster. Cleanup closes clients before disposing of the temporary database and
runner resources. No production inputs are consumed.

The suite has a receipt-first exact config, rejects zero tests, retains default
timeouts, and is excluded only from the shared server suite. The mandatory
owned CI job executes it and remains required by Merge bar.

Dependency: `2b5d5ed4446a1aca56dd3d929fd15691172ba29d`, descending from main
`cda6737a8f177a8bbd2f3bc7d195f8e3037bfa74`.

| Executed code | Collected / passed / failed / skipped | Result |
| --- | --- | --- |
| `81905a346` | 12 / 1 / 11 / 0 | Initial real LOGIN Red, exit 1 |
| `9bdb6a686` | 19 / 1 / 18 / 0 | Expanded capability Red, exit 1 |
| `d135f4ce5` | 19 / 19 / 0 / 0 | First implementation, exit 0 |
| `0733f322f` | 23 / 22 / 1 / 0 | Private inner EXECUTE delegation Red, exit 1 |
| `6dca0f385365c54c4c8a2ba63c5315309e0672ca` | 23 / 23 / 0 / 0 | 5.69 seconds, exit 0 |

Final execution tree: `92482fca44d08c2d51db1c5190007fe296e4465a`.
All these runs verified owned resource cleanup. Image: `postgres:16-alpine`,
`linux/arm64`, image ID
`sha256:16bc17c64a573ef34162af9298258d1aec548232985b33ed7b1eac33ba35c229`.
The final Green log SHA-256 is
`6545e9c3c1d4fe9f25416958cdff2651bec2025cd48a5d57d67823d0e60d2bf5`;
the preceding delegation Red log is
`3891cc3e8dc4bb17fb0f7eb5e9344d09127348955fe2151fd531bca95132fb18`.
Targeted TypeScript checking exited 0. Boundary checking against the unchanged
trusted base `9b3ba7df7e21f5589684bc92c872da593ad4c246` exited 0:
3509 existing allowed occurrences, zero new/stale/mismatched/growing allowances.
These are local isolated component executions, not Hosted, whole-controller,
approved runtime startup, or production evidence. Later documentation commits do
not relabel these executed identities.
