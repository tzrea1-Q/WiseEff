# Explicit organization placement replacement

Status: implementation. Owner: the coordinating agent for the deployment placement-conflict report.

Chinese: [实施计划](../../../docs/zh-CN/exec-plans/active/2026-10-24-catalog-placement-replacement.md).

## Outcome and boundaries

The user needs to repair mismatched Subject-to-module assignments. A selected module may already belong to another active or retired registration. Merely hiding occupied modules cannot satisfy that repair workflow.

An explicit replacement moves source registration A to the selected module and clears displaced registration B's `module_id` to `NULL` (unset). A's former module becomes free. B retains its registration, placement identity and lifecycle. Neither side's parameters, Bindings, Project values or history are deleted or reassigned. This does not swap the registrations or relax the unique organization/module constraint. Existing nullable placement semantics from migration 0209 apply; no schema migration or production mutation is planned.

## Implementation

- Extend the existing conditional placement PATCH with an optional explicit replacement carrying B's registration identity, Placement ETag, Registration ETag and a nonempty reason. Preserve the source If-Match and current Release pin.
- Read both sides' impact before confirming. Identify retired occupancy as well as active occupancy. Require an explicit acknowledgement, reason and final confirmation; never replace automatically after a conflict.
- Validate organization, current ownership, lifecycle and both captured versions in one transaction. Serialize registration writes in a consistent order, retain Catalog guard locks through commit, preserve a strict idempotent result and write an audit with both before/after assignments.
- Distinguish `placement-occupied` from a stale placement. A stale preview preserves the draft but requires fresh evidence and renewed confirmation.

## Evidence and delivery

Use focused unit/component tests while editing; true PostgreSQL tests cover atomicity, role/tenant boundaries, current pins, stale versions, replay, concurrency and rollback. A 1440×900 real API browser test repairs an occupied target, checks failure/cancel paths and verifies reload persistence for A and B. Run the impact selector, generated contract checks, static checks and production build; run the complete native PR checks on the final candidate. Independent review owns the authorization/concurrency seams. Keep exact results and missing target-host evidence in the PR. Submit one PR and merge only after the current candidate's real Merge bar and applicable review pass.

## Documentation Impact Matrix

| Artifact | Required change | Evidence owner |
| --- | --- | --- |
| This plan and its Chinese companion | Document explicit replacement, preserved identities and data, concurrency and evidence boundaries | Coordinator |
| `docs/generated/openapi.json` | Regenerate optional replacement request and occupied-target failure contracts from the source schemas | Coordinator, native contract check |
| Applied migrations and ADR-0042 | No rewrite; nullable placement and one retained Placement remain authoritative | Independent review, PostgreSQL tests |

## Documentation Update Gate

Both language companions must describe the same A-to-target/B-to-unset behavior. The generated OpenAPI must pass `contract:check`; plans must pass `docs:check`. Current-candidate test results, screenshots and missing deployment evidence belong in the PR, with production and Hosted evidence kept separate.

This plan and its Chinese companion define the new repair behavior. The generated OpenAPI request/failure contracts must match the source schemas. Applied migrations and historical ADRs remain immutable; ADR-0042's one retained Placement invariant is preserved.
