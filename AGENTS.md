# WiseEff Agent Guide

> Chinese: [Chinese](docs/zh-CN/root/AGENTS.md)

This file is the short map for agents working in this repository. Keep it small. Put durable project knowledge in `docs/` and link to it from here.

## Working Principles

- Think before coding: state assumptions when they affect scope, and ask if the request has multiple risky interpretations.
- Keep changes surgical: touch only files needed for the task, preserve existing style, and do not refactor adjacent code without a direct reason.
- Prefer simple, testable changes over speculative abstractions.
- Define success criteria before multi-step work, then verify them with commands or file checks.
- Preserve user changes. Never revert unrelated edits in the worktree.
- **Branch & PR:** Implementation subagents work on a Scratch feature branch from `main` only; they do not open or merge GitHub PRs. The parent agent reviews and seals the candidate, opens the PR only when it is integration-ready, merges, and syncs local `main`. See `docs/agents/agent-delivery-protocol.md` and `docs/PLANS.md` § Git Branch & PR Workflow.
- For searches, prefer `rg` and `rg --files`.
- For code edits, use `apply_patch`; do not rewrite files with ad hoc shell output.

## Repository Map

- `README.md`: human setup, local commands, runtime mode, and quick project overview.
- `CONTRIBUTING.md`: contributor setup, planning, documentation, and verification workflow.
- `ARCHITECTURE.md`: top-level system map and the first architecture file to read.
- `docs/README.md`: knowledge-base index and recommended reading order.
- `docs/developer/`: local setup, environment variables, and verification matrix.
- `docs/api/`: API authentication, errors, examples, and contract usage.
- `docs/security/`: threat model, data classification, secrets, and audit retention.
- `docs/runbooks/`: staging, backup/restore, rollback, monitoring, observability, incidents, HDC, Agent provider, and pilot operations.
- `docs/product-specs/`: product truth, user workflows, MVP scope, and prototype behavior.
- `docs/design-docs/`: architecture, domain model, API contract, design history, testing, security, deployment.
- `docs/exec-plans/`: active plans, completed plans, and the technical debt tracker.
- `docs/generated/`: generated or mechanically derived artifacts such as database schema summaries.
- `docs/references/`: compact reference notes intended for LLM/agent use.
- `docs/zh-CN/`: Chinese developer onboarding and daily reference for architecture, runtime, quality, security, reliability, and planning.
- `ops/self-hosted/`: M6 self-hosted Linux runtime templates, checks, and smoke runner.
- `server/`: M0 backend API, database migration, auth, audit, and shared HTTP/database foundations.
- `src/`: Vite React frontend, domain types, ports, mock runtime, HTTP client, components, pages, and tests.

## Documentation Routing

- Chinese developer onboarding: start with `docs/zh-CN/README.md`, then follow its reading order for architecture, frontend, backend/runtime, security/reliability, quality, and planning.
- Local development: start with `CONTRIBUTING.md`, then `docs/developer/local-development.md` and `docs/developer/environment-variables.md`.
- Verification: read `docs/developer/verification-matrix.md` before choosing test or smoke gates.
- API integration: read `docs/api/README.md`, then `docs/api/authentication.md`, `docs/api/errors.md`, and `docs/api/examples.md`.
- Operations: read `docs/runbooks/README.md`, then the runbook for the target procedure.
- Security review: read `docs/SECURITY.md`, then `docs/security/README.md`.
- Product intent: start with `docs/product-specs/index.md`, then read `docs/product-specs/product-spec.md`.
- Prototype behavior: read `docs/product-specs/prototype-functional-spec.md`.
- Architecture: start with `ARCHITECTURE.md`, then `docs/design-docs/full-stack-architecture.md`.
- Domain entities and state machines: read `docs/design-docs/domain-model.md`.
- API work: read `docs/design-docs/api-contract.md` and `docs/references/productization-api-contract-draft.md`.
- Frontend work: read `docs/FRONTEND.md` and the related component/page tests. Table column multi-select filters must follow `docs/design-docs/ux-table-column-filter.md` (`ColumnFilter`).
- Frontend aesthetics, design tokens, or component visual standards: follow `docs/design-docs/ui-design-system.md`; every frontend-visible change must pass the completion gate in `docs/developer/ui-quality-checklist.md`.
- Security, permissions, audit, Agent tool calls, or device writes: read `docs/SECURITY.md`.
- Reliability, deployment, jobs, health checks, or operations: read `docs/RELIABILITY.md`.
- Test strategy or quality gates: read `docs/QUALITY_SCORE.md` and `docs/design-docs/testing-strategy.md`.
- Planning work: use `docs/PLANS.md`, then create or update a plan under `docs/exec-plans/active/`.

## Current Product Shape

WiseEff is an AI-assisted enterprise efficiency platform prototype. It centers on three workflows:

- Parameter management: project parameter viewing, editing, review, admin governance, audit, and import/export.
- Log analysis: log upload with optional org-scoped log-domain binding, staged analysis progress, an LLM analysis kernel with honest degradation to the rules engine (provenance surfaced in UI and reports), evidence, history, and admin governance including domain governance.
- Debugging: device or node connection, safe parameter reads/writes, rollback preparation, and operation history.

Internal Beta product feedback is a cross-cutting utility: users submit sidebar feedback with image attachments, while Admins triage it from `/feedback-admin`.

The current codebase has a React/Vite frontend prototype plus a modular M0-M5 backend baseline. Mock mode remains useful for demos and component tests. Production-oriented work should move through the port/API seams documented in `docs/FRONTEND.md` and `ARCHITECTURE.md`.

## Commands

```bash
npm ci
npm run dev
npm run dev:api
npm test
npm run test:server
npm run test:all
npm run build
npm run selfhost:check
npm run queue:check
npm run observability:check
```

Use targeted tests while developing. Before claiming a code change is complete, run the narrow relevant tests plus `npm run build` when the change touches TypeScript, Vite config, routing, or shared types.

## Frontend Verification with playwright-cli

Frontend-visible changes require real browser verification before completion. This applies to changes in UI, layout, styling, interactions, routes, components, forms, animation, responsive behavior, design tokens, public assets, or visible UI copy.

- Start the local dev server before browser checks, usually with `npm run dev`.
- Use `playwright-cli` to visit each affected page or route.
- Verify at least these viewports: desktop `1440x900`, tablet `768x1024`, and mobile `390x844`.
- For every relevant page, run both `snapshot` and `screenshot`.
- Check `console error`; inspect network requests when the change affects loading, data flow, assets, navigation, form submission, or error handling.
- Exercise the real interactions that matter: click, type, submit, navigate, open menus and dialogs, hover/focus controls, and verify loading and error states where relevant.
- Inspect layout quality: no element overlap, text overflow, squeezed buttons, unintended horizontal scrolling, unreadable text, broken spacing, mobile obstruction, or confused visual hierarchy.
- If `playwright-cli` cannot run, stop and report the blocker. Do not claim frontend verification is complete without it.

Common command examples:

```bash
playwright-cli --version
playwright-cli -s=<project-name> open <url>
playwright-cli -s=<project-name> resize 1440 900
playwright-cli -s=<project-name> snapshot
playwright-cli -s=<project-name> screenshot --filename=work/ui-checks/<name>.png
playwright-cli -s=<project-name> console error
playwright-cli -s=<project-name> close
```

Final responses for frontend-visible work must include verification evidence: local URL or route, tested viewports, tested interactions, screenshot paths, console/network check results, and the issues found and fixed or a clear note that no issues were found.

## Runtime Rules

- Frontend **defaults to API mode** for local dev (`npm run dev`, `npm run dev:all`, and `.env.example`).
- Mock mode is for frontend-only demos and tests; set explicitly:

```text
VITE_WISEEFF_RUNTIME_MODE=mock
```

- API mode (default) uses:

```text
VITE_WISEEFF_RUNTIME_MODE=api
VITE_WISEEFF_API_BASE_URL=http://127.0.0.1:8787
```

- Production builds must not use mock data as a business data source.
- Backend writes must enforce authz and audit server-side.
- Agent write tools and device writes require explicit human approval in the product model.

## Harness Knowledge Rules

- Treat repository-local docs as the system of record.
- Keep `AGENTS.md` and `ARCHITECTURE.md` short and navigable.
- When a decision becomes durable, add it to the closest doc instead of leaving it only in chat.
- When a doc becomes stale, update it in the same change that makes it stale.
- Developer-facing docs that humans are expected to read must be maintained as separate English and Chinese files linked to each other; do not mix Chinese and English prose in one document as the bilingual strategy.
- Plans are first-class artifacts: active work belongs in `docs/exec-plans/active/`; completed plans belong in `docs/exec-plans/completed/`.
- Future active implementation plans must include a Documentation Impact Matrix and Documentation Update Gate as defined in `docs/PLANS.md`; run `npm run docs:check` before marking a plan complete.

## Agent skills

Agent orchestration uses **Matt Pocock skills** (for example `implement`, `tdd`, `to-spec`, `triage`) together with `docs/agents/*`. Do not create or update `docs/superpowers/**` or call `superpowers:*` skills. In-progress implementation tracking stays in `docs/exec-plans/active/`.

### Issue tracker

Issues live in GitHub Issues for `tzrea1-Q/WiseEff` (via `gh`). See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `CONTEXT.md` + `docs/adr/`. See `docs/agents/domain.md`.

### Fleet coordination

Parallel sessions (multiple worktrees merging to `main`): claim main-red repairs before fixing, re-check ADR/migration/TD numbers at merge time, typecheck and run affected tests after every rebase. See `docs/agents/fleet-coordination.md`.

### Delivery protocol

Goal-driven multi-agent delivery uses the Scratch -> threat review -> seal -> integration -> Hosted -> attestation state machine, explicit WIP/CI budgets, and user stop boundaries in `docs/agents/agent-delivery-protocol.md`. Active programs may narrow its defaults only through an accepted run profile. Wayfinder #668 launch Issues also follow `docs/agents/catalog-launch-operating-rules.md`: dedicated lane databases, role-faithful local acceptance before Hosted, and merge-serial / develop-parallel concurrency.
