# WiseEff M5.2 Non-HDC Target Evidence Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Behavior-changing fixes discovered during execution must follow `superpowers:test-driven-development`: write a failing test first, verify the failure, implement the smallest fix, then verify green.

**Goal:** Close every M5.2 target-environment evidence gate except real HDC device-lab evidence, and record the remaining HDC gap honestly.

**Architecture:** This is a non-HDC evidence-closure slice on top of the merged M0-M5.2 baseline. It keeps `docs/generated/m5-pilot-acceptance.md` as the evidence ledger, uses `/health/live`, `/health/ready`, `/api/v1/operations/pilot-readiness`, and smoke scripts as runtime gates, and adds a non-HDC smoke mode that accepts `deviceGateway` as the only remaining blocked gate. It must not claim full `pilot_ready`, close TD-019, or check HDC/device-lab checklist items.

**Tech Stack:** GitHub PR workflow, Node.js/npm, TypeScript, Vite/React, Playwright, Vitest, PostgreSQL, node-postgres, S3/OSS-compatible object-store seam, live Agent provider seam, M5 smoke scripts, Markdown evidence docs.

---

## Scope Boundary

This plan includes:

- Preparing a target non-customer staging environment without HDC hardware.
- Running external/staging PostgreSQL migrations, seed or governed data setup, API-mode E2E, live API smoke, worker/object-store readiness, live Agent provider health, backup/restore drill, rollback rehearsal, and documentation evidence capture.
- Adding one small tested smoke-script capability if needed: a non-HDC target evidence mode that passes only when `deviceGateway` is the sole blocked pilot-readiness gate.
- Updating docs to show that non-HDC target evidence is closed and HDC device-lab evidence remains open.

This plan excludes:

- Real HDC device-lab target detection/read/write/readback/rollback evidence.
- Closing TD-019 while HDC device-lab evidence remains missing.
- Claiming `pilot_ready` from `/api/v1/operations/pilot-readiness` unless HDC evidence is later provided.
- Enterprise SSO/OIDC, Redis/BullMQ, cloud IaC, observability dashboards, alert routing, capacity testing, and provider prompt optimization.

## Execution Status

Current execution attempts:

- 2026-05-29 on branch `codex/m5-2-non-hdc-evidence-closure`, commit `5018764`.
- 2026-05-30 on branch `codex/manual-acceptance-guide`, commit `bd583cf3a80f98b1487f88f91f2bafdb5b2bf574`, after `.env` was completed for local non-HDC validation.

Completed locally after `.env` was populated:

- Verified `.env` has local PostgreSQL, API URL, production-mode HMAC auth, smoke authorization, local object-store settings, OpenAI-compatible live Agent provider settings, simulator gateway policy, and local backup/restore directories.
- Ran repository gates: `npm run test:all` with `VITE_WISEEFF_RUNTIME_MODE=mock`, `npm run docs:check`, `npm run contract:check`, `npm run build`, and `git diff --check`.
- Ran database setup: `npm run db:migrate`, `npm run db:seed:m0`, `npm run db:seed:m1`, `npm run db:seed:m2`, and `npm run db:seed:m3`.
- Ran standard local API-mode M1-M4 E2E with the populated database/object-store settings and development-auth validation mode: 6 passed, 1 HDC device-lab test skipped.
- Verified production auth behavior: `/api/v1/me` accepts the signed smoke token and rejects missing bearer auth; the 2026-05-30 local production-auth API-mode E2E passed after the frontend HTTP clients and direct E2E API assertions used the configured smoke bearer authorization.
- Verified local `/health/ready` with database, local object store, worker queue, and live Agent provider health all ready.
- Verified live Agent chat through the OpenAI-compatible provider after increasing `AGENT_API_TIMEOUT_MS` to 30000 for the local API process; the trace recorded live provider, token usage, safe status, and no fallback.
- Ran a local PostgreSQL custom dump and restore drill through the `wiseeff-postgres` Docker container into a temporary restore database, validated restored table counts, then dropped the temporary database.
- Copied the local object-store directory through `.wiseeff-backups/` and `.wiseeff-restore/`.
- With `M5_BACKUP_RESTORE_DRILL_AT` set on the local API process, `/api/v1/operations/pilot-readiness` was blocked only by `deviceGateway`.
- On 2026-05-30, reran local DB setup with the completed `.env`: `npm run db:migrate`, `npm run db:seed:m0`, `npm run db:seed:m1`, `npm run db:seed:m2`, and `npm run db:seed:m3` all passed.
- On 2026-05-30, `npm run smoke:m5 -- --allow-only-blocked=deviceGateway` passed against the local live API runtime; database, local object store, worker queue, live Agent provider, auth, contract, and backup gates were ready, and only `deviceGateway` remained blocked.
- On 2026-05-30, focused live API preflight passed with `npx tsx -- scripts/run-acceptance-preflight.ts --no-start-runtime --skip-gates --skip-frontend --evidence-out test-results/acceptance/live-api-preflight-evidence.md`.
- On 2026-05-30, `npm run acceptance:browser` passed in local non-HDC mode: 16 passed and 1 HDC device-lab test skipped. This deterministic-Agent browser suite records stable UI workflow evidence, while live Agent readiness remains covered by smoke/preflight.
- On 2026-05-30, production-auth API-mode E2E passed locally with `VITE_WISEEFF_API_AUTHORIZATION` and `AGENT_PROVIDER=deterministic`: 6 passed and 1 HDC device-lab test skipped.
- On 2026-06-02, after PR #52 merged, latest `main` was revalidated locally on branch `codex/m5-2-remaining-evidence-closure`: `npm run docs:check`, `npm run contract:check`, `npm run acceptance:ci`, `npm run acceptance:models`, `npm run acceptance:quality`, `npm run build`, `npm run acceptance:browser -- --mode=local-non-hdc`, `npm run acceptance:evidence`, and `git diff --check` passed. Browser acceptance reported 33 passed and 1 HDC device-lab test skipped. A temporary local API on `127.0.0.1:8877` used the completed `.env` live Agent provider configuration; `npm run smoke:m5` passed with `npm_config_allow_only_blocked=deviceGateway`, leaving only `deviceGateway` blocked.

Still open:

- HDC device-lab evidence is not available because `HDC_DEVICE_LAB_AVAILABLE` and `HDC_SMOKE_*` are not configured.
- Strict `npm run smoke:m5` still fails because pilot readiness requires HDC device-gateway evidence.
- Deployment rollback rehearsal is not complete; local backup/restore does not replace platform rollback evidence.
- Target-environment evidence is still missing: deployed staging API/web/worker, target PostgreSQL, cloud or approved target object storage, target backup/restore, target rollback, and target identity/user provisioning.
- Dynamic production identity is not complete; local production-auth E2E now uses a static smoke bearer token, while target environments still need provisioned users or an OIDC/SSO-backed token lifecycle.

Completion decision, 2026-06-02: keep this plan in `docs/exec-plans/active/`. The local non-HDC evidence is current on latest `main`, but the plan goal is target-environment closure; target deployment, target backup/restore, and deployment rollback evidence have not been captured.

## Required External Inputs From The User

Please provide these before execution. Secrets must be supplied locally or through your secret manager, not committed.

### Staging Runtime

- Staging API URL: `WISEEFF_API_BASE_URL` or `VITE_WISEEFF_API_BASE_URL`.
- Staging frontend URL, if UI smoke should hit deployed web instead of local Vite.
- Deployment method and operator command for API, worker, and web, for example platform dashboard steps or CLI commands.
- Confirmation that this is a non-customer staging environment if simulator device mode is used.

### Database

- Staging PostgreSQL `DATABASE_URL`.
- Permission to run migrations through `0010_m5_agent_provider_traces.sql`.
- Decision on data policy:
  - use seed data with `npm run db:seed:m0`, `npm run db:seed:m1`, `npm run db:seed:m2`, `npm run db:seed:m3`, or
  - use governed pilot data and skip seed scripts.

### Production-Mode Auth

- `AUTH_TOKEN_ISSUER`.
- `AUTH_TOKEN_HMAC_SECRET` with at least 32 characters.
- A signed admin bearer token for smoke tests, or permission to generate one from the issuer/secret.
- The admin identity must include `admin:access` plus workflow permissions needed by API-mode E2E.

### Object Storage

- `OBJECT_STORE_MODE=s3`.
- `OBJECT_STORAGE_ENDPOINT`.
- `OBJECT_STORAGE_BUCKET`.
- `OBJECT_STORAGE_ACCESS_KEY_ID`.
- `OBJECT_STORAGE_SECRET_ACCESS_KEY`.
- `OBJECT_STORAGE_REGION`, if required by the provider.
- Permission for the API/worker readiness probe to write/read/delete a small health object.

### Worker

- The staging worker start command or process manager name.
- Confirmation that the worker uses the same `DATABASE_URL` and object-store settings as the API.
- Worker logs location or command for evidence capture.

### Live Agent Provider

- `AGENT_PROVIDER=live`.
- `AGENT_MODEL`.
- `AGENT_API_KEY`.
- `AGENT_API_BASE_URL`.
- `AGENT_API_TIMEOUT_MS`, if different from 30000.
- Provider health endpoint behavior and a safe outage/degraded-mode simulation window, if outage evidence is required.

### Non-HDC Device Gateway Policy

- Either run `NODE_ENV=production`, `DEBUG_DEVICE_GATEWAY_MODE=simulator`, and `DEVICE_GATEWAY_ALLOW_SIMULATOR_IN_PRODUCTION=true` in a non-customer staging environment, or use a non-production staging `NODE_ENV` that still enables production-mode auth/object-store/Agent settings.
- Do not provide `M5_DEVICE_GATEWAY_EVIDENCE` for this plan unless you want to intentionally mark device gateway evidence as complete. Without real HDC evidence, that variable should remain unset.

### Backup, Restore, And Rollback

- Backup mechanism for PostgreSQL.
- Backup mechanism for object storage.
- Restore target environment or database/object-store namespace.
- Approved rollback rehearsal window.
- Timestamp to set as `M5_BACKUP_RESTORE_DRILL_AT` only after the drill actually passes.
- Rollback method: previous deployment artifact, traffic removal, database/object-store restore, or equivalent platform process.

## Success Criteria

- `npm run docs:check`, `npm run contract:check`, `npm run test:all`, `npm run build`, and `git diff --check` pass.
- Target PostgreSQL migrations pass against the staging database.
- API and worker start against staging PostgreSQL and S3/OSS-compatible object storage.
- `/health/live` returns 200.
- `/health/ready` returns ready with database, object-store, worker, and Agent provider ready.
- The non-HDC smoke verifies `/api/v1/operations/pilot-readiness` is blocked only by `deviceGateway`.
- API-mode Playwright E2E passes for parameter management, log analysis, and Agent flows against the target environment.
- Debugging simulator evidence may pass in non-customer staging, but HDC device-lab evidence remains explicitly unchecked.
- Backup/restore and rollback rehearsal evidence is recorded.
- `docs/generated/m5-pilot-acceptance.md`, `docs/runbooks/m5-commercial-pilot-readiness.md`, `docs/QUALITY_SCORE.md`, and `docs/exec-plans/tech-debt-tracker.md` distinguish non-HDC evidence completion from full pilot readiness.

## Evidence Capture Rules

- Record exact command, timestamp with timezone, branch, commit SHA, and environment label.
- Redact URLs, tokens, secrets, bucket credentials, and any customer data.
- Record only evidence that was actually run.
- If a command fails, record the failure reason and leave the corresponding checklist item unchecked.
- Keep `Device-lab HDC smoke was run in this environment` unchecked.
- Keep TD-019 open until HDC device-lab evidence is later captured.

## File Structure

Modify:

- `scripts/run-m5-smoke.shared.ts`: add helper logic for allowed pilot-readiness blocked gates if needed.
- `scripts/run-m5-smoke.ts`: add a `--allow-only-blocked=deviceGateway` or equivalent non-HDC mode if needed.
- `scripts/run-m5-smoke.test.ts`: cover default strict smoke, no-API skip behavior, and non-HDC blocked-gate acceptance.
- `docs/PLANS.md`: list this plan while active.
- `docs/generated/m5-pilot-acceptance.md`: record non-HDC target evidence.
- `docs/runbooks/m5-commercial-pilot-readiness.md`: update Go/No-Go notes and keep HDC unchecked.
- `docs/QUALITY_SCORE.md`: update production/pilot evidence only for completed non-HDC gates.
- `docs/exec-plans/tech-debt-tracker.md`: update TD-019 with completed non-HDC gates and remaining HDC gap.

Review:

- `ARCHITECTURE.md`
- `docs/RELIABILITY.md`
- `docs/SECURITY.md`
- `docs/design-docs/deployment-operations.md`
- `docs/design-docs/testing-strategy.md`
- `docs/generated/documentation-governance-audit.md`
- `docs/FRONTEND.md`
- `docs/DESIGN.md`
- `docs/references/*`

Do not commit:

- `.env.staging.local`
- secret exports
- raw logs containing tokens
- customer data
- backup archives
- restored database dumps

## Task 1: Confirm Baseline And Create Local Secret Inventory

**Files:**
- Modify: `.env.staging.local` locally only, not committed
- Modify: this plan only if actual environment choices differ

- [ ] **Step 1: Confirm branch and clean worktree**

Run:

```bash
git fetch origin main --prune
git switch -c codex/m5-2-non-hdc-evidence-closure origin/main
git status --short --branch
```

Expected:

- The branch is `codex/m5-2-non-hdc-evidence-closure`.
- The worktree is clean.
- If the branch already exists, switch to it and fast-forward or rebase onto `origin/main` before continuing.

- [ ] **Step 2: Create `.env.staging.local` outside git**

Create this local-only file with real values:

```bash
NODE_ENV=production
DATABASE_URL=<staging-postgres-url>
AUTH_MODE=production
AUTH_TOKEN_ISSUER=<issuer>
AUTH_TOKEN_HMAC_SECRET=<secret-at-least-32-chars>
OBJECT_STORE_MODE=s3
OBJECT_STORAGE_ENDPOINT=<endpoint>
OBJECT_STORAGE_BUCKET=<bucket>
OBJECT_STORAGE_ACCESS_KEY_ID=<access-key>
OBJECT_STORAGE_SECRET_ACCESS_KEY=<secret-key>
OBJECT_STORAGE_REGION=<region-if-needed>
DEBUG_DEVICE_GATEWAY_MODE=simulator
DEVICE_GATEWAY_ALLOW_SIMULATOR_IN_PRODUCTION=true
AGENT_PROVIDER=live
AGENT_MODEL=<model>
AGENT_API_KEY=<agent-key>
AGENT_API_BASE_URL=<agent-base-url>
AGENT_API_TIMEOUT_MS=30000
WISEEFF_API_BASE_URL=<staging-api-url>
M5_CONTRACT_CHECK_PASSED=true
```

Expected:

- `git status --short` does not show `.env.staging.local`.
- The environment is explicitly approved as non-customer staging because simulator mode is allowed in production config only with `DEVICE_GATEWAY_ALLOW_SIMULATOR_IN_PRODUCTION=true`.

- [ ] **Step 3: Generate or obtain an admin smoke token**

Use the HMAC format in `docs/SECURITY.md`. The payload must include:

```json
{
  "iss": "<AUTH_TOKEN_ISSUER>",
  "sub": "staging-admin",
  "org": "org-chargelab",
  "name": "Staging Admin",
  "email": "staging-admin@example.invalid",
  "roles": [{ "roleId": "admin", "projectId": null }],
  "permissions": [
    "parameter:view",
    "parameter:edit",
    "debugging:use",
    "debugging:view",
    "debugging:read",
    "debugging:write",
    "debugging:rollback",
    "debugging:admin",
    "logs:view",
    "logs:upload",
    "logs:analyze",
    "logs:archive",
    "logs:feedback",
    "parameter:review",
    "admin:access",
    "users:manage"
  ],
  "exp": 9999999999
}
```

Set locally:

```bash
M5_SMOKE_AUTHORIZATION="Bearer <signed-admin-token>"
WISEEFF_SMOKE_AUTHORIZATION="Bearer <signed-admin-token>"
```

Expected:

- The token is not committed.
- `GET /api/v1/me` against staging returns the signed admin identity.

## Task 2: Add Non-HDC Smoke Acceptance Mode If Needed

**Files:**
- Modify: `scripts/run-m5-smoke.shared.ts`
- Modify: `scripts/run-m5-smoke.ts`
- Test: `scripts/run-m5-smoke.test.ts`

- [ ] **Step 1: Write failing tests for allowed blocked gates**

Add tests like:

```ts
import { describe, expect, it } from "vitest";
import { canAcceptPilotReadiness, parseAllowedBlockedGates } from "./run-m5-smoke.shared";

describe("M5 non-HDC smoke helpers", () => {
  it("parses allowed blocked gate names from argv", () => {
    expect(parseAllowedBlockedGates(["--allow-only-blocked=deviceGateway"])).toEqual(["deviceGateway"]);
  });

  it("accepts blocked pilot readiness only when exactly the allowed gate is blocked", () => {
    expect(
      canAcceptPilotReadiness(
        { ok: false, status: "blocked", blockedBy: ["deviceGateway"] },
        ["deviceGateway"]
      )
    ).toBe(true);
  });

  it("rejects blocked pilot readiness when another gate is blocked", () => {
    expect(
      canAcceptPilotReadiness(
        { ok: false, status: "blocked", blockedBy: ["deviceGateway", "agentProvider"] },
        ["deviceGateway"]
      )
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Verify the tests fail**

Run:

```bash
npm test -- scripts/run-m5-smoke.test.ts -t "non-HDC smoke helpers"
```

Expected:

- The tests fail because `parseAllowedBlockedGates` and `canAcceptPilotReadiness` do not exist yet.

- [ ] **Step 3: Implement the smallest helper logic**

Add helper functions to `scripts/run-m5-smoke.shared.ts`:

```ts
export type PilotReadinessBody = {
  ok?: unknown;
  status?: unknown;
  blockedBy?: unknown;
};

export function parseAllowedBlockedGates(argv: readonly string[]) {
  const prefix = "--allow-only-blocked=";
  const arg = argv.find((item) => item.startsWith(prefix));
  if (!arg) return [];
  return arg
    .slice(prefix.length)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function canAcceptPilotReadiness(body: PilotReadinessBody, allowedBlockedGates: readonly string[]) {
  if (body.ok === true && body.status === "pilot_ready") {
    return true;
  }

  if (body.ok !== false || body.status !== "blocked" || !Array.isArray(body.blockedBy)) {
    return false;
  }

  const blockedBy = body.blockedBy.filter((item): item is string => typeof item === "string").sort();
  const allowed = [...allowedBlockedGates].sort();
  return blockedBy.length === allowed.length && blockedBy.every((gate, index) => gate === allowed[index]);
}
```

Update `scripts/run-m5-smoke.ts` so the pilot-readiness check uses `parseAllowedBlockedGates(process.argv.slice(2))` and accepts the body only when `canAcceptPilotReadiness(...)` is true. If accepted because only `deviceGateway` is blocked, print a clear message such as:

```text
M5 smoke passed with allowed blocked gates: deviceGateway.
```

- [ ] **Step 4: Verify helper tests pass**

Run:

```bash
npm test -- scripts/run-m5-smoke.test.ts
```

Expected:

- All smoke helper tests pass.

- [ ] **Step 5: Verify strict smoke behavior is still protected**

Run without live API:

```bash
npm run smoke:m5
```

Expected:

- It still fails when `WISEEFF_API_BASE_URL` is missing and `M5_SMOKE_ALLOW_NO_API=true` is not set.

## Task 3: Deploy And Verify Target Runtime Without HDC

**Files:**
- Modify: `docs/generated/m5-pilot-acceptance.md`
- Modify: `docs/runbooks/m5-commercial-pilot-readiness.md`

- [ ] **Step 1: Run target migrations**

With staging env loaded:

```bash
npm run db:migrate
```

Expected:

- Migrations through `0010_m5_agent_provider_traces.sql` are applied or already current.
- Re-running the command is safe.

- [ ] **Step 2: Seed or document governed data**

If non-customer staging data is allowed:

```bash
npm run db:seed:m0
npm run db:seed:m1
npm run db:seed:m2
npm run db:seed:m3
```

If governed data is used, do not run seed scripts. Record the data policy in `docs/generated/m5-pilot-acceptance.md`.

Expected:

- E2E has the data it requires, or the evidence doc explains why governed data was used.

- [ ] **Step 3: Deploy API, worker, and web**

Use the operator-provided deployment method. Minimum runtime env:

```bash
NODE_ENV=production
AUTH_MODE=production
DATABASE_URL=<staging-postgres-url>
OBJECT_STORE_MODE=s3
DEBUG_DEVICE_GATEWAY_MODE=simulator
DEVICE_GATEWAY_ALLOW_SIMULATOR_IN_PRODUCTION=true
AGENT_PROVIDER=live
```

Expected:

- API starts without production config errors.
- Worker starts with the same database and object-storage settings.
- Web runs in API mode against staging API.

- [ ] **Step 4: Probe health endpoints**

Run:

```bash
npm run contract:check
npm run smoke:m5 -- --allow-only-blocked=deviceGateway
```

Expected:

- Contract check passes.
- `/health/live` returns 200.
- `/health/ready` is ready.
- `/api/v1/operations/pilot-readiness` returns `blocked` with only `deviceGateway` in `blockedBy`.

## Task 4: Run Non-HDC Target E2E

**Files:**
- Modify: `docs/generated/m5-pilot-acceptance.md`
- Modify: `docs/QUALITY_SCORE.md`

- [ ] **Step 1: Run API-mode E2E excluding HDC device-lab**

Run with staging env loaded:

```bash
npm run test:e2e -- e2e/parameter-management.api.spec.ts e2e/log-analysis.api.spec.ts e2e/agent.api.spec.ts
```

Expected:

- Parameter management E2E passes.
- Log analysis E2E passes and proves worker/object storage can process uploaded logs.
- Agent E2E passes with live provider configured, or any deterministic-only limitation is recorded as a blocker.

- [ ] **Step 2: Run debugging simulator E2E only if non-customer staging policy allows it**

Run:

```bash
DEBUG_DEVICE_GATEWAY_MODE=simulator npm run test:e2e -- e2e/debugging.api.spec.ts
```

Expected:

- Simulator portion passes.
- HDC device-lab smoke remains skipped or explicitly not run.
- Evidence is recorded as simulator-only, not HDC evidence.

- [ ] **Step 3: Record E2E evidence**

Append to `docs/generated/m5-pilot-acceptance.md`:

```markdown
### Non-HDC Target API-Mode E2E Evidence

Date: <timestamp>
Environment: <staging-label>
Commit: <sha>

- Parameter API-mode E2E: passed.
- Log API-mode E2E: passed.
- Agent API-mode E2E: passed.
- Debugging simulator E2E: passed or skipped; not HDC evidence.
- HDC device-lab E2E: not run.
```

## Task 5: Execute Backup/Restore And Rollback Rehearsal

**Files:**
- Modify: `docs/generated/m5-pilot-acceptance.md`
- Modify: `docs/runbooks/m5-commercial-pilot-readiness.md`
- Modify: `docs/exec-plans/tech-debt-tracker.md`

- [ ] **Step 1: Take a target backup**

Run the operator-approved database and object-store backup commands. Record:

```markdown
- Backup started: <timestamp>
- Backup completed: <timestamp>
- Database backup target: <redacted location or internal label>
- Object-store backup target: <redacted location or internal label>
```

Expected:

- Backup artifacts exist in the approved backup target.
- No backup archive is committed.

- [ ] **Step 2: Restore to a clean target**

Restore database and object storage to the approved restore environment. Then run:

```bash
npm run smoke:m5 -- --allow-only-blocked=deviceGateway
```

Expected:

- Restored API answers health checks.
- Non-HDC smoke passes with only `deviceGateway` blocked.

- [ ] **Step 3: Record restore drill timestamp**

Set locally and in the target runtime after the restore drill passes:

```bash
M5_BACKUP_RESTORE_DRILL_AT=<timestamp>
```

Expected:

- `pilot-readiness.gates.backups.status` becomes `ready`.
- The evidence file records the restore target and validation commands.

- [ ] **Step 4: Rehearse deployment rollback**

Use the operator-approved rollback path:

1. Stop new writes.
2. Drain or stop the worker.
3. Remove staging traffic from the candidate deployment.
4. Restore previous API/web artifact or previous environment revision.
5. Re-run:

```bash
npm run smoke:m5 -- --allow-only-blocked=deviceGateway
```

Expected:

- Rollback smoke passes with only `deviceGateway` blocked.
- The evidence doc records trigger, sequence, timestamp, and post-rollback smoke result.

## Task 6: Update Docs And Technical Debt Honestly

**Files:**
- Modify: `docs/PLANS.md`
- Modify: `docs/exec-plans/active/development-roadmap.md`
- Modify: `docs/generated/m5-pilot-acceptance.md`
- Modify: `docs/runbooks/m5-commercial-pilot-readiness.md`
- Modify: `docs/QUALITY_SCORE.md`
- Modify: `docs/exec-plans/tech-debt-tracker.md`
- Review: `ARCHITECTURE.md`, `docs/RELIABILITY.md`, `docs/SECURITY.md`, `docs/design-docs/deployment-operations.md`, `docs/design-docs/testing-strategy.md`

- [ ] **Step 1: Update acceptance evidence**

Mark only completed non-HDC items. Keep unchecked:

```markdown
- [ ] Device-lab HDC smoke was run in this environment.
```

Expected:

- Evidence says non-HDC target evidence is complete.
- Evidence says HDC is still missing.
- No sentence claims full pilot readiness.

- [ ] **Step 2: Update TD-019**

Update `docs/exec-plans/tech-debt-tracker.md` so TD-019 says:

- live API, staging PostgreSQL-backed E2E, worker/object-store, live Agent provider, backup/restore, and rollback evidence are complete if the evidence exists;
- HDC device-lab evidence remains open;
- TD-019 remains open.

- [ ] **Step 3: Update quality score**

Raise or annotate `Production/pilot evidence` only if external non-HDC evidence exists. Do not score it as full pilot-ready while HDC remains missing.

- [ ] **Step 4: Update runbook Go/No-Go**

Update `docs/runbooks/m5-commercial-pilot-readiness.md`:

- Check non-HDC items that passed.
- Keep device-lab smoke unchecked.
- State that full Go remains blocked by HDC evidence.

## Task 7: Final Verification And PR

**Files:**
- Review all modified files

- [ ] **Step 1: Run final verification**

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
- Existing Vite chunk-size warning is acceptable.

- [ ] **Step 2: Run target non-HDC smoke**

Run with staging env loaded:

```bash
npm run smoke:m5 -- --allow-only-blocked=deviceGateway
```

Expected:

- The command passes only if `/health/ready` is ready and `/api/v1/operations/pilot-readiness` is blocked only by `deviceGateway`.

- [ ] **Step 3: Check stale claims**

Run:

```bash
rg -n "pilot_ready|TD-019|Device-lab HDC smoke|Backup/restore drill|Staging pilot smoke|allow-only-blocked|deviceGateway" docs/generated/m5-pilot-acceptance.md docs/runbooks/m5-commercial-pilot-readiness.md docs/QUALITY_SCORE.md docs/exec-plans/tech-debt-tracker.md
```

Expected:

- `pilot_ready` appears only as an API status name or future condition, not as a claim that this non-HDC phase achieved full pilot readiness.
- HDC device-lab remains the explicit unresolved blocker.

- [ ] **Step 4: Commit and create PR**

Run:

```bash
git add scripts/run-m5-smoke.shared.ts scripts/run-m5-smoke.ts scripts/run-m5-smoke.test.ts docs/PLANS.md docs/exec-plans/active/development-roadmap.md docs/generated/m5-pilot-acceptance.md docs/runbooks/m5-commercial-pilot-readiness.md docs/QUALITY_SCORE.md docs/exec-plans/tech-debt-tracker.md docs/exec-plans/active/2026-05-29-wiseeff-m5-2-non-hdc-target-evidence-closure.md
git commit -m "docs: plan M5.2 non-HDC evidence closure"
git push -u origin codex/m5-2-non-hdc-evidence-closure
gh pr create --base main --head codex/m5-2-non-hdc-evidence-closure --title "Plan M5.2 non-HDC evidence closure" --body "<summary and verification>"
```

Expected:

- PR is open.
- PR body states that HDC evidence is excluded and remains open.

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

- Evidence docs must be updated in the same PR as non-HDC target evidence results.
- No checklist item may be checked unless the command or target-environment evidence was actually run.
- HDC device-lab evidence must remain unchecked and TD-019 must remain open unless real HDC evidence is later attached.
- If a gate is skipped, the skip reason must be recorded in `docs/generated/m5-pilot-acceptance.md`.
- This plan moves to `docs/exec-plans/completed/` only after non-HDC evidence is captured, docs are updated, and final verification passes.
- `npm run docs:check`, `npm run contract:check`, `npm run test:all`, `npm run build`, `git diff --check`, and target non-HDC smoke must pass before this plan is marked complete.

## Expected Outcome

After this plan:

- WiseEff has target-environment evidence for live API, staging PostgreSQL-backed E2E, worker/object-store, live Agent provider, backup/restore, and rollback rehearsal.
- The project can honestly state that all non-HDC M5.2 external gates are closed.
- The project cannot yet claim full pilot readiness because HDC device-lab evidence remains missing.
- M6 production hardening can begin in parallel with or after the remaining HDC-specific evidence work, depending on business priority.
