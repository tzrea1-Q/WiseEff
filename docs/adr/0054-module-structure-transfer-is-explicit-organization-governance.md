# ADR-0054: Module structure transfer is explicit organization governance

> Chinese: [中文决策记录](../zh-CN/design-docs/adr-0054-module-structure-transfer-is-explicit-organization-governance.md)

Date: 2026-11-03

## Status

Accepted design on 2026-11-03 after Q1–Q11 and approval of the complete [implementation plan](../exec-plans/completed/2026-11-03-module-structure-transfer.md). Specification: [#1493](https://github.com/tzrea1-Q/WiseEff/issues/1493); implementation and verification: [PR #1505](https://github.com/tzrea1-Q/WiseEff/pull/1505). This decision preserves ADR-0042/0053 identity and ownership and extends governed placement edits to retired registrations without activating them. Deployment remains separate from this implementation.

## Decision

A versioned module structure package describes organization-owned business taxonomy and registration settings. A same-organization update uses stable identities and a server-retained export baseline for field-level conflict detection. A copy into another organization of the same deployment assigns target module identities, reuses shared Catalog subject identity, and requires explicit confirmation of matches and conflicts. Copy preserves the source and never executes its module deletion instructions against the target.

Omission never deletes or retires. Module deletion is explicit, with child disposition and affected root placements resolved before commit. A module deletion does not retire its registered subjects. Catalog structure, project values and retained history are not rewritten by transfer. Owned children continue to inherit owner placement and lifecycle rules.

One Governance-owned transaction applies the approved module, registration, alias and recognition changes with audit and a durable retry receipt. Public HTTP handlers cannot compose independently committed writers. Retired registrations may have their placement edited or copied under this governed path while remaining retired; the implementation must not temporarily restore them, and existing Catalog/child/binding constraints continue to apply.

## Trade-offs

Name/path-based identity would make renames and repeated copies ambiguous, so names are only matching suggestions. Replacing the target with a file's apparent contents would make truncation destructive, so deletes are explicit and excluded from copy mode. Retaining a baseline adds product storage but makes external editing compatible with concurrent work without trusting user-editable baseline fields. Atomic governance requires a shared transaction and lock protocol across existing writers; a short loop over current APIs would permit partial imports. Supporting retired placement requires an explicit governed extension rather than hidden lifecycle transitions.

The format is not a disaster-recovery backup or continuous organization synchronization protocol. Independent-deployment migration, Catalog authoring, source-organization cleanup and automated Agent execution are outside this decision.
