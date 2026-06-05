# WiseEff Manual Acceptance Guide

Date: 2026-05-30

This guide is the manual acceptance checklist for a full WiseEff review. It is written for a human reviewer who needs to validate the product experience, API-mode integration, operational gates, and remaining pilot-readiness blockers.

Use this guide together with:

- [M5 Commercial Pilot Readiness](m5-commercial-pilot-readiness.md)
- [Staging Deployment](staging-deployment.md)
- [Backup And Restore](backup-restore.md)
- [Rollback](rollback.md)
- [HDC Device Lab](hdc-device-lab.md)
- [Agent Provider](agent-provider.md)
- [M5 Pilot Acceptance Evidence](../generated/m5-pilot-acceptance.md)

## Acceptance Outcomes

Record one of these outcomes at the end of the review:

| Outcome | Meaning |
| --- | --- |
| Local manual acceptance passed | The app, local API, PostgreSQL, local object store, simulator gateway, and selected live Agent checks passed locally. This is useful development evidence, not staging signoff. |
| Non-HDC target acceptance passed | A target environment passed live API, PostgreSQL, worker/object-store, Agent, backup/restore, and rollback checks, with HDC explicitly excluded. Full pilot readiness remains blocked by HDC. |
| Full pilot-ready acceptance passed | All M5 gates passed in the target environment, including HDC device-lab, backup/restore, rollback, live Agent, and strict M5 smoke evidence. |
| No-Go | One or more blocking checks failed or were skipped without an approved exception. |

Do not mark full pilot-ready if any evidence comes only from mock runtime, local simulator checks, or `M5_SMOKE_ALLOW_NO_API=true`.

## Reviewer Record

Fill this section before starting:

| Field | Value |
| --- | --- |
| Reviewer |  |
| Date/time and timezone |  |
| Branch |  |
| Commit SHA |  |
| Environment label | local / staging / pilot |
| Frontend URL |  |
| API URL |  |
| Runtime mode | mock / api |
| Auth mode | development / production |
| Database | local PostgreSQL / staging PostgreSQL |
| Object store | local / S3-compatible / other |
| Device gateway | simulator / HDC |
| Agent provider | deterministic / live |
| Evidence location | `docs/generated/m5-pilot-acceptance.md` or external evidence link |

## Scope

This manual review covers:

- Repository and documentation gates.
- Runtime dependency readiness.
- Browser-based product workflows.
- Backend/API smoke checks.
- Operational gates for backup/restore, rollback, HDC, Agent provider, and M5 pilot readiness.
- Evidence capture and Go/No-Go judgment.

This review does not replace:

- Automated unit, integration, and Playwright gates.
- Security review for production credentials.
- Customer data governance approval.
- HDC hardware signoff when the device lab is not available.

## Pre-Flight Checklist

Steps through runtime health checks can be automated for local non-HDC acceptance:

```bash
npm run acceptance:preflight
```

This command loads `.env`, records branch/commit/worktree state, starts missing local API/frontend runtime services for localhost URLs and leaves them running for browser acceptance, runs the repository gates, checks the API health endpoints, verifies `/api/v1/me`, and accepts local non-HDC readiness when `deviceGateway` is the only blocker. When the script starts the local deterministic Agent provider, it may also accept `deviceGateway` plus `agentProvider`; target and full-pilot modes remain strict. Use `npm run acceptance:preflight -- --skip-gates` for a faster API-only rerun after the gates already passed.

Optional flags after `--`:

- `--skip-gates`: skip docs, contract, unit, build, and whitespace gates.
- `--skip-frontend`: skip the frontend URL check.
- `--no-start-runtime`: only probe already-running services; useful for staging or externally managed runtimes.
- `--require-pilot-ready`: fail unless pilot-readiness returns `pilot_ready`.
- `--evidence-out <path>`: write the generated preflight evidence markdown to a file.

The script also honors npm's `npm_config_*` flag mapping on Windows, so the same examples work when npm converts `--skip-gates` into `npm_config_skip_gates=true`.

### Repository State

Run:

```bash
git status --short --branch
git rev-parse HEAD
npm ci
```

Expected:

- Branch and commit match the release or acceptance candidate.
- The worktree state is understood and recorded.
- Dependency install succeeds. Non-fatal Node engine warnings may be recorded if they are already known for the local machine.

### Environment File

For local non-HDC acceptance:

```bash
copy .env.example .env
```

Then fill these blank live Agent values only if testing the live provider:

```text
AGENT_API_BASE_URL=
AGENT_MODEL=
AGENT_API_KEY=
```

For staging or pilot acceptance, use the target environment's secret manager or local-only `.env.staging.local`. Never commit secrets.

Required target inputs:

- `DATABASE_URL`
- `WISEEFF_API_BASE_URL`
- `AUTH_MODE=production`
- `AUTH_TOKEN_ISSUER`
- `AUTH_TOKEN_HMAC_SECRET`
- `M5_SMOKE_AUTHORIZATION` or `WISEEFF_SMOKE_AUTHORIZATION`
- object-storage endpoint, bucket, access key, and secret when `OBJECT_STORE_MODE=s3`
- `AGENT_PROVIDER=live`, model, base URL, and API key when live Agent evidence is in scope
- HDC smoke variables when real device-lab evidence is in scope
- backup/restore target and rollback window

Expected:

- `.env` or `.env.staging.local` is not shown as a tracked change.
- Blank Agent provider fields are filled before live provider checks.
- `M5_BACKUP_RESTORE_DRILL_AT` is unset until a real restore drill passes.

### Database Setup

Run against the selected database:

```bash
npm run db:migrate
npm run db:seed:m0
npm run db:seed:m1
npm run db:seed:m2
npm run db:seed:m3
```

Expected:

- Migrations are current through `0010_m5_agent_provider_traces.sql`.
- Seed scripts pass in non-customer local or staging environments.
- If governed pilot data is used instead of seeds, record that decision and skip seed commands.

### Automated Gates

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
- Existing Vite chunk-size warning is acceptable if the build succeeds.

For M6.6 self-hosted release candidates, also run the release and capacity metadata gates:

```bash
npm run m6:target-plan --target-env-file=<target-env-file>
npm run identity:check
npm run observability:check
npm run observability:target-evidence -- --target-environment <label> --config-status passed --prometheus-target-scrape passed --alertmanager-routing passed --grafana-dashboard-import passed --prometheus-query 'up{job="wiseeff-api"} == 1' --alert-route-evidence <path-or-record> --grafana-evidence <path-or-record>
npm run rollback:rehearsal -- --environment <label> --release-version <version> --candidate-artifact <artifact> --previous-artifact <previous-artifact> --approval-owner <owner> --maintenance-window <window> --stop-writes passed --queue-drain passed --artifact-rollback passed --database-restore passed --object-store-restore passed --post-rollback-smoke passed --backup-evidence docs/generated/m6-backup-restore-evidence.md --smoke-evidence <path-or-record> --notes <path-or-record>
npm run capacity:gate -- --target-url https://<host> --environment <label> --k6-summary <path-or-record> --metrics-snapshot <path-or-record>
npm run selfhost:release-gate -- --target-environment <label> --artifact-ref <artifact> --env-fingerprint <sha256> --backup-evidence docs/generated/m6-backup-restore-evidence.md --identity-readiness passed --rollback-readiness passed --rollback-evidence docs/generated/m6-rollback-rehearsal-evidence.md --capacity-readiness passed --capacity-evidence docs/generated/capacity-gate.md --target-synthetic-readiness passed --target-synthetic-evidence <path-or-record> --queue-readiness passed --queue-evidence <path-or-record> --observability passed --observability-evidence <path-or-record>
npm run m6:target-evidence
```

`npm run m6:target-plan --target-env-file=<target-env-file>` writes `docs/generated/m6-target-evidence-plan.md`, a redacted operator manifest for the target evidence run. It is useful even when it reports `blocked`, because the blockers name the target inputs that must be supplied before evidence collection. If the specified target env file is missing, the command does not fall back to local `.env` target inputs. It is not a completion gate and cannot substitute for target OIDC, target user-governance operation evidence, restore, queue, observability, rollback, capacity, or synthetic evidence.

These commands may produce failed or pending evidence until real target OIDC identity evidence, a real target capacity run, rollback rehearsal, target synthetic acceptance, queue drain/pause/resume, and observability watch are attached. `npm run m6:target-evidence` writes `docs/generated/m6-target-evidence-summary.md` and must remain failed while any M6.2-M6.6 target evidence is missing.

## Start The Local Review Runtime

Use three terminals for local API-mode review.

Terminal 1:

```bash
npm run dev:api
```

Terminal 2:

```bash
npm run worker:logs
```

Terminal 3:

```bash
npm run dev
```

Open the Vite URL shown by the terminal, usually:

```text
http://127.0.0.1:5173/
```

Expected:

- API listens on `http://127.0.0.1:8787`.
- Worker starts without connection errors.
- Frontend opens and can reach the API when `VITE_WISEEFF_RUNTIME_MODE=api`.

## Runtime Health Checks

Manual PowerShell sessions do not automatically load `.env`. Load it into the current process before running direct API probes:

```powershell
Get-Content .env | Where-Object { $_ -and $_ -notmatch '^\s*#' -and $_ -match '=' } | ForEach-Object {
  $name, $value = $_ -split '=', 2
  [Environment]::SetEnvironmentVariable($name.Trim(), $value.Trim(), 'Process')
}

$env:WISEEFF_API_BASE_URL
```

The last command must print a URL such as `http://127.0.0.1:8787`. If it is blank, the health-check URLs will be invalid.

Run on PowerShell:

```powershell
$headers = @{ Authorization = $env:M5_SMOKE_AUTHORIZATION }

Invoke-RestMethod -Uri "$env:WISEEFF_API_BASE_URL/health/live"
Invoke-RestMethod -Uri "$env:WISEEFF_API_BASE_URL/health/ready"
Invoke-RestMethod -Headers $headers -Uri "$env:WISEEFF_API_BASE_URL/api/v1/me"
Invoke-RestMethod -Headers $headers -Uri "$env:WISEEFF_API_BASE_URL/api/v1/operations/pilot-readiness"
```

Alternatively, call the real Windows curl binary explicitly. In PowerShell, `curl` by itself is an alias for `Invoke-WebRequest`, so Unix flags such as `-fsS` and `-H "Header: value"` will not work unless you use `curl.exe`:

```powershell
curl.exe -fsS "$env:WISEEFF_API_BASE_URL/health/live"
curl.exe -fsS "$env:WISEEFF_API_BASE_URL/health/ready"
curl.exe -fsS -H "Authorization: $env:M5_SMOKE_AUTHORIZATION" "$env:WISEEFF_API_BASE_URL/api/v1/me"
curl.exe -fsS -H "Authorization: $env:M5_SMOKE_AUTHORIZATION" "$env:WISEEFF_API_BASE_URL/api/v1/operations/pilot-readiness"
```

Expected:

- `/health/live` succeeds.
- `/health/ready` reports database, object store, worker, and Agent provider status.
- `/api/v1/me` returns the expected admin identity in production-auth mode.
- `/api/v1/operations/pilot-readiness` returns either `pilot_ready` or an honest `blocked` response with actionable reasons.

For local non-HDC review, `deviceGateway` may remain the only blocked gate. If preflight auto-starts the local deterministic Agent provider, `agentProvider` may also remain blocked. Record that either case is local non-HDC evidence, not full pilot-ready evidence.

For strict target-environment pilot evidence, run:

```bash
npm run acceptance:preflight -- --require-pilot-ready
```

This fails if `/api/v1/operations/pilot-readiness` is not `pilot_ready`.

## Automated Browser Acceptance

The browser workflow section below can be exercised by the deterministic Playwright acceptance suite:

```bash
npm run acceptance:coverage
npm run acceptance:operations
npm run acceptance:models
npm run acceptance:browser
npm run acceptance:evidence
npm run acceptance:quality
npm run acceptance:a11y
npm run acceptance:visual
npm run acceptance:responsive
npm run acceptance:browser -- --mode target-non-hdc --no-start-runtime
npm run acceptance:browser -- --mode full-pilot --no-start-runtime
```

`npm run acceptance:models` is a deterministic state-model gate for the API/domain rules behind browser workflows. It uses fixed `fast-check` seeds and fails with a reproducible seed/path/step list when parameter review, log analysis, debugging rollback, or permission visibility invariants drift.

`npm run acceptance:browser` runs preflight, runs `npm run acceptance:e2e`, checks requirement-level coverage, checks operation-level evidence, and writes generated evidence to `docs/generated/acceptance-browser-evidence.md`. The evidence table maps directly to manual flows A-H and links to `playwright-report/acceptance/index.html`, `test-results/acceptance/results.json`, and `test-results/acceptance/`. Non-HDC modes require workflows A-E, G, and H to pass; HDC flow F may be skipped only when HDC is explicitly out of scope.

Requirement-level coverage is defined in `docs/developer/browser-acceptance-coverage-map.md`. Operation-level coverage is defined in `docs/developer/user-operation-coverage-matrix.md`. Missing required IDs, unknown `@acceptance` or `@operation` markers, missing required automated operation evidence, and operation evidence without role/route/assertion metadata are blockers. M5.10 also makes API, DB, and audit summaries blocking when the operation matrix declares those assertion types. The browser suite fails on unexpected page errors, console errors, request failures, and critical WiseEff API `4xx/5xx` responses, so a page that visually renders but logs an unauthorized API failure is not considered accepted.

M5.11 adds deterministic quality gates beside the workflow gate. Use `npm run acceptance:quality` after changing the quality scripts, Playwright quality config, or quality spec locations. Use `npm run acceptance:a11y` for page structure, dialog, form, navigation, label, heading, focus, or Agent panel changes. Use `npm run acceptance:visual` for CSS, layout, stable shell/page region, snapshot-mask, or visual hierarchy changes. Use `npm run acceptance:responsive` for table, toolbar, navigation, dialog, or viewport-dependent changes. Visual snapshots should be updated intentionally with `npm run acceptance:visual -- --update-snapshots`, then rerun without `--update-snapshots` before accepting the result.

M5.12 adds CI and target synthetic archiving for these gates. Pull requests and pushes run the GitHub Actions `acceptance-local-non-hdc` job, which provisions PostgreSQL, runs the state-model gate, quality gates, and local non-HDC browser acceptance, then uploads `wiseeff-acceptance-local-non-hdc`. Manual `workflow_dispatch` runs can choose `target-non-hdc` or `full-pilot`; these use `--no-start-runtime`, the provided target frontend URL, GitHub Secrets for target API/auth inputs, and upload `wiseeff-acceptance-<mode>`. Treat these artifacts as acceptance evidence attachments:

- `playwright-report/acceptance`
- `test-results/acceptance`
- `docs/generated/acceptance-browser-evidence.md`
- `docs/generated/acceptance-operation-evidence.md`
- `docs/generated/acceptance-operation-evidence/index.json`
- `playwright-report/quality`
- `test-results/quality`

`npm run acceptance:ci` is the local metadata guard for this workflow. It must pass after changing `.github/workflows/ci.yml` or CI artifact paths. Target synthetic runs test an already deployed target frontend; that frontend must already have the correct API base URL and production-auth bearer-token injection path configured by the deployment. PR artifacts prove local non-HDC readiness only. Full-pilot artifacts count only when the manual run is backed by real target environment secrets plus HDC, backup/restore, rollback, object-store, worker, and live Agent evidence.

M6.1 self-hosted runtime evidence is collected separately with `npm run selfhost:check` and `npm run selfhost:smoke -- --base-url <target-url>`. This proves the self-hosted services are reachable and production-shaped; it does not prove OIDC, durable queue, observability, rollback, capacity, or HDC readiness.

M6.2 local identity evidence is collected with `npm run acceptance:browser`, `npm run acceptance:evidence`, and `npm run identity:local-oidc-drill`. The local OIDC drill writes `docs/generated/m6-local-oidc-identity-evidence.md` and uses a temporary issuer/JWKS service plus signed RS256 tokens to prove the WiseEff OIDC verifier, `/api/v1/me`, negative token checks, and browser token-provider refresh/logout boundary without needing Keycloak. Target identity evidence is collected with `npm run identity:check` and written to `docs/generated/m6-identity-evidence.md`. Local non-HDC runs may use the deterministic HMAC smoke token, but target self-hosted acceptance must use real OIDC access tokens and redacted evidence for discovery/JWKS, issuer/audience/expiry negative checks, browser token refresh/logout behavior, `/api/v1/me`, and Admin user-governance mutation audit.

M6.3 storage and backup evidence is collected with:

```bash
npm run restore:drill
npm run backup:drill
npm run backup:check
```

Local M6.3 evidence proves evidence shape, redaction, failed-command handling, and restore-target safety. Target acceptance requires a real restore drill against isolated PostgreSQL and object-store targets.

M6.6 release evidence is collected with `npm run m6:target-plan --target-env-file=<target-env-file>`, `npm run selfhost:release-gate`, `npm run identity:check`, `npm run observability:check`, `npm run observability:target-evidence`, `npm run capacity:gate`, `npm run m6:target-evidence`, and [Self-Hosted Release And Rollback](release-rollback.md). A release candidate is not ready unless target OIDC identity evidence, target user-governance operation evidence, capacity metrics, target synthetic artifacts, rollback rehearsal, backup/restore, queue readiness, and observability snapshots are real target evidence. M6.2-M6.6 plans should remain in `docs/exec-plans/active/` until `npm run m6:target-evidence` passes and final verification has been recorded.

### Reviewing Operation Evidence

After `npm run acceptance:browser`, open `docs/generated/acceptance-operation-evidence.md` and `docs/generated/acceptance-operation-evidence/index.json`. Each automated operation should show a role, route, assertion types, status, artifact path, runtime, trace/report location, and reproduction steps. For operations with `api` assertions, verify that the record includes compact request/response summaries with method, path, status, and request ID when available. For operations with `db` assertions, verify the table, predicate, observed state, and row count summary. For operations with `audit` assertions, verify event ID, kind, action, target ID, and request or trace correlation when available. Treat missing P0/P1 automated operation evidence, evidence records without review metadata, missing required API/DB/audit summaries, or unredacted secrets as blocking acceptance failures.

Manual review is still required for ambiguous visual judgment, real HDC safety approval, backup/restore, rollback rehearsal, external evidence attachments, and any acceptance flow that is not yet represented in the generated browser evidence.

## Browser Workflow Acceptance

Prefer the automated browser acceptance command first, then use the in-app browser or another Chromium browser for any remaining manual judgment. Capture screenshots or notes for each failed item.

### A. Shell, Navigation, And Access

Open:

```text
/
```

Checklist:

- [ ] Homepage loads without blank areas or visible runtime errors.
- [ ] Side navigation exposes platform overview, parameter management, debugging, and log analysis groups.
- [ ] Project selector and role context are visible where expected.
- [ ] Navigation to `/parameters`, `/parameter-review`, `/parameter-admin`, `/logs`, `/log-admin`, `/debugging`, `/node-debugging`, `/debugging-admin`, and `/user-permissions` works.
- [ ] Pages that the current role cannot access show a controlled no-entry state rather than a crash.

Pass criteria:

- Core routes load.
- No console-breaking error is visible in the browser.
- The shell remains usable after route changes and page reloads.

### B. Parameter Management Loop

Open:

```text
/parameters?project=aurora
```

Checklist:

- [ ] Parameter table loads and contains `fast_charge_current_limit_ma`.
- [ ] Search and risk/module filters update the visible table.
- [ ] Open parameter detail for `fast_charge_current_limit_ma`.
- [ ] Detail dialog shows recent history and cross-project context.
- [ ] Add the parameter to a modification draft.
- [ ] Enter a safe target value and reason.
- [ ] Submit the draft into the current round.
- [ ] Submit the round with hardware MDE, software MDE, and software developer assignees.
- [ ] Open `/parameter-review`.
- [ ] Find the submitted request and advance it through hardware MDE, software MDE, and software developer merge.
- [ ] Return to `/parameters?project=aurora`, reload, and confirm the merged value persists.
- [ ] Open `/parameter-admin?audit=open` and confirm audit evidence is visible.

Pass criteria:

- Parameter change persists after reload.
- Review workflow advances step by step.
- Merge creates audit evidence.
- High-risk or write-like actions require explicit user confirmation or review.

### C. Parameter Admin Governance

Open:

```text
/parameter-admin
```

Checklist:

- [ ] Parameter library list and governance metrics load.
- [ ] Search, grouping, risk filter, and orphan/unused views behave consistently.
- [ ] Import/preview controls show validation and diff-style feedback.
- [ ] User permissions or governance entry points are reachable.
- [ ] Audit drawer opens from `?audit=open`.
- [ ] Deletion or cleanup actions require confirmation and provide undo or recovery feedback where implemented.

Pass criteria:

- Admin page supports scan, inspect, import preview, audit review, and governance operations without corrupting the current state.

### D. Log Analysis Loop

Open:

```text
/logs?project=aurora
```

Use fixtures:

```text
test-fixtures/logs/charging-foldback.log
test-fixtures/logs/unsupported.bin
```

Checklist:

- [ ] Upload `charging-foldback.log`.
- [ ] Enter the question `Why did fast charging fold back?`.
- [ ] Analysis progresses through staged status and reaches `Complete`.
- [ ] Conclusion mentions thermal/foldback evidence.
- [ ] Evidence card links to a raw log line and highlights the line.
- [ ] Open `/log-dashboard` and `/log-admin`.
- [ ] Find the uploaded log in admin view.
- [ ] Submit helpful feedback and verify feedback/audit evidence if available.
- [ ] Archive the log and confirm it disappears from the default `/logs` history.
- [ ] Upload `unsupported.bin`.
- [ ] Unsupported upload reaches `Failed` with a readable unsupported-format reason.

Pass criteria:

- Supported log reaches a complete result with evidence.
- Unsupported log fails cleanly with a user-readable reason.
- Admin feedback and archive actions are traceable.

### E. Debugging Simulator Loop

Open:

```text
/node-debugging?project=aurora
```

Checklist:

- [ ] `Aurora Simulator 1` is detected online.
- [ ] `Fast charge current` reads `3000`.
- [ ] Write a safe target value such as `3100`.
- [ ] Readback confirms the new value.
- [ ] `Cycle count` is displayed as read-only and cannot be written from the UI.
- [ ] Write `Readback mismatch probe` with value `2`.
- [ ] UI reports readback mismatch.
- [ ] Roll back the fast-charge snapshot through `/debugging` if surfaced; otherwise verify rollback through the backend API and record the UI gap.
- [ ] Reopen `/node-debugging?project=aurora` and confirm `Fast charge current` returns to `3000`.
- [ ] Confirm debugging write and rollback audit events are visible through `/parameter-admin?audit=open`.

Pass criteria:

- Simulator read/write/readback/mismatch/rollback behavior is safe and traceable.
- Read-only parameters cannot be written.
- Every successful write or rollback creates audit evidence.

### F. HDC Device-Lab Loop

Run only when real HDC hardware is connected and safe target values are approved.

Required variables:

```text
DEBUG_DEVICE_GATEWAY_MODE=hdc
HDC_DEVICE_LAB_AVAILABLE=true
HDC_SMOKE_PROJECT_ID=
HDC_SMOKE_DEVICE_ID=
HDC_SMOKE_TARGET_REF=
HDC_SMOKE_PARAMETER_ID=
HDC_SMOKE_NODE_PATH=
HDC_SMOKE_WRITE_VALUE=
HDC_SMOKE_EXPECT_READ_PATTERN=
```

Run:

```bash
npm run acceptance:e2e -- e2e/acceptance/hdc-device-lab.acceptance.spec.ts
```

Checklist:

- [ ] Target detection succeeds through HDC.
- [ ] Node read succeeds and returns the expected pattern if configured.
- [ ] Node write succeeds with readback.
- [ ] Snapshot rollback restores the previous value.
- [ ] Timeout/offline, stderr/nonzero, and readback mismatch behavior are either exercised or recorded as open device-lab evidence.

Pass criteria:

- HDC evidence is collected against real hardware.
- The written node is restored.
- No HDC checklist item is marked complete without real hardware evidence.

### G. Agent Collaboration Loop

Open:

```text
/parameters
```

Checklist:

- [ ] Open WiseAgent.
- [ ] Agent panel shows current business context.
- [ ] Trigger a read-only suggestion or summary action.
- [ ] Trigger an approval-required action such as parameter draft creation.
- [ ] Approval dialog appears before any write-like tool executes.
- [ ] Reject path leaves state unchanged.
- [ ] Approve path executes the tool and records trace/audit evidence.
- [ ] For live provider mode, verify provider trace includes provider name, model or prompt version, latency, token usage or equivalent metadata, safety status, and fallback reason when applicable.

Pass criteria:

- Agent can summarize or suggest from real context.
- Mutating tools require explicit approval.
- Provider and tool-call evidence is traceable.

### H. Permissions And User Governance

Open:

```text
/user-permissions
```

Checklist:

- [ ] User list loads.
- [ ] Role and activation state are visible.
- [ ] Role changes affect access to protected routes.
- [ ] Inactive users cannot perform protected actions.
- [ ] Admin state cannot be removed in a way that leaves the system without an active admin.
- [ ] Permission changes create audit evidence where available.

Pass criteria:

- Access control behaves consistently in UI and API mode.
- Privileged operations are not available to unauthorized roles.

## API And Smoke Acceptance

Run the focused API-mode gates after manual browser review:

```bash
npm run test:e2e -- e2e/parameter-management.api.spec.ts
npm run test:e2e -- e2e/log-analysis.api.spec.ts
npm run test:e2e -- e2e/debugging.api.spec.ts
npm run test:e2e -- e2e/agent.api.spec.ts
```

Then run:

```bash
npm run acceptance:browser
npm run acceptance:a11y
npm run acceptance:visual
npm run acceptance:responsive
npm run smoke:m5
```

Expected:

- E2E tests pass, except HDC-specific checks may be skipped only when HDC is explicitly out of scope.
- Accessibility, visual, and responsive quality gates pass for UI-facing acceptance candidates.
- Strict `npm run smoke:m5` passes only when the live API and all required pilot gates are ready.
- For non-HDC target acceptance, a dedicated non-HDC smoke mode may be used only if HDC is explicitly skipped or absent and the evidence documents that full pilot readiness is not claimed.

## Backup And Restore Acceptance

Follow [Backup And Restore](backup-restore.md).

Checklist:

- [ ] Database backup completed.
- [ ] Object-store backup or snapshot completed.
- [ ] `npm run restore:drill` passed before restore commands ran.
- [ ] Restore into a clean isolated environment completed.
- [ ] Restored API and worker start successfully.
- [ ] Restored environment passes health checks.
- [ ] `npm run smoke:m5` passes, or non-HDC smoke passes with only the approved HDC blocker.
- [ ] `npm run backup:drill` and `npm run backup:check` passed with redacted evidence.
- [ ] `M5_BACKUP_RESTORE_DRILL_AT` is set only after restore validation passes.
- [ ] Evidence is recorded in [M5 Pilot Acceptance Evidence](../generated/m5-pilot-acceptance.md).

Pass criteria:

- Restore is proven in a clean target.
- Data and object-store records needed by existing logs and audit history remain coherent.

## Rollback Acceptance

Follow [Rollback](rollback.md). For M6.6 self-hosted release candidates, follow [Self-Hosted Release And Rollback](release-rollback.md).

Checklist:

- [ ] Starting commit and candidate commit are recorded.
- [ ] Candidate deployment passes initial smoke.
- [ ] A safe rollback trigger is selected.
- [ ] New writes are stopped or blocked.
- [ ] Worker is drained or stopped.
- [ ] Traffic is removed from the candidate deployment.
- [ ] Previous API/web artifact is restored, or the approved platform rollback path is executed.
- [ ] Database/object-store restore is performed if data changed.
- [ ] Post-rollback smoke passes.
- [ ] Evidence is recorded in [M5 Pilot Acceptance Evidence](../generated/m5-pilot-acceptance.md).
- [ ] For M6.6 releases, evidence is also recorded in [M6 Release Readiness](../generated/m6-release-readiness.md) or the approved external release record.

Pass criteria:

- Operators can move from candidate deployment back to a known-good state.
- Readiness and audit behavior remain coherent after rollback.

## Evidence Capture Template

Append a section like this to [M5 Pilot Acceptance Evidence](../generated/m5-pilot-acceptance.md) or attach it to the external acceptance record:

```markdown
## Manual Acceptance Evidence

Date:
Reviewer:
Environment:
Branch:
Commit:
Frontend URL:
API URL:

### Commands

- `npm run docs:check`: pass/fail, timestamp
- `npm run contract:check`: pass/fail, timestamp
- `npm run test:all`: pass/fail, timestamp
- `npm run build`: pass/fail, timestamp
- `npm run smoke:m5`: pass/fail, timestamp

### Browser Workflows

- Shell/navigation:
- Parameter management:
- Parameter admin:
- Log analysis:
- Debugging simulator:
- HDC device lab:
- Agent:
- Permissions:

### Operations

- Health/readiness:
- Backup/restore:
- Rollback:
- M6 release gate:
- Capacity gate:
- Target synthetic acceptance:
- Queue drain/pause/resume:
- Observability release watch:
- Agent provider:
- Object storage:
- Worker:

### Blockers

- 

### Final Outcome

- Local manual acceptance passed / Non-HDC target acceptance passed / Full pilot-ready acceptance passed / No-Go
```

## Go / No-Go Rules

Mark **Go for local demo or development validation** only if:

- Local API-mode workflows pass.
- Local PostgreSQL and object-store behavior are verified.
- Simulator debugging is clearly labeled as simulator evidence.
- No severe browser workflow is broken.

Mark **Go for non-HDC target acceptance** only if:

- Target API, frontend, database, worker, object store, live Agent, backup/restore, and rollback evidence pass.
- HDC is the only remaining explicit blocker.
- The acceptance record states that full pilot readiness is not claimed.

Mark **Go for controlled self-hosted release candidate** only if:

- `npm run selfhost:smoke` passes against the deployed target.
- `npm run identity:check` passes against the target OIDC issuer and API, and the redacted identity evidence is attached.
- `npm run acceptance:browser -- --mode target-non-hdc --no-start-runtime` passes or full-pilot mode passes with real HDC evidence.
- `npm run capacity:gate` includes observed target metrics and meets thresholds.
- Backup/restore evidence and rollback rehearsal evidence are attached.
- Queue readiness and observability release-watch evidence are attached and referenced by `--queue-evidence` and `--observability-evidence`.
- Rollback, capacity, and target synthetic readiness are marked `passed` only when `--rollback-evidence`, `--capacity-evidence`, and `--target-synthetic-evidence` point to real target evidence.
- `npm run selfhost:release-gate` references the release version, commit, artifact, environment fingerprint, migration set, identity evidence, capacity evidence, rollback evidence, target synthetic evidence, queue evidence, and observability evidence.
- `npm run m6:target-evidence` passes and records that every M6.2-M6.6 phase has target evidence and is eligible to move to `docs/exec-plans/completed/`.

Mark **Go for full pilot-ready** only if:

- Strict `npm run smoke:m5` passes against the target live API.
- `/api/v1/operations/pilot-readiness` returns `status: "pilot_ready"`.
- HDC device-lab evidence is attached.
- Backup/restore evidence is attached.
- Rollback rehearsal evidence is attached.
- Live Agent provider evidence is attached.
- Object-store and worker readiness are proven in the target environment.
- [M5 Pilot Acceptance Evidence](../generated/m5-pilot-acceptance.md) is updated with actual evidence and no untrue checked items.

Mark **No-Go** if:

- Any core product workflow crashes or loses persisted state.
- Production-auth protected requests pass without a valid token.
- A mutating Agent or device action can execute without approval.
- Log upload or analysis cannot reach a terminal state.
- Debugging writes do not create snapshots or audit evidence.
- Restore or rollback cannot be demonstrated.
- Evidence is missing for a gate being claimed as complete.
- M6.6 identity, capacity, rollback, target synthetic, queue, or observability evidence is pending while the release is being claimed ready.

## Known Current Caveats

As of 2026-05-30, the docs still identify these important gaps:

- Full target-environment staging evidence is not complete.
- HDC device-lab evidence is missing unless a real lab run is performed during this acceptance.
- Deployment rollback rehearsal evidence is still required.
- Frontend production-auth API mode needs bearer-token injection before production-auth UI E2E can fully close.
- Cloud S3/OSS evidence is separate from local object-store evidence unless the acceptance explicitly approves local object storage for the target.
- M6.3 local backup evidence is not target restore evidence unless it was generated from a real isolated target restore drill.

Keep these caveats visible in the final acceptance record instead of smoothing them over. A clean No-Go with exact blockers is more useful than a vague Go.
