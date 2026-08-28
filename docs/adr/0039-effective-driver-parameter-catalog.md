# ADR-0039: Effective driver parameter definitions are canonical and placed

> Chinese companion: [中文决策记录](../zh-CN/design-docs/adr-0039-effective-driver-parameter-catalog.md)

Date: 2026-08-28

## Status

Accepted for the Issue #649 implementation and data cutover.

## Context

The API-mode catalog can contain two rows for the same display name: an organization
draft with a module and a platform active row without a module. The old paths mixed
display names, observed binding modules, schema rows, and lifecycle state. They could
therefore create a provisional binding before a driver/property identity had been
proven, or allow a later active row to hide a draft without a durable precedence rule.

## Decision

1. The driver/property identity is `(owner scope, canonical AttributionSubject
   source_key, property_key)`. `parameter_specs.id` remains a surrogate; identity
   correction does not rewrite foreign keys.
2. An effective row must have an active definition, an active current
   `ParameterSpecVersion`, and a canonical driver subject. A DTS property must point
   to a subject-aligned `DriverSchema`; a subject-bearing organization row must have
   exactly one `driver_registration_placements` row whose driver-group and business
   parent belong to that organization.
   This driver-placement invariant applies to DTS driver definitions; legacy/manual policy rows
   without a concrete `DriverSchema` remain on the policy activation workflow and are not used to
   recognize DTS evidence.
3. Selection is server-owned and deterministic: organization active wins over
   platform active; more than one active candidate at the winning scope is a
   governance blocker; drafts, deprecated rows, and shadowed twins are never
   returned by the default effective view. `view=governance` exposes those rows for
   repair and audit.
4. Ingest may recognize and bind only after the complete identity/placement tuple is
   checked. Unknown and ambiguous nodes/properties retain occurrence and review
   evidence, but do not create a recognized spec, binding, or resolved occurrence.
5. Migration `0117` is the additive expand phase. It backfills subject links and
   organization placements without deleting dirty data. Migration `0118` guards new
   active DTS writes, and `0119` performs only safe graph finalization plus the
   future one-active-version trigger; existing conflicts remain for the audited
   `parameter-definitions:reconcile` command to classify and repair. Migration
   `0120` is the compatibility boundary for legacy active DTS surface writes: it
   permits the old unlinked staging row while keeping linked rows fail-closed.
   `0121` corrects the earlier nodename-only classification by moving
   `nodetype:*` subjects/modules to `NodeTypeDefinition` taxonomy; it preserves
   ids/history and requires an organization node-type module before effective use.
   The command supports dry-run/apply, persists run/item evidence, uses
   per-organization transactions, preserves historical versions/revisions, and
   records trusted system audit events. The independent `parameter-definitions:check`
   command is the final read-only gate.

## Consequences

- The parameter library no longer uses an unclassified observed module as proof of
  driver identity or placement.
- A deliberately curated or ambiguous case stays visible to governance and blocks
  release until resolved; there is no silent key-only deduplication.
- Platform definitions can remain reusable across organizations while each tenant
  declares its own driver-group placement.
- Reconciliation can be rerun safely. Applied rows mint a successor active version
  and update only the latest binding revision; historical rows remain immutable.

## Rollout and rollback

Deploy the expand migrations, run a dry-run, review persisted blockers, apply by
organization, and run the verification gate before enabling the contract in a
release. An organization transaction rolls back all catalog, binding, and audit
writes together on failure. Do not delete or edit migration history to roll back;
restore the database backup and rerun the verification/reconciliation procedure if
an operational rollback is required.
