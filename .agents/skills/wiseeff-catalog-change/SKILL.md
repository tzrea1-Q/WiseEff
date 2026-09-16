---
name: wiseeff-catalog-change
description: Change WiseEff Catalog schema, publication, authorization, migration, or recovery invariants. Not for unrelated database queries or read-only UI formatting.
---
# Change a Catalog-sensitive seam

Identify the accepted Issue/ADR, changed invariant, and evidence owner. Read the relevant design sections and verification-matrix rows. For Wayfinder launch nodes or an explicitly sealed program, also read `docs/agents/catalog-launch-operating-rules.md` and `docs/agents/agent-delivery-protocol.md`; do not silently reinterpret their contract.

Cover relevant cross-tenant/role, stale/concurrent, duplicate/retry, partial-failure, recovery, and populated-upgrade cases before claiming the invariant is safe. Keep applied migrations immutable and preserve server authorization, audit, provenance, and required independent review.

Use the existing dedicated lane database and role-faithful native commands when the contract requires them. Never substitute a shared compose database, fake adapter, or superuser-only pass. Confirm nonzero collected tests and record the actual environment.

Do not activate production publication, change a live policy, execute destructive cutover, or claim target-host readiness from local tests. Return the changed invariant, exact checks, independent-review status, and remaining rollout/evidence boundary.
