# ADR-0012: Releasing happens at the file layer

- Status: Accepted
- Date: 2026-07-30
- Plan: `docs/exec-plans/completed/2026-07-30-parameter-governance-state-machine-completion.md`

## Context

`dts_config_revisions.status` allowed `published`, and `CONTINUITY_BASELINE_STATUSES` listed it as a stable baseline. No writer ever set `published`; `governanceAudit.ts` reserved `config-revision-published` unused. The design doc promised `resolved → validated → compiled → pending_approval → published` (`docs/design-docs/2026-07-16-parameter-topology-schema-management-design.md`).

Releasing is already implemented as a **file-layer** act: `dts_release_baseline.status` moves `draft → released` via `POST /api/v1/projects/:projectId/baselines/:baselineId/release`. A baseline pins `file_version_id` per config-set member and has no foreign key to `dts_config_revisions`. Builds and devices consume DTS files. A config revision is a derived read model of one parsed file version — ingest, identity mapping, validation, and review readiness — not a releasable artifact.

## Decision

1. **`published` retires** from `dts_config_revisions.status`, continuity baselines, the candidate FSM table, and governance audit actions.
2. **Releasing is the release baseline and nothing else.** Config revisions never publish.
3. Migration `0083` asserts zero rows hold `published` before narrowing the CHECK; it fails loudly rather than deleting data.

## Consequences

- Correct the design-doc state machine to end at `pending_approval` / validation outcomes, pointing here.
- Future readers must not re-add `published` to config revisions without revisiting this ADR.

## Alternatives considered

- **Implement config-revision publish**: rejected — would duplicate the baseline release tip and confuse which artifact devices consume.
- **Keep the enum value unused**: rejected — vestigial states invite reimplementation of the wrong tip.
