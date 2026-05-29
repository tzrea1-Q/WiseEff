# Plans

Execution plans are first-class repository artifacts. Use them for work that has more than a tiny local change or that affects product behavior, architecture, security, reliability, or multiple files.

## Locations

- Active plans: `exec-plans/active/`
- Completed plans: `exec-plans/completed/`
- Technical debt: `exec-plans/tech-debt-tracker.md`

## Current Active Plan

- `exec-plans/active/development-roadmap.md`: M0-M5 productization sequence and post-M5 planning horizon.
- `exec-plans/active/2026-05-29-wiseeff-m5-2-staging-pilot-evidence-execution.md`: M5.2 staging pilot evidence execution plan.
- `exec-plans/active/2026-05-29-wiseeff-m5-2-non-hdc-target-evidence-closure.md`: M5.2 target-environment evidence closure for all non-HDC gates.

## Completed Plans

Completed historical plans are preserved under `exec-plans/completed/`, including M0-M5 productization work, M5.1 documentation governance, Chinese developer documentation, M3.5 commercial readiness hardening, and feature-specific plans from the former Superpowers plan location.

## Plan Rules

- Plans should name the goal, architecture, files, tasks, verification commands, and expected outcomes.
- Keep active plans updated as decisions change.
- Move finished plans to `completed/` after implementation and verification.
- If a plan leaves known follow-up work, add it to `tech-debt-tracker.md`.
- Do not rely on chat history for durable execution details.

## Documentation Governance Rule

Every active implementation plan except `development-roadmap.md` must include:

- `## Documentation Impact Matrix`
- `## Documentation Update Gate`

The impact matrix must review repository maps, planning docs, product specs, architecture docs, quality/testing docs, reliability/runbooks, security/governance docs, frontend/design docs, generated artifacts, and references. Each row must be marked `Update`, `Review`, or `No change` with exact file paths.

The update gate is blocking: a plan cannot be moved to `completed/` until every `Update` or `Review` row has either been updated or explicitly recorded as unchanged with evidence. Any deferred work must be added to `exec-plans/tech-debt-tracker.md`.

Future developer-facing changes to architecture, runtime modes, environment variables, API contracts, security, reliability, quality gates, or plan governance must update the relevant `docs/zh-CN/` page or explicitly record why no Chinese developer-doc update is needed.

Run `npm run docs:check` before finishing a non-trivial plan.
