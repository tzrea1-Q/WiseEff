# Plans

Execution plans are first-class repository artifacts. Use them for work that has more than a tiny local change or that affects product behavior, architecture, security, reliability, or multiple files.

## Locations

- Active plans: `exec-plans/active/`
- Completed plans: `exec-plans/completed/`
- Technical debt: `exec-plans/tech-debt-tracker.md`

## Current Active Plan

- `exec-plans/active/development-roadmap.md`: M0-M5 productization sequence.
- `exec-plans/active/2026-05-27-wiseeff-m3-5-commercial-readiness.md`: detailed M3.5 commercial readiness hardening plan before M4 Agent work.

## Completed Plans

Completed historical plans are preserved under `exec-plans/completed/`, including M0-M3 productization work and feature-specific plans from the former Superpowers plan location.

## Plan Rules

- Plans should name the goal, architecture, files, tasks, verification commands, and expected outcomes.
- Keep active plans updated as decisions change.
- Move finished plans to `completed/` after implementation and verification.
- If a plan leaves known follow-up work, add it to `tech-debt-tracker.md`.
- Do not rely on chat history for durable execution details.
