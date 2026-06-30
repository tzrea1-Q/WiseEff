# WiseEff M5.2 Staging Pilot Evidence Execution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Behavior-changing fixes discovered during execution must follow `superpowers:test-driven-development`: write a failing test first, verify the failure, implement the smallest fix, then verify green.

**Goal:** Execute the real staging pilot evidence gate for the merged M0-M5 baseline and record verifiable proof for live API, PostgreSQL-backed E2E, worker/object storage, HDC device-lab, backup/restore, rollback, and live Agent provider readiness.

**Architecture:** M5.2 is an evidence-execution phase, not a new feature phase. It treats `docs/generated/m5-pilot-acceptance.md` as the evidence ledger, `docs/runbooks/m5-commercial-pilot-readiness.md` as the operator checklist, and `/api/v1/operations/pilot-readiness` plus `npm run smoke:m5` as the runtime gate. Any missing product capability found while gathering evidence must become a tested fix or a recorded blocker; production hardening work such as OIDC/SSO, Redis/BullMQ, IaC, observability, and capacity testing stays in M6.

**Tech Stack:** GitHub PR workflow, Node.js/npm, Vite/React, Playwright, Vitest, TypeScript API, PostgreSQL, node-postgres, S3/OSS-compatible object store seam, HDC device gateway seam, live Agent provider seam, Markdown evidence docs.

---

## Scope Boundary

This M5.2 plan includes:

- Synchronizing the local workspace with the GitHub baseline after M5.1 is merged.
- Preparing a controlled staging environment with PostgreSQL, API, worker, object storage, HDC device gateway, and live Agent provider configuration.
- Running repository gates, PostgreSQL-backed API-mode E2E, live M5 smoke, HDC device-lab smoke, backup/restore drill, rollback rehearsal, and pilot-readiness verification.
- Recording exact evidence, timestamps, commands, environment names, and skipped checks in docs.
- Closing or updating TD-019 only if real evidence is captured.

This M5.2 plan does not include:

- Implementing enterprise SSO/OIDC.
- Replacing the database-backed worker lease model with Redis/BullMQ or another durable queue.
- Building cloud IaC, production monitoring dashboards, alert routing, or capacity/load testing.
- Replacing the M5 object-store seam with provider SDK-specific production infrastructure.
- Claiming pilot readiness if any external evidence gate is not actually run.

## Execution Status

Current execution attempt: 2026-05-29 on branch `codex/m5-2-staging-pilot-evidence`, baseline commit `0701b1a`.

Completed locally:

- Confirmed M5.1 is merged into `origin/main`.
- Created the M5.2 execution branch from `origin/main`.
- Verified `.env.staging.local` is ignored and absent.
- Ran local repository gates: `npm ci`, `npm run docs:check`, `npm run contract:check`, `npm run test:all`, `npm run build`, and `git diff --check`.
- Configured and used local Docker PostgreSQL for DB-gated verification.
- Ran local DB setup gates: `npm run db:migrate`, `npm run db:seed:m0`, `npm run db:seed:m1`, `npm run db:seed:m2`, and `npm run db:seed:m3`.
- Ran local PostgreSQL-backed API-mode E2E for parameter management, log analysis, debugging simulator, and Agent flows: 6 passed, 1 HDC device-lab test skipped.
- Ran focused frontend and server regressions for the DB-gated fixes.
- Recorded local gate evidence and external-environment blockers in `docs/generated/m5-pilot-acceptance.md`.
- On 2026-05-30, after `.env` was completed for local validation, reran local DB setup, local non-HDC live smoke, local live API preflight, local browser acceptance, and local production-auth API-mode E2E. The evidence is recorded in `docs/generated/m5-pilot-acceptance.md`. These checks strengthen local readiness evidence but do not satisfy this plan's staging/HDC/cloud/rollback success criteria.
- On 2026-06-02, after PR #52 merged, latest `main` was revalidated locally on branch `codex/m5-2-remaining-evidence-closure`: `npm run docs:check`, `npm run contract:check`, `npm run acceptance:ci`, `npm run acceptance:models`, `npm run acceptance:quality`, `npm run build`, `npm run acceptance:browser -- --mode=local-non-hdc`, `npm run acceptance:evidence`, and `git diff --check` passed. A temporary local API on `127.0.0.1:8877` used the completed `.env` live Agent provider configuration; `npm run smoke:m5` passed with `npm_config_allow_only_blocked=deviceGateway`, leaving only `deviceGateway` blocked. These checks remain local non-HDC evidence, not full staging/HDC/cloud/rollback evidence.

Blocked pending target-environment inputs:

- Staging or target `DATABASE_URL`.
- Staging or target live API URL.
- Production-mode staging auth issuer/secret and signed admin smoke token.
- S3/OSS-compatible object storage endpoint, bucket, and credentials.
- HDC device-lab runtime plus `HDC_SMOKE_*` safe target values.
- Staging live Agent provider model, API key, base URL, and safe outage-simulation window.
- Backup target, restore target, and rollback rehearsal window.

Completion decision, 2026-06-02: keep this plan in `docs/exec-plans/active/`. Full staging pilot evidence has not been captured; TD-019 must remain open.

## Success Criteria

- `origin/main` includes the M5.1 documentation governance changes before M5.2 starts.
- Staging runs with production-style configuration: `AUTH_MODE=production`, PostgreSQL, `OBJECT_STORE_MODE=s3`, `DEBUG_DEVICE_GATEWAY_MODE=hdc`, and live Xiaoze LLM configuration (`AGENT_API_*`, or `XIAOZE_DETERMINISTIC=true` for offline acceptance).
- `/health/live`, `/health/ready`, and `/api/v1/operations/pilot-readiness` are checked against the live staging API.
- `npm run smoke:m5` runs against a live API URL without `M5_SMOKE_ALLOW_NO_API=true`.
- PostgreSQL-backed API-mode E2E runs for parameter management, log analysis, debugging, and Agent flows.
- HDC device-lab smoke records read, write, readback, timeout/offline or stderr behavior, readback mismatch behavior, and rollback evidence.
- Backup/restore drill records backup timestamp, restore timestamp, restore target, and validation commands.
- Rollback rehearsal records the trigger used, the rollback sequence, and post-rollback smoke result.
- `docs/generated/m5-pilot-acceptance.md` and `docs/runbooks/m5-commercial-pilot-readiness.md` reflect only evidence that was actually collected.

## Evidence Capture Rules

Use these rules for every external check:

- Record the date and timezone.
- Record the branch, commit SHA, and GitHub PR/CI reference.
- Record the environment name, not secrets.
- Record the exact command and whether it passed or failed.
- Record the live URL host only if it is safe to disclose; otherwise record a stable internal environment label.
- Redact tokens, secrets, bucket credentials, and device identifiers that should not be committed.
- If a command fails, preserve the failure reason in `docs/generated/m5-pilot-acceptance.md` and keep the related checklist item unchecked.

## File Structure

Modify:

- `docs/PLANS.md`: list M5.2 as the active execution plan.
- `docs/exec-plans/active/development-roadmap.md`: add M5.2 as the current post-M5 evidence-execution phase.
- `docs/generated/m5-pilot-acceptance.md`: record M5.2 evidence and keep unrun external checks unchecked.
- `docs/runbooks/m5-commercial-pilot-readiness.md`: update Go/No-Go outcomes after actual execution.
- `docs/QUALITY_SCORE.md`: update production/pilot evidence score only after real evidence changes.
- `docs/exec-plans/tech-debt-tracker.md`: update TD-019 after evidence is captured or blockers are discovered.

Review:

- `docs/RELIABILITY.md`
- `docs/SECURITY.md`
- `docs/design-docs/deployment-operations.md`
- `docs/design-docs/testing-strategy.md`
- `docs/generated/documentation-governance-audit.md`

Do not commit:

- `.env.staging.local`
- secret exports
- raw logs containing tokens
- customer data

## Task 1: Synchronize The Baseline And Open M5.2 Work

**Files:**
- Review: Git working tree and remote branches
- Modify: this plan only if baseline state differs from the assumptions below

- [ ] **Step 1: Confirm the local workspace is clean**

Run:

```bash
git status --short --branch
```

Expected:

- The working tree is clean.
- The current branch is either `main` tracking `origin/main` or a dedicated M5.2 branch created from `origin/main`.

Execution note: not complete in this attempt because the M5.2 planning docs were already modified before execution began. The branch is now a dedicated M5.2 branch, and the remaining dirty files are this active plan plus evidence documentation updates.

- [x] **Step 2: Confirm M5.1 is merged before starting execution**

Run:

```bash
git fetch origin
git branch --contains b66418d --remotes
```

Expected:

- `origin/main` contains commit `b66418d docs: complete M5.1 documentation governance`, or GitHub shows the M5.1 PR merged.
- If `origin/main` does not contain M5.1, stop M5.2 execution and merge M5.1 first.

- [x] **Step 3: Create the M5.2 execution branch**

Run:

```bash
git switch main
git pull --ff-only origin main
git switch -c codex/m5-2-staging-pilot-evidence
```

Expected:

- The branch is `codex/m5-2-staging-pilot-evidence`.
- `git status --short --branch` shows a clean branch based on current `origin/main`.

## Task 2: Prepare The Staging Configuration Inventory

**Files:**
- Modify: `docs/generated/m5-pilot-acceptance.md`
- Modify: `docs/runbooks/m5-commercial-pilot-readiness.md`

- [ ] **Step 1: Create a local-only staging env file**

Create `.env.staging.local` locally and do not commit it. It must define these names with real staging values:

```bash
NODE_ENV=production
DATABASE_URL=operator-provided-staging-postgres-url
AUTH_MODE=production
AUTH_TOKEN_ISSUER=operator-provided-issuer
AUTH_TOKEN_HMAC_SECRET=operator-provided-secret-at-least-32-chars
OBJECT_STORE_MODE=s3
OBJECT_STORAGE_ENDPOINT=operator-provided-object-storage-endpoint
OBJECT_STORAGE_BUCKET=operator-provided-object-storage-bucket
OBJECT_STORAGE_ACCESS_KEY_ID=operator-provided-access-key
OBJECT_STORAGE_SECRET_ACCESS_KEY=operator-provided-secret-key
OBJECT_STORAGE_REGION=operator-provided-region
DEBUG_DEVICE_GATEWAY_MODE=hdc
HDC_TIMEOUT_MS=5000
AGENT_API_BASE_URL=operator-provided-agent-api-base-url
AGENT_MODEL=operator-provided-model
AGENT_API_KEY=operator-provided-agent-api-key
AGENT_API_TIMEOUT_MS=30000
WISEEFF_API_BASE_URL=operator-provided-staging-api-url
M5_CONTRACT_CHECK_PASSED=true
```

Expected:

- `.env.staging.local` exists locally.
- `git status --short` does not show `.env.staging.local`.

Execution note: blocked in this attempt. `.env.staging.local` is ignored by `.gitignore`, but no staging env file or secret values were available in this workspace.

- [ ] **Step 2: Generate or obtain an admin smoke token**

Use the project HMAC token format documented in `docs/SECURITY.md`: `Authorization: Bearer <base64url-json-payload>.<hmac-sha256-signature>`. The signed payload must include issuer, subject, organization, and `admin:access`.

Set one of these local-only variables:

```bash
M5_SMOKE_AUTHORIZATION=Bearer <signed-admin-token>
WISEEFF_SMOKE_AUTHORIZATION=Bearer <signed-admin-token>
```

Expected:

- The token is not committed.
- A request to `/api/v1/me` on staging returns the expected admin identity.

Execution note: blocked in this attempt because no issuer/secret/admin token was available.

- [x] **Step 3: Record the staging inventory without secrets**

Append a `## M5.2 Staging Evidence` section to `docs/generated/m5-pilot-acceptance.md`:

```markdown
## M5.2 Staging Evidence

Date: 2026-05-29
Environment: staging
Branch: `codex/m5-2-staging-pilot-evidence`
Commit: `<commit-sha-recorded-during-execution>`

### Configuration Inventory

- PostgreSQL: configured; connection string redacted.
- Auth: `AUTH_MODE=production`; issuer recorded; HMAC secret redacted.
- Object storage: `OBJECT_STORE_MODE=s3`; bucket name redacted or environment-labeled.
- Device gateway: `DEBUG_DEVICE_GATEWAY_MODE=hdc`.
- Xiaoze LLM: `AGENT_API_BASE_URL`, `AGENT_MODEL`, and `AGENT_API_KEY`, or `XIAOZE_DETERMINISTIC=true` for offline acceptance; model recorded if safe.
- Smoke authorization: admin token present; token redacted.
```

Expected:

- No secrets appear in the committed diff.
- Unknown or unavailable dependencies are listed as blockers instead of omitted.

## Task 3: Run Repository Gates Before Touching Staging

**Files:**
- Modify: `docs/generated/m5-pilot-acceptance.md`

- [x] **Step 1: Install dependencies from lockfile**

Run:

```bash
npm ci
```

Expected: PASS.

- [x] **Step 2: Run local repository gates**

Run:

```bash
npm run docs:check
npm run contract:check
npm run test:all
npm run build
git diff --check
```

Expected:

- All commands pass.
- `npm run build` may retain the existing Vite chunk-size warning.

- [x] **Step 3: Record repository-gate evidence**

Append to `docs/generated/m5-pilot-acceptance.md`:

```markdown
### Repository Gate Evidence

- `npm ci`: passed on 2026-05-29.
- `npm run docs:check`: passed on 2026-05-29.
- `npm run contract:check`: passed on 2026-05-29.
- `npm run test:all`: passed on 2026-05-29.
- `npm run build`: passed on 2026-05-29; existing Vite chunk-size warning observed.
- `git diff --check`: passed on 2026-05-29.
```

Expected:

- Use the actual execution date and results.
- If any command fails, record the failure and stop external pilot signoff.

## Task 4: Apply Database Migrations And Validate PostgreSQL-Backed E2E

**Files:**
- Modify: `docs/generated/m5-pilot-acceptance.md`
- Modify: `docs/QUALITY_SCORE.md` only after evidence changes

- [ ] **Step 1: Run migrations against staging PostgreSQL**

Run with the staging `DATABASE_URL` loaded:

```bash
npm run db:migrate
```

Expected:

- All migrations through `0010_m5_agent_provider_traces.sql` are applied.
- Re-running the command is safe and does not create duplicate schema state.

- [ ] **Step 2: Seed non-customer staging data when appropriate**

Run only in a non-customer staging environment:

```bash
npm run db:seed:m0
npm run db:seed:m1
npm run db:seed:m2
npm run db:seed:m3
```

Expected:

- Seed commands pass.
- If the environment contains customer pilot data, skip seed commands and record that the environment used governed pilot data instead.

- [ ] **Step 3: Run PostgreSQL-backed API-mode E2E**

Run:

```bash
npm run test:e2e -- e2e/parameter-management.api.spec.ts e2e/log-analysis.api.spec.ts e2e/debugging.api.spec.ts
npm run acceptance:e2e -- e2e/acceptance/xiaoze-perception.acceptance.spec.ts e2e/acceptance/xiaoze-action.acceptance.spec.ts
```

Expected:

- Parameter, log, debugging, and Agent API-mode E2E pass with `DATABASE_URL` set.
- If HDC device-lab variables are not set yet, the simulator portion may pass while the HDC lab-only smoke remains separate in Task 7.

Local execution note, 2026-05-29: passed against local Docker PostgreSQL with `DATABASE_URL=postgres://wiseeff:***@127.0.0.1:5432/wiseeff`, `OBJECT_STORE_ROOT=.wiseeff-object-store`, `DEBUG_DEVICE_GATEWAY_MODE=simulator`, and `CI=1`. The command reported 6 passed and 1 skipped; the skipped test was the HDC device-lab smoke, which still belongs to Task 7.

- [ ] **Step 4: Record PostgreSQL evidence**

Append to `docs/generated/m5-pilot-acceptance.md`:

```markdown
### PostgreSQL And API-Mode E2E Evidence

- `npm run db:migrate`: passed; migrations through `0010_m5_agent_provider_traces.sql` applied.
- Seed policy: non-customer staging seeds applied, or governed pilot data used.
- API-mode Playwright E2E: passed for parameter management, log analysis, debugging, and Agent specs.
```

Expected:

- If any E2E fails, add the failing spec name and failure reason.
- Do not mark staging pilot smoke complete until the failure is fixed with TDD or recorded as a blocker.

Local execution note, 2026-05-29: recorded local PostgreSQL API-mode E2E evidence in `docs/generated/m5-pilot-acceptance.md`. This does not complete external staging evidence.

## Task 5: Start Staging API, Worker, Object Storage, And Frontend Runtime

**Files:**
- Modify: `docs/generated/m5-pilot-acceptance.md`
- Modify: `docs/runbooks/m5-commercial-pilot-readiness.md`

- [ ] **Step 1: Start the API with production-style staging env**

Run using the staging process manager or local shell:

```bash
npm run dev:api
```

Expected:

- The API starts without development auth fallback.
- Startup fails if required production settings are missing.

- [ ] **Step 2: Start the log worker**

Run in a separate process with the same staging env:

```bash
npm run worker:logs
```

Expected:

- The worker starts and connects to PostgreSQL and object storage.
- Worker readiness is visible through `/health/ready` or pilot-readiness dependency output.

- [ ] **Step 3: Build or serve the frontend in API mode**

Run:

```bash
npm run build
```

For manual staging UI validation, run the deployed web app or local dev server with:

```bash
VITE_WISEEFF_RUNTIME_MODE=api
VITE_WISEEFF_API_BASE_URL=$WISEEFF_API_BASE_URL
npm run dev
```

Expected:

- Production build passes.
- API-mode frontend can reach the staging API.

- [ ] **Step 4: Record runtime startup evidence**

Append to `docs/generated/m5-pilot-acceptance.md`:

```markdown
### Runtime Startup Evidence

- API process: started with production auth mode.
- Worker process: started and connected to PostgreSQL/object storage.
- Frontend: production build passed; API-mode runtime verified against staging API.
- Object storage readiness: checked through `/health/ready`.
```

Expected:

- If object storage readiness is blocked, record the dependency reason from `/health/ready`.

## Task 6: Run Live Health And M5 Smoke Gates

**Files:**
- Modify: `docs/generated/m5-pilot-acceptance.md`
- Modify: `docs/runbooks/m5-commercial-pilot-readiness.md`

- [ ] **Step 1: Check live health endpoints**

Run:

```bash
curl -fsS "$WISEEFF_API_BASE_URL/health/live"
curl -fsS "$WISEEFF_API_BASE_URL/health/ready"
```

Expected:

- `/health/live` returns success.
- `/health/ready` returns success or a dependency-specific failure that must be fixed before pilot signoff.

- [ ] **Step 2: Check pilot readiness directly**

Run:

```bash
curl -fsS \
  -H "Authorization: $M5_SMOKE_AUTHORIZATION" \
  "$WISEEFF_API_BASE_URL/api/v1/operations/pilot-readiness"
```

Expected:

- Before all evidence env vars are present, `status` may be `blocked` with actionable dependency reasons.
- After Tasks 7-9 evidence is captured and env evidence variables are set, `status` must be `pilot_ready`.

- [ ] **Step 3: Run the live M5 smoke**

Run without `M5_SMOKE_ALLOW_NO_API=true`:

```bash
npm run smoke:m5
```

Expected:

- The smoke checks OpenAPI, `/health/live`, `/health/ready`, and `/api/v1/operations/pilot-readiness`.
- It passes only when the live API is reachable and pilot-readiness is not blocked.

- [ ] **Step 4: Record live smoke evidence**

Append to `docs/generated/m5-pilot-acceptance.md`:

```markdown
### Live API Smoke Evidence

- `/health/live`: passed.
- `/health/ready`: passed.
- `/api/v1/operations/pilot-readiness`: `pilot_ready`.
- `npm run smoke:m5`: passed against live staging API without `M5_SMOKE_ALLOW_NO_API=true`.
```

Expected:

- If `pilot-readiness` is blocked, keep `Staging pilot smoke evidence is attached` unchecked and record the blockers.

## Task 7: Execute HDC Device-Lab Evidence

**Files:**
- Modify: `docs/generated/m5-pilot-acceptance.md`
- Modify: `docs/runbooks/m5-commercial-pilot-readiness.md`
- Modify: `docs/exec-plans/tech-debt-tracker.md` only after evidence changes

- [ ] **Step 1: Load HDC smoke target variables**

Set these local-only variables:

```bash
HDC_DEVICE_LAB_AVAILABLE=true
HDC_SMOKE_PROJECT_ID=operator-provided-project-id
HDC_SMOKE_DEVICE_ID=operator-provided-device-id
HDC_SMOKE_TARGET_REF=operator-provided-target-ref
HDC_SMOKE_PARAMETER_ID=operator-provided-parameter-id
HDC_SMOKE_NODE_PATH=operator-provided-node-path
HDC_SMOKE_WRITE_VALUE=operator-provided-safe-write-value
HDC_SMOKE_EXPECT_READ_PATTERN=operator-provided-safe-read-pattern
```

Expected:

- The selected node is safe for a controlled write and rollback.
- The target device is available in the device lab.

- [ ] **Step 2: Run the HDC device-lab smoke**

Run:

```bash
npm run test:e2e -- e2e/debugging.api.spec.ts
```

Expected:

- Target detection succeeds through HDC mode.
- Node read succeeds.
- Node write succeeds with readback.
- Snapshot rollback restores the previous value.
- Timeout/offline, stderr/nonzero, and readback mismatch behavior are either exercised in this run or recorded as separate device-lab evidence.

- [ ] **Step 3: Record HDC evidence**

Append to `docs/generated/m5-pilot-acceptance.md`:

```markdown
### HDC Device-Lab Evidence

- Device-lab HDC smoke: passed.
- Target detection: passed.
- Node read: passed.
- Node write with readback: passed.
- Snapshot rollback restore: passed.
- Timeout/offline behavior: evidence attached or blocker recorded.
- stderr/nonzero behavior: evidence attached or blocker recorded.
- Readback mismatch behavior: evidence attached or blocker recorded.
```

Update the checklist only if the evidence exists:

```markdown
- [x] Device-lab HDC smoke was run in this environment.
```

Expected:

- No device-lab item is checked without supporting evidence text.

## Task 8: Execute Backup/Restore Drill

**Files:**
- Modify: `docs/generated/m5-pilot-acceptance.md`
- Modify: `docs/runbooks/m5-commercial-pilot-readiness.md`

- [ ] **Step 1: Take a fresh staging backup**

Use the approved staging PostgreSQL and object-storage backup mechanism. Record:

```markdown
- Backup started at: 2026-05-29T00:00:00+08:00
- Backup completed at: 2026-05-29T00:00:00+08:00
- Backup target: redacted staging backup location
- Object storage backup: included or explicitly not applicable for this environment
```

Expected:

- Backup completes without errors.
- Backup identifiers are safe to commit or redacted.

- [ ] **Step 2: Restore into a clean environment**

Restore the backup to a clean staging-restore target. Then run:

```bash
curl -fsS "$RESTORE_API_BASE_URL/health/live"
curl -fsS "$RESTORE_API_BASE_URL/health/ready"
curl -fsS \
  -H "Authorization: $M5_SMOKE_AUTHORIZATION" \
  "$RESTORE_API_BASE_URL/api/v1/operations/pilot-readiness"
```

Expected:

- Restored API answers live and ready checks.
- Pilot readiness either passes or reports only expected environment-specific blockers.

- [ ] **Step 3: Set backup drill evidence variable for the pilot gate**

Set:

```bash
M5_BACKUP_RESTORE_DRILL_AT=2026-05-29T00:00:00+08:00
```

Expected:

- The timestamp matches the actual completed restore validation time.

- [ ] **Step 4: Record backup/restore evidence**

Append to `docs/generated/m5-pilot-acceptance.md`:

```markdown
### Backup And Restore Evidence

- Backup completed: passed.
- Restore target: clean staging-restore environment.
- Restore validation `/health/live`: passed.
- Restore validation `/health/ready`: passed.
- Restore validation `/api/v1/operations/pilot-readiness`: passed or expected blockers recorded.
- `M5_BACKUP_RESTORE_DRILL_AT`: set to actual restore validation timestamp.
```

Update the checklist only if the drill ran:

```markdown
- [x] Backup/restore drill was run in this environment.
```

Expected:

- If restore is not run, keep the checklist item unchecked.

## Task 9: Execute Rollback Rehearsal

**Files:**
- Modify: `docs/generated/m5-pilot-acceptance.md`
- Modify: `docs/runbooks/m5-commercial-pilot-readiness.md`

- [ ] **Step 1: Select a safe rollback trigger**

Use one controlled trigger:

```markdown
- Disable pilot traffic in staging, or
- Temporarily remove the worker from readiness, or
- Restore the previous API/web artifact in staging.
```

Expected:

- The trigger does not affect customer production.
- The trigger is reversible.

- [ ] **Step 2: Run the rollback sequence**

Follow `docs/runbooks/m5-commercial-pilot-readiness.md`:

```markdown
1. Stop new writes.
2. Drain or disable the worker.
3. Remove traffic from the pilot deployment.
4. Restore the last known good database and object store state.
5. Re-run `npm run smoke:m5`.
6. Verify the acceptance artifact reflects the rollback and the restored environment.
```

Expected:

- Rollback completes.
- `npm run smoke:m5` passes after rollback recovery.

- [ ] **Step 3: Record rollback evidence**

Append to `docs/generated/m5-pilot-acceptance.md`:

```markdown
### Rollback Rehearsal Evidence

- Rollback trigger: recorded.
- New writes stopped or blocked: passed.
- Worker drained or disabled: passed.
- Pilot traffic removed or restored to prior artifact: passed.
- Database/object-store restore step: passed or explicitly not needed for selected trigger.
- Post-rollback `npm run smoke:m5`: passed.
```

Expected:

- If rollback rehearsal is not run, keep the runbook Go/No-Go rollback item unchecked.

## Task 10: Verify Live Agent Provider Evidence

**Files:**
- Modify: `docs/generated/m5-pilot-acceptance.md`
- Modify: `docs/runbooks/m5-commercial-pilot-readiness.md`
- Modify: `docs/SECURITY.md` or `docs/RELIABILITY.md` only if behavior differs from documented boundaries

- [ ] **Step 1: Confirm live Xiaoze LLM configuration**

Run with staging env:

```bash
curl -fsS "$WISEEFF_API_BASE_URL/health/ready"
```

Expected:

- `dependencies.xiaozeLlm` is ready.
- Live `AGENT_API_*` values are configured, or `XIAOZE_DETERMINISTIC=true` is set for offline acceptance.

- [ ] **Step 2: Run Xiaoze acceptance against PostgreSQL**

Run:

```bash
npm run acceptance:e2e -- e2e/acceptance/xiaoze-perception.acceptance.spec.ts
npm run acceptance:e2e -- e2e/acceptance/xiaoze-action.acceptance.spec.ts
```

Expected:

- Xiaoze perception, approval, and audit flows pass.
- Trace metadata records latency, token usage or equivalent metadata, safety status, and fallback reason when applicable.

- [ ] **Step 3: Verify LLM outage behavior**

In a controlled staging window, point `AGENT_API_BASE_URL` to an unavailable endpoint or use an approved provider outage simulation. Then run the smallest Agent request that exercises provider health.

Expected:

- The API returns degraded assistant behavior or readiness block as designed.
- No mutating tool executes during provider outage.
- Audit/readiness evidence records the fallback reason.

- [ ] **Step 4: Record Agent evidence**

Append to `docs/generated/m5-pilot-acceptance.md`:

```markdown
### Live Agent Provider Evidence

- `XIAOZE_DETERMINISTIC=true` or live `AGENT_API_*`: verified.
- Agent API-mode E2E: passed.
- Provider trace metadata: latency/token/cost/safety/fallback fields recorded.
- Provider outage behavior: no mutating tool executed; fallback/readiness evidence recorded.
```

Expected:

- If provider outage cannot be safely simulated, record it as an explicit blocker instead of checking the runbook item.

## Task 11: Run The Final Pilot-Readiness Gate

**Files:**
- Modify: `docs/generated/m5-pilot-acceptance.md`
- Modify: `docs/runbooks/m5-commercial-pilot-readiness.md`
- Modify: `docs/QUALITY_SCORE.md`
- Modify: `docs/exec-plans/tech-debt-tracker.md`

- [ ] **Step 1: Re-run the full M5 gate**

Run:

```bash
npm run test:m5
```

Expected:

- `npm run contract:check` passes.
- `npm run test:all` passes.
- `npm run build` passes.
- `npm run test:e2e` passes.
- `tsx scripts/run-m5-smoke.ts --require-api` passes against the live API.

- [ ] **Step 2: Re-check pilot readiness**

Run:

```bash
curl -fsS \
  -H "Authorization: $M5_SMOKE_AUTHORIZATION" \
  "$WISEEFF_API_BASE_URL/api/v1/operations/pilot-readiness"
```

Expected:

- The response is `status: "pilot_ready"`.
- Every dependency reason is ready or has evidence attached.

- [ ] **Step 3: Update acceptance checklist**

Update `docs/generated/m5-pilot-acceptance.md` only for evidence that actually exists:

```markdown
- [x] Device-lab HDC smoke was run in this environment.
- [x] Backup/restore drill was run in this environment.
- [x] Staging pilot smoke evidence is attached.
```

Expected:

- If any item lacks evidence, leave it unchecked and record the blocker.

- [ ] **Step 4: Update the runbook Go/No-Go checklist**

In `docs/runbooks/m5-commercial-pilot-readiness.md`, check only completed items. Keep unchecked any item without evidence:

```markdown
- [x] `/api/v1/operations/pilot-readiness` returns `status: "pilot_ready"`.
- [x] `/health/ready` is green.
- [x] Backup/restore drill timestamp is recorded.
- [x] Device-lab smoke evidence is attached.
- [x] Agent provider health or safety evidence is attached.
- [x] Rollback steps were rehearsed in the target environment.
```

Expected:

- The runbook remains an honest gate, not a wish list.

- [ ] **Step 5: Update quality and technical debt**

If all external evidence is captured, update:

```markdown
docs/QUALITY_SCORE.md
docs/exec-plans/tech-debt-tracker.md
```

Expected:

- `Production/pilot evidence` score increases only if real evidence exists.
- TD-019 moves to completed only if staging live API, HDC device-lab, backup/restore, rollback, and live provider evidence are all recorded.
- If some evidence remains missing, TD-019 stays open with the exact missing gate.

## Task 12: Final Documentation Governance And Commit

**Files:**
- Modify: `docs/PLANS.md`
- Modify: `docs/exec-plans/active/development-roadmap.md`
- Move after completion: this plan to `docs/exec-plans/completed/2026-05-29-wiseeff-m5-2-staging-pilot-evidence-execution.md`

- [ ] **Step 1: Run final verification**

Run:

```bash
npm run docs:check
npm run contract:check
npm run build
git diff --check
```

Expected:

- All commands pass.
- Existing Vite chunk-size warning is acceptable.

- [ ] **Step 2: Check for stale evidence claims**

Run:

```bash
rg -n "M5_SMOKE_ALLOW_NO_API=true|External Checks Not Run Locally|pilot-ready|pilot_ready|TD-019|Device-lab HDC smoke|Backup/restore drill|Staging pilot smoke" docs/generated/m5-pilot-acceptance.md docs/runbooks/m5-commercial-pilot-readiness.md docs/QUALITY_SCORE.md docs/exec-plans/tech-debt-tracker.md
```

Expected:

- Local skip language is not used as staging proof.
- `pilot_ready` is claimed only if the live gate passed.
- TD-019 state matches the captured evidence.

- [ ] **Step 3: Move this plan to completed when execution is done**

Run:

```bash
git mv docs/exec-plans/active/2026-05-29-wiseeff-m5-2-staging-pilot-evidence-execution.md docs/exec-plans/completed/2026-05-29-wiseeff-m5-2-staging-pilot-evidence-execution.md
```

Expected:

- `docs:check` still passes because no non-roadmap active plan is left without governance sections.

- [ ] **Step 4: Commit**

Run:

```bash
git add docs
git commit -m "docs: record M5.2 staging pilot evidence"
```

Expected:

- One commit records the M5.2 evidence and documentation updates.

## Documentation Impact Matrix

| Category | Decision | Files |
| --- | --- | --- |
| Repository maps | Review | `AGENTS.md`, `README.md`, `ARCHITECTURE.md`, `docs/README.md` |
| Planning | Update | `docs/PLANS.md`, `docs/exec-plans/active/development-roadmap.md`, this plan, `docs/exec-plans/tech-debt-tracker.md` |
| Product | No change | `docs/product-specs/index.md`, `docs/product-specs/product-spec.md`, `docs/product-specs/prototype-functional-spec.md`, `docs/product-specs/mvp-scope.md`, `docs/product-specs/new-user-onboarding.md` |
| Architecture | Review | `docs/design-docs/index.md`, `docs/design-docs/full-stack-architecture.md`, `docs/design-docs/domain-model.md`, `docs/design-docs/api-contract.md`, `docs/design-docs/deployment-operations.md` |
| Quality and operations | Update | `docs/QUALITY_SCORE.md`, `docs/design-docs/testing-strategy.md`, `docs/RELIABILITY.md`, `docs/runbooks/m5-commercial-pilot-readiness.md` |
| Security and governance | Review | `docs/SECURITY.md`, `docs/design-docs/security-governance.md` |
| Frontend and design | Review | `docs/FRONTEND.md`, `docs/DESIGN.md` only if API-mode staging evidence changes frontend guidance |
| Generated artifacts | Update | `docs/generated/m5-pilot-acceptance.md`; review `docs/generated/db-schema.md`, `docs/generated/openapi.json`, `docs/generated/documentation-governance-audit.md` |
| References | Review | `docs/references/*` only if runtime/tooling assumptions change during execution |

## Documentation Update Gate

- Evidence docs must be updated in the same PR as the M5.2 execution results.
- No external checklist item may be checked unless the command or target-environment evidence was actually run.
- If any gate is skipped, the skip reason must be recorded in `docs/generated/m5-pilot-acceptance.md`.
- TD-019 remains open unless staging live API, staging PostgreSQL-backed E2E, HDC device-lab, backup/restore, rollback, and live provider evidence are all recorded.
- Completed M5.2 plan moves from `docs/exec-plans/active/` to `docs/exec-plans/completed/`.
- `npm run docs:check`, `npm run contract:check`, `npm run build`, and `git diff --check` must pass before this plan is marked complete.

## Expected Outcome

After M5.2:

- WiseEff has a recorded staging pilot evidence packet for the M0-M5 baseline.
- The project can honestly state whether the staging environment is pilot-ready.
- If pilot-ready, TD-019 is closed with evidence; if not, TD-019 lists the exact remaining external blockers.
- M6 can begin as production hardening with a clean boundary: enterprise identity, durable queue, cloud IaC, observability, capacity testing, and broader rollout controls.
