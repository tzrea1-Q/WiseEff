# WiseEff Agent Guide

This file is the short map for agents working in this repository. Keep it small. Put durable project knowledge in `docs/` and link to it from here.

## Working Principles

- Think before coding: state assumptions when they affect scope, and ask if the request has multiple risky interpretations.
- Keep changes surgical: touch only files needed for the task, preserve existing style, and do not refactor adjacent code without a direct reason.
- Prefer simple, testable changes over speculative abstractions.
- Define success criteria before multi-step work, then verify them with commands or file checks.
- Preserve user changes. Never revert unrelated edits in the worktree.
- For searches, prefer `rg` and `rg --files`.
- For code edits, use `apply_patch`; do not rewrite files with ad hoc shell output.

## Repository Map

- `README.md`: human setup, local commands, runtime mode, and quick project overview.
- `ARCHITECTURE.md`: top-level system map and the first architecture file to read.
- `docs/README.md`: knowledge-base index and recommended reading order.
- `docs/product-specs/`: product truth, user workflows, MVP scope, and prototype behavior.
- `docs/design-docs/`: architecture, domain model, API contract, design history, testing, security, deployment.
- `docs/exec-plans/`: active plans, completed plans, and the technical debt tracker.
- `docs/generated/`: generated or mechanically derived artifacts such as database schema summaries.
- `docs/references/`: compact reference notes intended for LLM/agent use.
- `server/`: M0 backend API, database migration, auth, audit, and shared HTTP/database foundations.
- `src/`: Vite React frontend, domain types, ports, mock runtime, HTTP client, components, pages, and tests.

## Documentation Routing

- Product intent: start with `docs/product-specs/index.md`, then read `docs/product-specs/product-spec.md`.
- Prototype behavior: read `docs/product-specs/prototype-functional-spec.md`.
- Architecture: start with `ARCHITECTURE.md`, then `docs/design-docs/full-stack-architecture.md`.
- Domain entities and state machines: read `docs/design-docs/domain-model.md`.
- API work: read `docs/design-docs/api-contract.md` and `docs/references/productization-api-contract-draft.md`.
- Frontend work: read `docs/FRONTEND.md` and the related component/page tests.
- Security, permissions, audit, Agent tool calls, or device writes: read `docs/SECURITY.md`.
- Reliability, deployment, jobs, health checks, or operations: read `docs/RELIABILITY.md`.
- Test strategy or quality gates: read `docs/QUALITY_SCORE.md` and `docs/design-docs/testing-strategy.md`.
- Planning work: use `docs/PLANS.md`, then create or update a plan under `docs/exec-plans/active/`.

## Current Product Shape

WiseEff is an AI-assisted enterprise efficiency platform prototype. It centers on three workflows:

- Parameter management: project parameter viewing, editing, review, admin governance, audit, and import/export.
- Log analysis: log upload, staged analysis progress, evidence, history, and admin governance.
- Debugging: device or node connection, safe parameter reads/writes, rollback preparation, and operation history.

The current codebase has both a React/Vite frontend prototype and an M0 backend skeleton. Mock mode remains useful for demos and component tests. Production-oriented work should move through the port/API seams documented in `docs/FRONTEND.md` and `ARCHITECTURE.md`.

## Commands

```bash
npm ci
npm run dev
npm run dev:api
npm test
npm run test:server
npm run test:all
npm run build
```

Use targeted tests while developing. Before claiming a code change is complete, run the narrow relevant tests plus `npm run build` when the change touches TypeScript, Vite config, routing, or shared types.

## Runtime Rules

- Frontend mock mode is for demos and tests.
- API mode uses:

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
- Plans are first-class artifacts: active work belongs in `docs/exec-plans/active/`; completed plans belong in `docs/exec-plans/completed/`.
