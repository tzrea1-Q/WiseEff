# Verification Matrix

> Chinese: [Chinese](../zh-CN/developer/verification-matrix.md)

Use the narrowest command that proves the change while developing. Before finishing, broaden to the gate that matches the risk and touched surface.

## Common Commands

| Command | Proves | Use when |
| --- | --- | --- |
| `npm test -- path/to/test.tsx` | Focused frontend behavior | Editing a component, page, domain helper, or frontend runtime. |
| `npm run test:server -- path/to/test.ts` | Focused backend behavior | Editing server modules, scripts, migrations helpers, or docs governance script. |
| `npm test` | Frontend/unit suite | Frontend-affecting changes. |
| `npm run test:server` | Backend/unit suite | Backend-affecting changes. |
| `npm run test:all` | Frontend plus backend unit suites | Shared contracts or broad behavior. |
| `npm run build` | TypeScript and Vite production build | TypeScript, routing, shared type, or package changes. |
| `npm run docs:check` | Documentation governance | Any non-trivial plan or documentation structure change. |
| `git diff --check` | Whitespace safety | Before committing or handing off. |
| `npm run dtc:check -- --required` | A real Device Tree Compiler is present on PATH | Before M1 seeding, DTS validation work, or self-hosted image acceptance. |
| `npm run dtc:seed:compile` | All three committed project seed overlays compile with real `dtc -@` | After changing DTS fixtures, seed generation, validation, or dtc deployment wiring. |
| `npm run dts:toolchain:bootstrap` | dtc/fdtoverlay are installed/checked and pinned dtschema is installed into ignored `.wiseeff-tools/dts-toolchain` | First local setup or after changing `tools/dts-toolchain/requirements.txt` / version pins. |
| `npm run dts:toolchain:check -- --required` | API/CLI shared resolver finds dtc + fdtoverlay + project-local dt-validate and all match `tools/dts-toolchain/versions.json` | Before release-mode publish work or identity cutover rehearsal. No personal Python PATH export is allowed as required setup. |
| `npm run parameter-identities:check` | Read-only preflight/postflight for semantic identity migration | Before/after maintenance-window cutover; see runbook. |
| `npm run parameter-identities:migrate` | Dry-run (default) or gated `--apply` historical identity migration | Cutover rehearsal only; never dual-write in production. |
| `npm run test:server -- server/modules/parameter-topology/legacyDependencyGuard.test.ts --run` | Vitest **source scanner** (not runtime middleware) forbidding retired flat-identity/shadow tokens outside migrations/cutovers/adapters/scripts/tests | After post-cutover workflow edits that might reintroduce legacy SQL or shadow PPV helpers. |
| `npm run test:server -- server/modules/dts/goldenPowerFixture.test.ts server/modules/parameters/seedM1DtsFiles.test.ts server/modules/parameter-specs/matcher.test.ts --run` | Locked golden topology counts: **173** property occurrences, **519** `dts_properties` seed rows | After changing DTS seed fixtures, ingest, or matcher coverage. |
| `npm run test:server -- scripts/vendorDtSchemaGenerator.test.ts --run` | Real `dt-validate` on golden DTBs; negative DTB fixtures fail with expected diagnostics | After vendor dt-schema generation or linux-binding schema changes. |
| `npm run test:server -- server/modules/parameter-topology/migration.test.ts --run` | Durable `stage-review` → `finalize` across PostgreSQL transactions (reconnect + inject-fail) | After migration CLI or staged-run persistence changes. |
| `npm run test:server -- server/modules/parameter-specs/matcherScope.integration.test.ts --run` | Matcher override locator fingerprint isolation; review `blocker_scope` gates | After matcher override or review blocker scope edits. |
| `npm run test:server -- server/modules/parameter-topology/postCutoverWorkflow.integration.test.ts --run` | Post-cutover merge/writeback without shadow PPV; immutable base binding revision; candidate revision carries merged value | After semantic merge/writeback or binding-revision immutability edits. Requires `DATABASE_URL`. |
| `npm run test:server -- server/modules/parameter-specs/draftSpecWorkflow.integration.test.ts --run` | Manual spec draft→`activate`→resolve; draft specs rejected at resolve until active+complete | After `createSpec`, activate route, or spec-review resolve edits. Requires `DATABASE_URL`. |
| `npm run acceptance:e2e -- e2e/acceptance/parameter-topology.acceptance.spec.ts` | Topology governance including draft→activate→resolve plus visible typed edit→submit→role review→merge/writeback; automatically creates, marks, cuts over, verifies, and drops a disposable DB; API runtime resolves the project toolchain without PATH injection | After topology acceptance helpers, semantic edit/submission UI, spec-review UI, or immutable merge behavior changes. `DATABASE_URL` supplies only the PostgreSQL server/admin connection; the spec refuses destructive cleanup unless the generated DB name, test marker, and cutover migration run all match. |
| `npm run parameter-identities:migrate -- --stage-review` / `--finalize` | Maintenance-window inferred migration staging and atomic finalize (temp-DB rehearsal only) | Cutover rehearsal; see `docs/runbooks/parameter-identity-cutover.md`. Phase rows in `parameter_identity_migration_phases` are immutable; inferred tasks carry `migration_run_id`. **Not production-ready while TD-042 is open.** |
| `npm run acceptance:coverage` | Requirement-level browser acceptance coverage markers | Adding or changing browser acceptance requirements or UI/API interaction behavior. |
| `npm run acceptance:operations` | Operation-level browser coverage metadata | Adding or changing concrete user operations, roles, permissions, UI controls, or API-backed interaction behavior. |
| `npm run acceptance:models` | M5.9 state-model and contract invariants for parameter review, log tasks, debugging, and permissions | Changing workflow state transitions, seeded fixtures, permission contracts, or API/domain rules behind browser acceptance. |
| `npm run acceptance:evidence` | Operation evidence index and M5.10 evidence-grade metadata completeness | After a browser acceptance run, or when changing operation evidence helpers, matrix entries, or evidence gates. |
| `npm run acceptance:ci` | M5.12 GitHub Actions acceptance job, synthetic mode, and artifact-archive wiring | After changing `.github/workflows/ci.yml`, acceptance CI scripts, target synthetic modes, or CI artifact paths. |
| `npm run acceptance:quality` | M5.11 quality-gate metadata for accessibility, visual, and responsive specs/scripts | After changing package scripts, quality Playwright config, or quality spec locations. |
| `npm run acceptance:a11y` | WCAG A/AA accessibility scans for core routes and key interaction states | Changing page structure, dialogs, forms, navigation, headings, labels, focus behavior, or Agent panel UI. |
| `npm run acceptance:visual` | Stable-region visual regression snapshots | Changing CSS, layout, shell/page regions, visual hierarchy, or masked snapshot regions. |
| `npm run acceptance:responsive` | Desktop/tablet/mobile responsive usability and overflow checks | Changing layout, dialogs, tables, toolbars, navigation, or viewport-dependent UI. |
| `npm run acceptance:e2e` | Deterministic browser acceptance A-H flows | UI-interaction frontend/backend logic changes in API mode. |
| `npm run acceptance:e2e -- e2e/acceptance/hdc-device-lab.acceptance.spec.ts` | Local real-device HDC frontend/API/device write-readback-rollback evidence | When an approved local HDC target is connected and `DEBUG_DEVICE_GATEWAY_MODE=hdc`, `HDC_DEVICE_LAB_AVAILABLE=true`, `HDC_SMOKE_CONFIRM_WRITE=confirm-high-risk-write`, and `HDC_SMOKE_CONFIRM_ROLLBACK=confirm-rollback` are configured. Auto-prepares a lab-only temporary file node by default. |
| `npm run acceptance:e2e -- e2e/acceptance/adb-device-lab.acceptance.spec.ts` | Local real-device ADB frontend/API/device evidence | When an approved local ADB device is connected and `DEBUG_DEVICE_GATEWAY_MODE=adb` plus `ADB_DEVICE_LAB_AVAILABLE=true` are configured. Defaults to read-only unless `ADB_SMOKE_ENABLE_WRITE=true`. |
| `npm run acceptance:browser` | Preflight plus browser acceptance evidence | Before accepting a local or target browser workflow candidate. |
| `npm run queue:check` | M6.4 target durable queue readiness | Against a running self-hosted or staging API configured with Redis/BullMQ durable queue mode. |
| `npm run selfhost:check` | M6.1 self-hosted compose/env/proxy metadata | After changing `ops/self-hosted/`, package selfhost scripts, or self-hosted runtime docs. |
| `npm run selfhost:smoke` | M6.1 live self-hosted API smoke and evidence | Against a running self-hosted target with `--base-url` and smoke authorization configured. |
| `npm run restore:drill` | M6.3 restore target safety guard | Before running restore commands or changing restore env/script behavior. |
| `npm run backup:drill` | M6.3 backup/restore evidence generation | After collecting PostgreSQL/object-store drill evidence in local or target environments. |
| `npm run backup:check` | M6.3 backup/restore evidence shape, redaction, and failed-command gate | After `npm run backup:drill`, or when changing backup/restore evidence schema. |
| `npm run identity:local-oidc-drill` | M6.2 local OIDC/JWKS drill with signed tokens, `/api/v1/me`, negative token checks, and browser token-provider proof | When no external Keycloak target is available but the local database can prove the OIDC verifier/API/runtime chain. Writes `docs/generated/m6-local-oidc-identity-evidence.md`; this is not final target OIDC evidence. |
| `npm run identity:check` | M6.2 target OIDC discovery, `/api/v1/me`, and negative-token evidence | Against a self-hosted OIDC target after preparing Admin, wrong-issuer, wrong-audience, and expired access tokens. |
| `npm run observability:check` | M6.5 observability config, dashboards, alerts, runbook links, metric references, and secret hygiene | After changing Prometheus, Alertmanager, Grafana, observability runbooks, or server observability wiring. Writes config-only evidence to `docs/generated/m6-observability-config-evidence.md`. |
| `npm run observability:target-evidence` | M6.5 target observability evidence for Prometheus scrape, Alertmanager routing, and Grafana dashboard import | After exercising a real self-hosted target's Prometheus, Alertmanager, and Grafana paths. Writes `docs/generated/m6-observability-evidence.md`, which remains failed/pending until target proofs are explicit. |
| `npm run capacity:gate` | M6.6 capacity threshold evidence shape and redacted capacity report | After changing capacity thresholds, capacity scripts, release evidence docs, or when recording a target capacity run. |
| `npm run rollback:rehearsal` | M6.6 rollback rehearsal step status, artifact references, and redacted rollback evidence | After rehearsing rollback on a non-customer self-hosted target, or when changing release/rollback scripts and docs. |
| `npm run selfhost:release-gate` | M6.6 release-candidate metadata, command-gate, identity/dependency, and evidence summary | Before accepting a self-hosted release candidate or after changing release/rollback/capacity scripts and docs. |
| `npm run m6:target-plan` | M6.2-M6.6 target evidence execution manifest, required inputs, ordered commands, and redacted evidence paths | Before collecting target OIDC, backup/restore, queue, observability, rollback, capacity, synthetic, and release evidence. This command may fail with a `blocked` manifest while target inputs are missing. |
| `npm run m6:target-evidence` | M6.2-M6.6 target evidence summary and plan-completion guard | Before moving any M6.2-M6.6 plan to `docs/exec-plans/completed/`, or after updating generated M6 target evidence. The command must fail while required target evidence remains pending. |

`npm test` defaults `VITE_WISEEFF_RUNTIME_MODE` to `mock` so local `.env` API-mode settings do not leak into frontend unit tests. For an intentional API-mode unit test run, set `VITE_WISEEFF_RUNTIME_MODE=api` explicitly in the shell before invoking `npm test`.

## Milestone Gates

| Gate | Command | Requires | Use when |
| --- | --- | --- | --- |
| M1 parameter management | `npm run test:m2` | PostgreSQL and M0/M1 seeds | Parameter API/runtime changes. |
| M1 full DTS seed | `npm run dtc:check -- --required` plus `npm run dtc:seed:compile`, `npm run db:seed:m1` twice, and focused seed tests | Real dtc, PostgreSQL, local/S3 object store | DTS seed catalog, source binding, structure, baseline, compiler, or idempotency changes. |
| M2 log analysis | `npm run test:m2` | PostgreSQL, local object store, M0-M2 seeds | Log upload, worker, object store, log UI/API changes. |
| M3 debugging | `npm run test:m3-5` | PostgreSQL, simulator gateway, M0/M1/M3 seeds | Debugging service/gateway/runtime changes. |
| M3.5 commercial readiness | `npm run test:m3-5` | PostgreSQL, object-store root, simulator gateway | Readiness, production config, leases, request/audit correlation. |
| Xiaoze P0 perception | `npm run acceptance:e2e -- e2e/acceptance/xiaoze-perception.acceptance.spec.ts` plus `npm run test:server -- perceptionTools perceptionAgent agUiEndpoint` | PostgreSQL, M0/M1 seeds, `XIAOZE_DETERMINISTIC=true` for acceptance | CopilotKit/AG-UI perception surface, read-only `perception.*` tools, authz boundary, and SSE endpoint. |
| Xiaoze P1 action | `npm run acceptance:e2e -- e2e/acceptance/xiaoze-action.acceptance.spec.ts` plus `npm run test:server -- actionTools approvalBridge agUiEndpoint` and `npm test -- src/features/agent` | Same as P0 plus approval-chain persistence | Mutating `action.submitParameterChange`, AG-UI interrupt/resume, HITL approval card, reject/authz paths. |
| Xiaoze P2 planning | `npm run acceptance:e2e -- e2e/acceptance/xiaoze-planning.acceptance.spec.ts` plus `npm run test:server -- planningGraph checkpointer suggest agUiEndpoint` and `npm test -- src/features/agent` | Same as P0/P1 plus `XIAOZE_PROACTIVE_ENABLED=true` and `VITE_XIAOZE_PROACTIVE_ENABLED=true` for proactive acceptance | LangGraph planning loop, checkpoint resume after approval (memory in deterministic acceptance; Postgres in production), read-only proactive suggest API, `useXiaozeSuggestions` / `AgentInsightBar` integration (`XIAOZE-PLAN-MULTISTEP-001`, `XIAOZE-PROACTIVE-001`). |
| Xiaoze durable checkpointer | `npm run test:server -- durableCheckpointer checkpointer env` plus optional `npm run test:server -- durableCheckpointer.integration` when `DATABASE_URL` or `XIAOZE_CHECKPOINTER_TEST_DATABASE_URL` is set | PostgreSQL for integration proof; unit tests use memory/default mode | Postgres-backed LangGraph checkpoint factory, production env guard, migrate-time table setup, cross-instance resume proof (TD-029). |
| M5 smoke | `npm run smoke:m5` | Live API URL by default; admin smoke token for pilot-readiness | Operations smoke against a running API. |
| Manual acceptance preflight | `npm run acceptance:preflight` | `.env`, running API, worker, frontend, PostgreSQL/object store dependencies | Automates manual acceptance steps through runtime health checks. |
| Browser acceptance | `npm run acceptance:browser` | `.env`, API-mode frontend/backend, PostgreSQL, object store, worker dependencies | Automates manual browser workflows A-H and writes generated evidence. |
| Topology project/submission isolation | `npx vitest run src/components/parameter-topology/ApiProjectTopologyWorkspace.test.tsx`; `npm run test:server -- server/modules/parameter-topology/postCutoverWorkflow.integration.test.ts server/modules/parameters/routes.test.ts --run` | Frontend test runtime plus PostgreSQL for server integration | After changing project switching, typed binding draft submission, migration `0059`, candidate identity, or write-lock validation. |
| M5.12 CI local non-HDC acceptance | GitHub Actions `acceptance-local-non-hdc` job | PostgreSQL service container, local object store, `XIAOZE_DETERMINISTIC=true`, simulator gateway | Runs PR/push browser acceptance, state models, a11y, visual, responsive, and archives evidence artifacts. |
| M5.12 target synthetic acceptance | GitHub Actions `target-synthetic-acceptance` workflow_dispatch | Target frontend/API URLs, auth secrets, optional target `DATABASE_URL`, external dependency evidence | Runs manual target non-HDC or full-pilot synthetic checks with `--no-start-runtime` and archives evidence artifacts. |
| M5 full pilot gate | `npm run test:m5` | PostgreSQL, live API, and target evidence inputs | Before claiming commercial pilot baseline in an environment. |
| M6.1 self-hosted baseline | `npm run selfhost:check` plus `npm run selfhost:smoke -- --base-url <target-url>` | Linux host, compose runtime, admin smoke token, object store, Xiaoze LLM config | Before treating a self-hosted target as deployed. |
| M6.2 identity and user governance | `npm run identity:local-oidc-drill`, `npm run identity:check`, `npm run acceptance:browser`, `npm run acceptance:evidence`, and focused auth/user tests | PostgreSQL, API-mode runtime, local OIDC drill, target OIDC issuer, Admin target token, negative OIDC tokens | Before accepting OIDC/auth runtime or backend user-governance changes. `identity:local-oidc-drill` proves local OIDC mechanics only; target signoff still requires `identity:check` against the deployed IdP/API. |
| M6.3 self-hosted storage and backup | `npm run restore:drill`, `npm run backup:drill`, `npm run backup:check` | S3-compatible object store, PostgreSQL backup target, isolated restore database, isolated restore bucket/prefix | Before claiming backup/restore evidence for a self-hosted target. |
| M6.4 durable queue | `npm run queue:check -- --base-url <target-url>` | Running API with `LOG_ANALYSIS_QUEUE_MODE=durable`, Redis/BullMQ, PostgreSQL job table | Before treating a self-hosted queue transport as ready. |
| M6.5 observability and operations | `npm run observability:check`, `npm run observability:target-evidence`, plus focused server observability tests | Prometheus config, Alertmanager rules, Grafana dashboard JSON, runbook links, API metrics endpoint, target scrape/routing/dashboard proof | Before treating a self-hosted target as observable or before relying on alerts for operations. |
| M6.6 release, rollback, and capacity | `npm run m6:target-plan`, `npm run identity:check`, `npm run rollback:rehearsal`, `npm run capacity:gate`, `npm run selfhost:release-gate`, plus `npm run m6:target-evidence` | Deployed self-hosted target, target OIDC identity evidence, `docs/generated/m6-identity-evidence.md`, backup/restore evidence, queue readiness, observability, target synthetic acceptance, rollback rehearsal, capacity metrics | Before treating a self-hosted release candidate as ready for a controlled commercial pilot or moving M6.2-M6.6 plans to completed. |

## UI Interaction Acceptance Rule

Any change that alters user-facing interaction behavior must review the browser acceptance suite under `e2e/acceptance/`. The implementation plan or PR notes must name the affected acceptance spec, the affected acceptance IDs in [browser-acceptance-coverage-map.md](browser-acceptance-coverage-map.md), and the affected operation IDs in [user-operation-coverage-matrix.md](user-operation-coverage-matrix.md). If no acceptance ID or operation ID exists for the changed behavior, add one before implementation. Then update automated coverage/evidence or record why existing coverage still applies.

Use these modes:

```bash
npm run acceptance:browser
npm run acceptance:coverage
npm run acceptance:operations
npm run acceptance:models
npm run acceptance:evidence
npm run acceptance:ci
npm run acceptance:quality
npm run acceptance:a11y
npm run acceptance:visual
npm run acceptance:responsive
npm run acceptance:browser -- --mode target-non-hdc --no-start-runtime
npm run acceptance:browser -- --mode full-pilot --no-start-runtime
```

The generated browser evidence is written to `docs/generated/acceptance-browser-evidence.md` and is derived from the Playwright JSON report at `test-results/acceptance/results.json`. Operation evidence is written to `docs/generated/acceptance-operation-evidence.md` and `docs/generated/acceptance-operation-evidence/index.json`. Evidence-grade records and artifacts live under `test-results/acceptance-evidence-runs/runs/<sourceCommit>/<runId>/`, outside Playwright `outputDir`; `latest-full.json` is published atomically only for a clean-source full run whose Playwright and operation evidence both pass. Focused runs use unpublished namespaces and cannot damage the latest full evidence. The checker rejects mixed run/commit records and missing artifacts. `npm run acceptance:models` is a deterministic non-browser gate; it uses fixed `fast-check` seeds to stress API/domain state transitions before browser acceptance claims that the workflows are stable.

Non-HDC modes require workflows A-E, G, and H to pass; HDC workflow F may be skipped only when explicitly out of scope. The evidence also records requirement-level coverage from `npm run acceptance:coverage` and operation-level evidence from `npm run acceptance:evidence`; missing required IDs, unknown markers, missing required automated operation evidence, or evidence records without review metadata block the run. Browser diagnostics fail acceptance on unexpected page errors, console errors, request failures, and critical WiseEff API `4xx/5xx` responses. Full pilot mode is valid only when HDC device-lab evidence is enabled and ready.

M5.10 evidence-grade rule: every passed operation evidence record must include runtime, trace/report, reproduction, role, route, assertion, status, and artifact metadata. If an operation matrix row declares `api`, `db`, or `audit` assertions, the evidence record must include the matching compact API request/response summary, DB predicate/observed-state summary, or audit event summary. API summaries should include method, path, status, and request ID when the response exposes one. DB summaries should name the table, predicate, observed state, and row count when available. Audit summaries should include event ID, kind, action, target ID, and request/trace correlation when available. Secrets, authorization values, tokens, keys, and bearer values must be redacted before evidence is written.

M5.11 quality-gate rule: UI-facing changes should run the narrow quality gate that matches the risk, plus `npm run acceptance:quality` when scripts or spec wiring change. `npm run acceptance:a11y` covers automated WCAG A/AA scans, `npm run acceptance:visual` covers stable masked snapshots, and `npm run acceptance:responsive` covers desktop/tablet/mobile usability and horizontal-overflow checks. These gates supplement browser acceptance; they do not replace operation evidence or manual judgment for ambiguous visual issues.

M5.12 CI/synthetic rule: `.github/workflows/ci.yml` must keep a local non-HDC acceptance job for PR/push candidates, a manual target synthetic job for `target-non-hdc` and `full-pilot`, and artifact uploads for Playwright reports, traces, screenshots, browser evidence, and operation evidence. Run `npm run acceptance:ci` after changing the workflow. PR CI may prove local non-HDC readiness only; full-pilot remains valid only when the manual workflow uses target environment secrets plus real HDC, backup/restore, rollback, object-store, worker, and Xiaoze LLM evidence.

Xiaoze Agent changes should run the focused acceptance gate before broader milestone verification:

```bash
npm run acceptance:e2e -- e2e/acceptance/xiaoze-perception.acceptance.spec.ts
npm run acceptance:e2e -- e2e/acceptance/xiaoze-action.acceptance.spec.ts
npm run test:server -- agUiEndpoint approvalBridge toolRegistry orchestrator
npm run build
```

The Xiaoze browser acceptance specs remain deterministic when `XIAOZE_DETERMINISTIC=true`. Live LLM runs require configured `AGENT_API_*` values and target-environment evidence before pilot signoff.

M6.2 identity rule: production `NODE_ENV=production` must use `AUTH_PROVIDER=oidc`. Local HMAC smoke is valid for deterministic local gates only. `npm run identity:local-oidc-drill` writes `docs/generated/m6-local-oidc-identity-evidence.md` with a temporary issuer/JWKS service, RS256 tokens, `/api/v1/me`, issuer/audience/expiry negative checks, and browser token-provider proof; this proves the implementation chain without requiring Keycloak. Target OIDC evidence must still be redacted and must prove discovery/JWKS, token expiry/issuer/audience negative checks, browser token acquisition/refresh/logout, `/api/v1/me`, WiseEff DB-backed active/role authorization, and Admin user-governance API/DB/audit evidence against the deployed IdP/API. `npm run identity:check` writes `docs/generated/m6-identity-evidence.md`; it cannot pass unless discovery, Admin `/api/v1/me`, wrong issuer, wrong audience, expired token, and browser runtime evidence statuses are all recorded as passed. Final M6 completion also requires `docs/generated/acceptance-operation-evidence/index.json` to contain target, non-local `PERM-USER-MGMT-001` evidence with `ui`, `api`, `db`, and `audit` assertions, including a successful Admin user-governance mutation and a non-Admin 401/403 rejection on the user-governance API.

## Documentation-Only Changes

Run:

```bash
npm run docs:check
git diff --check
```

For M6.5 observability-only config/docs changes, also run:

```bash
npm run selfhost:check
node -e "const fs=require('fs'); for (const f of fs.readdirSync('ops/self-hosted/observability/grafana/dashboards')) JSON.parse(fs.readFileSync('ops/self-hosted/observability/grafana/dashboards/'+f,'utf8'));"
node -e "const fs=require('fs'); const text=fs.readFileSync('ops/self-hosted/observability/alerts.yml','utf8'); const alerts=[...text.matchAll(/^      - alert:/gm)].length; const links=[...text.matchAll(/runbook_url:/g)].length; if (!alerts || alerts !== links) throw new Error('alerts='+alerts+' runbook_url='+links);"
```

If documentation changes include the docs checker itself, also run:

```bash
npm run test:server -- scripts/check-doc-governance.test.ts
```

## Evidence Rules

- A local simulator test proves workflow shape, not real-device readiness.
- `M5_SMOKE_ALLOW_NO_API=true` is a documented local skip, not pilot evidence.
- HDC device-lab, backup/restore, rollback, live provider, and staging smoke evidence must be recorded in [../generated/m5-pilot-acceptance.md](../generated/m5-pilot-acceptance.md).
- Do not mark TD-019 complete until target-environment evidence exists.
- M6.3 local `docs/generated/m6-backup-restore-evidence.*` proves evidence shape, redaction, failed-command handling, and restore target safety. It proves target readiness only when produced from a real non-customer or pilot target restore drill. Final M6 completion requires both the Markdown summary and machine-readable `docs/generated/m6-backup-restore-evidence.json`; the JSON must identify a target environment, isolated PostgreSQL and object-store restore targets, zero missing log objects, successful restore/backup/check command records, and durable queue persistence metadata. `npm run m6:target-plan` must require `REDIS_URL`, `BACKUP_REDIS_SNAPSHOT_TARGET`, and `BACKUP_REDIS_CHECKPOINT_VALIDATED=true` before the target evidence run is ready.
- M6.5 `npm run observability:check` writes config-only evidence to [../generated/m6-observability-config-evidence.md](../generated/m6-observability-config-evidence.md). It must not be used as target observability evidence. Target observability readiness must be written by `npm run observability:target-evidence` to [../generated/m6-observability-evidence.md](../generated/m6-observability-evidence.md) after Prometheus scrape, Alertmanager routing, and Grafana import proof have been exercised. Target proof URLs must not point at `localhost`, `127.*`, `0.0.0.0`, or `::1`; non-URL evidence references such as redacted file paths or Prometheus query text are allowed.
- M6.6 release readiness must be recorded in [../generated/m6-release-readiness.md](../generated/m6-release-readiness.md) or an approved external release record. `npm run capacity:gate` without observed target metrics, a non-local target URL, a target environment label, a k6 summary reference, and a metrics snapshot reference is a pending or failed evidence artifact, not a capacity pass. `npm run rollback:rehearsal` without a real non-customer target rollback and rollback notes evidence is a pending or failed rehearsal artifact, not a rollback pass. M6.6 evidence writers must reject local-only inputs such as `127.0.0.1`, `localhost`, `::1`, or `local-*` environment labels as target evidence. `selfhost:release-gate` must keep rollback, capacity, target synthetic, queue, and observability readiness as `pending` or `failed` unless the matching evidence path is attached.
- `npm run m6:target-plan` writes [../generated/m6-target-evidence-plan.md](../generated/m6-target-evidence-plan.md). It is an operator manifest only: it may prove the target inputs and command order are prepared, but it does not replace any target evidence file and does not allow M6.2-M6.6 plans to move to completed.
- `npm run m6:target-evidence` writes [../generated/m6-target-evidence-summary.md](../generated/m6-target-evidence-summary.md) and must pass before any M6.2-M6.6 active plan is moved to `docs/exec-plans/completed/`. A failed result is correct while target OIDC, backup/restore, queue, observability, rollback, capacity, or target synthetic evidence is pending.
- `npm run m6:target-evidence` must reject handwritten or partial `Status: passed` evidence. The summary gate parses required target OIDC checks, target user-governance operation evidence, backup/restore validation summaries plus JSON drill evidence, durable queue readiness JSON, non-local observability proofs, rollback steps/artifacts, capacity metrics, release command gates, and target evidence paths before allowing completion.
- Identity readiness cannot be marked complete from local HMAC smoke or static bearer injection; it requires target OIDC evidence from `npm run identity:check`.
- Rollback rehearsal, target synthetic acceptance, queue drain/pause/resume, observability release watch, and HDC evidence cannot be marked complete from local script output alone.
