# WiseEff Documentation System Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the WiseEff documentation set into an executable developer, operator, security, and API knowledge system instead of a collection of milestone notes.

**Architecture:** Keep `README.md`, `AGENTS.md`, `ARCHITECTURE.md`, and `docs/README.md` as short entry maps. Add focused subdirectories for developer setup, API usage, security audit material, and runbooks; preserve completed plans as history but add indexes/status labels so they are not mistaken for current contracts. Extend `npm run docs:check` so key documentation structure and environment examples are mechanically checked.

**Tech Stack:** Markdown documentation, TypeScript documentation checker, Vitest, existing docs governance workflow, repository-local OpenAPI and migration artifacts.

---

## Scope Boundary

This plan includes:

- Developer onboarding docs that let a new engineer prepare `.env`, run local API mode, and choose the right verification gate.
- Operator runbooks for staging deployment, backup/restore, rollback, monitoring/alerting, HDC device-lab evidence, and live Agent provider evidence.
- Security and API docs that support review, audit, and integration work.
- Historical documentation indexes that label current vs historical material.
- Chinese developer documentation updates for the new high-value developer/operator references.
- Documentation governance automation that checks active plans, local markdown links, key entry files, and `.env.example` coverage.

This plan does not include:

- Completing external staging/HDC/backup/live-provider evidence. That remains M5.2 target-environment work.
- Implementing SSO/OIDC, durable queue infrastructure, cloud IaC, or generated OpenAPI clients.
- Rewriting every historical feature design or completed execution plan.

## File Structure

Create:

- `.env.example`: local non-HDC staging profile with all local dependencies prepared except OpenAI-compatible Agent provider URL/model/key.
- `CONTRIBUTING.md`: contributor workflow entry point.
- `docs/developer/README.md`: developer documentation index.
- `docs/developer/local-development.md`: local setup and daily workflow.
- `docs/developer/environment-variables.md`: environment variable catalog.
- `docs/developer/verification-matrix.md`: when to run each test/smoke gate.
- `docs/api/README.md`: API documentation index.
- `docs/api/authentication.md`: development and production-mode auth examples.
- `docs/api/errors.md`: structured error and request-id conventions.
- `docs/api/examples.md`: curl examples for common flows.
- `docs/security/README.md`: security documentation index.
- `docs/security/threat-model.md`: practical threat model.
- `docs/security/data-classification.md`: data and evidence classes.
- `docs/security/secrets-management.md`: secret ownership and rotation guidance.
- `docs/security/audit-retention.md`: audit coverage and retention guidance.
- `docs/runbooks/README.md`: runbook index.
- `docs/runbooks/staging-deployment.md`: staging deployment checklist.
- `docs/runbooks/backup-restore.md`: backup/restore drill.
- `docs/runbooks/rollback.md`: rollback rehearsal.
- `docs/runbooks/monitoring-alerting.md`: alert signals and triage.
- `docs/runbooks/hdc-device-lab.md`: real-device evidence runbook.
- `docs/runbooks/agent-provider.md`: live Agent provider runbook.
- `docs/exec-plans/completed/README.md`: completed plan index and interpretation rules.
- `docs/zh-CN/developer-setup.md`: Chinese local development and verification guide.
- `docs/zh-CN/operations-security.md`: Chinese operator/security guide.

Modify:

- `README.md`: route detailed setup to developer docs and mention `.env.example`.
- `AGENTS.md`: replace stale M0 wording and add routing for developer/API/security/runbook docs.
- `ARCHITECTURE.md`: add developer/API/security/runbook deep links.
- `docs/README.md`: add developer, API, security, runbook, and Chinese routing.
- `docs/PLANS.md`: list this active plan and document completed-plan indexing.
- `docs/QUALITY_SCORE.md`: document documentation health and new gates.
- `docs/design-docs/index.md`: label current and historical docs.
- `docs/zh-CN/README.md`: link new Chinese developer/operator pages.
- `scripts/check-doc-governance.ts`: add structural, link, and `.env.example` checks.
- `scripts/check-doc-governance.test.ts`: cover the new checks.

## Task 1: Add Developer And Environment Documentation

- [x] **Step 1: Create `.env.example` local profile**

Expected: a new developer can copy it to `.env`, fill only `AGENT_API_BASE_URL`, `AGENT_MODEL`, and `AGENT_API_KEY`, then run local API mode with PostgreSQL, local object storage, simulator device gateway, and production-mode auth smoke defaults.

- [x] **Step 2: Add developer docs**

Expected: `docs/developer/` explains local setup, runtime modes, environment variables, and verification gates without requiring chat history.

- [x] **Step 3: Add `CONTRIBUTING.md`**

Expected: contributors have one root-level workflow document that points to developer docs, docs governance, tests, and plan lifecycle.

## Task 2: Add Operator, Security, And API Docs

- [x] **Step 1: Add runbook index and focused runbooks**

Expected: staging deployment, backup/restore, rollback, monitoring, HDC device-lab, and Agent provider evidence are each covered by a focused file under `docs/runbooks/`.

- [x] **Step 2: Add security audit docs**

Expected: threat model, data classification, secrets management, and audit retention have stable docs under `docs/security/`.

- [x] **Step 3: Add API usage docs**

Expected: integrators can find auth, errors, and common curl examples under `docs/api/`.

## Task 3: Improve Discoverability And Historical Interpretation

- [x] **Step 1: Update repository maps**

Expected: `README.md`, `AGENTS.md`, `ARCHITECTURE.md`, and `docs/README.md` route users to the new docs.

- [x] **Step 2: Add completed-plan index and design-doc status labels**

Expected: historical plans and dated designs are clearly separated from current contracts.

- [x] **Step 3: Update Chinese documentation layer**

Expected: Chinese-speaking developers can find setup, verification, operator, and security guidance from `docs/zh-CN/README.md`.

## Task 4: Strengthen Documentation Governance Automation

- [x] **Step 1: Write failing tests for new docs checks**

Run:

```bash
npm test -- scripts/check-doc-governance.test.ts
```

Observed before implementation: failed because structural docs checks, markdown link checks, and `.env.example` checks were not implemented.

- [x] **Step 2: Implement docs governance checks**

Expected: `npm run docs:check` validates active plan sections, key docs, markdown links, and required `.env.example` keys.

- [x] **Step 3: Run targeted docs-check tests**

Run:

```bash
npm test -- scripts/check-doc-governance.test.ts
```

Observed: 9 tests passed.

## Task 5: Verify And Close

- [x] **Step 1: Run documentation governance**

Run:

```bash
npm run docs:check
```

Observed: `Documentation governance check passed.`

- [x] **Step 2: Run whitespace check**

Run:

```bash
git diff --check
```

Observed: no output and exit code 0.

- [x] **Step 3: Update plan status**

Observed: all completed steps are checked; no new deferred documentation work was added.

## Documentation Impact Matrix

| Category | Decision | Files |
| --- | --- | --- |
| Repository maps | Update | `README.md`, `AGENTS.md`, `ARCHITECTURE.md`, `docs/README.md`, `CONTRIBUTING.md` |
| Planning | Update | `docs/PLANS.md`, `docs/exec-plans/active/2026-05-29-wiseeff-documentation-system-completion.md`, `docs/exec-plans/completed/README.md` |
| Product | Review | `docs/product-specs/index.md`, `docs/product-specs/product-spec.md`; no product behavior change expected |
| Architecture | Review | `ARCHITECTURE.md`, `docs/design-docs/index.md`, `docs/design-docs/full-stack-architecture.md` |
| Quality and testing | Update | `docs/QUALITY_SCORE.md`, `docs/developer/verification-matrix.md`, `scripts/check-doc-governance.ts`, `scripts/check-doc-governance.test.ts` |
| Reliability and runbooks | Update | `docs/RELIABILITY.md` reviewed; new files under `docs/runbooks/` |
| Security and governance | Update | `docs/SECURITY.md` reviewed; new files under `docs/security/` |
| Frontend and design | Review | `docs/FRONTEND.md`, `docs/DESIGN.md`; no UI change expected |
| API and contracts | Update | `docs/api/*`, `docs/design-docs/api-contract.md` reviewed, `docs/generated/openapi.json` unchanged |
| Generated artifacts | Review | `docs/generated/db-schema.md`, `docs/generated/m5-pilot-acceptance.md`; no generated artifact change expected |
| References | Review | `docs/references/*`; no tooling reference change expected |
| Chinese docs | Update | `docs/zh-CN/README.md`, `docs/zh-CN/developer-setup.md`, `docs/zh-CN/operations-security.md` |

## Documentation Update Gate

- New developer, API, security, and runbook docs must be reachable from `docs/README.md`.
- Root contributor workflow must be reachable from `README.md` or `AGENTS.md`.
- `.env.example` must exist and include the local non-HDC staging defaults plus blank Agent provider URL/model/key fields.
- `npm run docs:check`, `npm test -- scripts/check-doc-governance.test.ts`, and `git diff --check` must pass before this plan can move to `completed/`.
- Any remaining documentation automation or evidence gaps must be recorded in `docs/exec-plans/tech-debt-tracker.md`.

## Expected Outcome

After this plan, WiseEff will have a coherent documentation system for developers, operators, security reviewers, and API integrators. The most common documentation failure modes, including missing `.env.example`, missing key entry docs, broken local markdown links, and active plans without documentation gates, will be mechanically checked by `npm run docs:check`.
