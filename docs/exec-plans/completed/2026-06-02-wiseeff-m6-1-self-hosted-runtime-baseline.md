# WiseEff M6.1 Self-Hosted Runtime Baseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Code changes must follow `superpowers:test-driven-development`: write the failing test or metadata gate first, verify it fails, implement the smallest change, then verify green.

**Goal:** Build a reproducible single-Linux-server WiseEff runtime baseline with API, web, worker, PostgreSQL, reverse proxy, TLS, and self-hosted smoke evidence.

**Architecture:** M6.1 creates the production-shaped self-hosted deployment foundation without introducing new business features. The first target is a controlled single-node deployment profile using Docker Compose or equivalent Linux process management, with later M6 phases adding OIDC, object storage hardening, Redis queueing, observability, and release gates on top.

**Tech Stack:** Linux, Docker Compose, Node.js, Vite static build, TypeScript API, PostgreSQL, Caddy or Nginx reverse proxy, TLS certificates, WiseEff smoke and browser acceptance scripts.

---

## Reference Basis

- Docker Compose official docs: https://docs.docker.com/compose/
- Docker Compose volumes reference: https://docs.docker.com/reference/compose-file/volumes/
- Caddy reverse proxy docs: https://caddyserver.com/docs/quick-starts/reverse-proxy
- Caddy automatic HTTPS docs: https://caddyserver.com/docs/automatic-https

## Scope Boundary

M6.1 includes:

- A self-hosted Linux deployment profile for one controlled server or VM.
- PostgreSQL, API, web, and worker runtime wiring.
- Reverse proxy and TLS termination through Caddy by default, with Nginx as an allowed documented alternative.
- Environment template and validation for the self-hosted profile.
- Basic smoke checks for `/health/live`, `/health/ready`, `/api/v1/me`, and `/api/v1/operations/pilot-readiness`.
- Operator runbook updates that explain install, start, stop, upgrade, and emergency stop.

M6.1 excludes:

- Enterprise OIDC/SSO and durable backend user-management APIs. Those are M6.2.
- Production-grade self-hosted object storage and restore drills. Those are M6.3.
- Redis/BullMQ durable queue. That is M6.4.
- Full metrics, dashboards, alerting, and tracing. Those are M6.5.
- Release promotion, rollback rehearsal, and capacity gates. Those are M6.6.
- HDC hardware enablement beyond keeping the existing simulator/non-HDC policy explicit.

## Dependencies And Ordering

- Start from the latest `main` after M5.12 has merged.
- Keep the existing local `.env.example` behavior intact for developer machines.
- Add self-hosted production templates under `ops/self-hosted/` without replacing `npm run dev:all`.
- Use existing M5 health, smoke, and acceptance gates as runtime proof.

## Success Criteria

- A Linux operator can copy the self-hosted env template, fill secrets, and start WiseEff with one documented command.
- API, web, worker, and PostgreSQL are separate runtime services.
- Reverse proxy serves the frontend and forwards `/api/*` and health endpoints to the API over an internal network.
- TLS is enabled for a real DNS name or documented local certificate path.
- `npm run docs:check`, `npm run contract:check`, `npm run test:all`, `npm run build`, and `git diff --check` pass.
- A self-hosted smoke command validates live API health and records a generated evidence file.
- The plan does not claim commercial production readiness; it only establishes the baseline runtime.

## Expected File Structure

Create:

- `ops/self-hosted/README.md`: operator entry point for the self-hosted baseline.
- `ops/self-hosted/compose.yaml`: API, web, worker, PostgreSQL, and reverse proxy services.
- `ops/self-hosted/.env.example`: self-hosted runtime variables with secrets blank.
- `ops/self-hosted/Caddyfile.example`: default reverse proxy and TLS config.
- `ops/self-hosted/scripts/check-self-hosted-config.ts`: metadata/config validation script.
- `ops/self-hosted/scripts/run-self-hosted-smoke.ts`: target runtime smoke and evidence writer.
- `ops/self-hosted/scripts/check-self-hosted-config.test.ts`: Vitest coverage for config metadata gates.
- `docs/runbooks/self-hosted-runtime.md`: install/start/stop/upgrade/emergency-stop runbook.
- `docs/generated/m6-self-hosted-runtime-evidence.md`: generated smoke evidence, committed only when safe and non-secret.

Modify:

- `package.json`: add `selfhost:check` and `selfhost:smoke`.
- `.env.example`: reference the self-hosted profile without mixing production secrets into the local profile.
- `docs/README.md`: add the new runbook if the docs index does not already route self-hosted operations.
- `docs/runbooks/README.md`: add the self-hosted runtime runbook.
- `docs/developer/environment-variables.md`: document production/self-hosted env differences.
- `docs/developer/verification-matrix.md`: add M6.1 verification commands.
- `docs/RELIABILITY.md`: describe self-hosted health/readiness expectations.
- `ARCHITECTURE.md`: note self-hosted runtime topology after implementation.
- `docs/zh-CN/backend-runtime.md`: add a concise Chinese note for self-hosted runtime commands.
- `docs/exec-plans/active/development-roadmap.md`: mark M6.1 as the first self-hosted hardening phase.

Review:

- `README.md`
- `CONTRIBUTING.md`
- `docs/SECURITY.md`
- `docs/runbooks/manual-acceptance.md`
- `docs/design-docs/deployment-operations.md`

## Implementation Tasks

### Task 1: Self-Hosted Config Metadata Gate

- [x] Write `ops/self-hosted/scripts/check-self-hosted-config.test.ts` first.
- [x] Assert `ops/self-hosted/compose.yaml` defines distinct `postgres`, `api`, `worker`, `web`, and `proxy` services.
- [x] Assert persistent PostgreSQL storage is declared as a named or documented host volume.
- [x] Assert API and worker receive `DATABASE_URL`, auth settings, object-store settings, and Agent settings from env files rather than hardcoded values.
- [x] Assert proxy config contains frontend routing, API routing, health routing, and TLS guidance.
- [x] Run `npm test -- ops/self-hosted/scripts/check-self-hosted-config.test.ts` and confirm the expected failure before implementation.

### Task 2: Compose And Reverse Proxy Baseline

- [x] Add the self-hosted compose file with service boundaries and health checks.
- [x] Build the web as static assets and serve it through a lightweight web container or Caddy file server.
- [x] Run the API service with `NODE_ENV=production`.
- [x] Run the worker as a separate service using `npm run worker:logs`.
- [x] Configure the proxy to expose only HTTP/HTTPS externally and keep PostgreSQL/API internals on the private compose network.
- [x] Run `npm run selfhost:check` and confirm the metadata gate passes.

### Task 3: Environment Template And Validation

- [x] Create `ops/self-hosted/.env.example` with secrets blank and operational defaults explicit.
- [x] Keep local `.env.example` as the developer profile and link to the self-hosted profile.
- [x] Document required operator-provided values: DNS name, TLS email or certificate path, database password, auth secret, Agent provider values, object-store policy, and simulator/HDC decision.
- [x] Add validation so the self-hosted smoke fails with actionable messages when required values are missing.
- [x] Run `npm run docs:check` after adding env documentation.

### Task 4: Self-Hosted Smoke Evidence

- [x] Add `ops/self-hosted/scripts/run-self-hosted-smoke.ts`.
- [x] Probe `/health/live`, `/health/ready`, `/api/v1/me`, and `/api/v1/operations/pilot-readiness`.
- [x] Redact authorization headers and secrets from evidence output.
- [x] Write generated evidence to `docs/generated/m6-self-hosted-runtime-evidence.md` or a caller-provided path.
- [x] Add tests for pass, dependency-blocked, and auth-failed smoke outcomes.
- [x] Run `npm test -- ops/self-hosted/scripts/run-self-hosted-smoke.test.ts` if the smoke runner receives a dedicated test file, otherwise include it in `check-self-hosted-config.test.ts`.

### Task 5: Operator Runbook

- [x] Create `docs/runbooks/self-hosted-runtime.md`.
- [x] Include prerequisites: Linux distribution expectation, Docker Engine/Compose version check, DNS, firewall ports, disk, backup location, and secret handling.
- [x] Include start, status, logs, restart, stop, database migration, and smoke commands.
- [x] Include emergency stop that stops API/web/worker while preserving PostgreSQL data.
- [x] Update runbook indexes and Chinese developer docs.

### Task 6: Verification And Completion

- [x] Run `npm run selfhost:check`.
- [x] Run `npm run docs:check`.
- [x] Run `npm run contract:check`.
- [x] Run `npm run test:all`.
- [x] Run `npm run build`.
- [x] Run `git diff --check`.
- [x] If a target Linux host is available, run `npm run selfhost:smoke -- --base-url <target-url>` and record evidence. If no target host is available, record that only metadata/local docs gates passed and keep runtime evidence open.

Execution note: no target Linux host was available in this development environment, so `selfhost:smoke` was covered by unit tests and the live-target smoke evidence remains an operator action for the first deployed self-hosted target.

## External Inputs Needed

- Linux server or VM hostname and OS version.
- Public or internal DNS name.
- TLS approach: automatic ACME, internal CA, or existing certificate files.
- Whether the first deployment may use simulator device mode.
- Whether the web/API should be reachable on public internet, VPN, or private LAN only.
- Agent provider URL/model/key if live Agent checks are in scope.

## Documentation Impact Matrix

| Area | Status | Files | Notes |
| --- | --- | --- | --- |
| Repository maps | Update | `docs/README.md`, `docs/runbooks/README.md`, `AGENTS.md` | Add self-hosted runtime entry points if new `ops/self-hosted/` and runbook paths become durable. |
| Planning docs | Update | `docs/exec-plans/active/development-roadmap.md`, this plan | Track M6.1 as the first self-hosted production-hardening phase. |
| Product specs | No change | `docs/product-specs/` | No product workflow behavior change. |
| Architecture docs | Update | `ARCHITECTURE.md`, `docs/design-docs/full-stack-architecture.md`, `docs/design-docs/deployment-operations.md` | Document self-hosted topology and runtime boundaries. |
| Quality/testing docs | Update | `docs/developer/verification-matrix.md`, `docs/design-docs/testing-strategy.md`, `docs/QUALITY_SCORE.md` | Add self-hosted metadata and smoke gates. |
| Reliability/runbooks | Update | `docs/RELIABILITY.md`, `docs/runbooks/self-hosted-runtime.md`, `docs/runbooks/manual-acceptance.md` | Add health, readiness, smoke, and operator procedures. |
| Security/governance docs | Review | `docs/SECURITY.md`, `docs/security/secrets-management.md` | Confirm secret handling and public exposure guidance. |
| Frontend/design docs | Review | `docs/FRONTEND.md` | No UI behavior change expected; verify API base URL deployment guidance remains correct. |
| Generated artifacts | Review | `docs/generated/m6-self-hosted-runtime-evidence.md` | Commit only non-secret evidence; otherwise write to `test-results/`. |
| References | Review | `docs/references/` | Add a compact self-hosted reference only if repeated agent execution needs it. |
| Chinese developer docs | Update | `docs/zh-CN/backend-runtime.md`, `docs/zh-CN/security-reliability.md` | Add short Chinese operator/developer guidance for self-hosted runtime and smoke. |

## Documentation Update Gate

- `npm run docs:check` must pass before this plan is moved to `docs/exec-plans/completed/`.
- Every `Update` row above must be updated in the same branch as the implementation.
- Every `Review` row must record unchanged-with-evidence in the PR description or be updated.
- If a target Linux host is not available, runtime evidence remains open and must be tracked in `docs/exec-plans/tech-debt-tracker.md`.

## UI Interaction Automation Review

M6.1 should not change WiseEff user-facing interaction behavior.

- Affected acceptance specs: none expected.
- Acceptance requirement IDs: existing `AUTH-RUNTIME-001` may be exercised during smoke, but the browser behavior should not change.
- Operation IDs: no operation matrix changes expected.
- Evidence: If deployment URL handling changes frontend runtime behavior, run `npm run acceptance:browser -- --mode target-non-hdc --no-start-runtime` and update `docs/developer/browser-acceptance-coverage-map.md` only if new behavior appears.
