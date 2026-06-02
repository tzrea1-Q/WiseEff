# Verification Matrix

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
| `npm run acceptance:browser` | Preflight plus browser acceptance evidence | Before accepting a local or target browser workflow candidate. |
| `npm run selfhost:check` | M6.1 self-hosted compose/env/proxy metadata | After changing `ops/self-hosted/`, package selfhost scripts, or self-hosted runtime docs. |
| `npm run selfhost:smoke` | M6.1 live self-hosted API smoke and evidence | Against a running self-hosted target with `--base-url` and smoke authorization configured. |
| `npm run capacity:gate` | M6.6 capacity threshold evidence shape and redacted capacity report | After changing capacity thresholds, capacity scripts, release evidence docs, or when recording a target capacity run. |
| `npm run selfhost:release-gate` | M6.6 release-candidate metadata, command-gate, dependency, and evidence summary | Before accepting a self-hosted release candidate or after changing release/rollback/capacity scripts and docs. |

`npm test` defaults `VITE_WISEEFF_RUNTIME_MODE` to `mock` so local `.env` API-mode settings do not leak into frontend unit tests. For an intentional API-mode unit test run, set `VITE_WISEEFF_RUNTIME_MODE=api` explicitly in the shell before invoking `npm test`.

## Milestone Gates

| Gate | Command | Requires | Use when |
| --- | --- | --- | --- |
| M1 parameter management | `npm run test:m1` | PostgreSQL and M0/M1 seeds | Parameter API/runtime changes. |
| M2 log analysis | `npm run test:m2` | PostgreSQL, local object store, M0-M2 seeds | Log upload, worker, object store, log UI/API changes. |
| M3 debugging | `npm run test:m3` | PostgreSQL, simulator gateway, M0/M1/M3 seeds | Debugging service/gateway/runtime changes. |
| M3.5 commercial readiness | `npm run test:m3-5` | PostgreSQL, object-store root, simulator gateway | Readiness, production config, leases, request/audit correlation. |
| M4 Agent | `npm run test:m4` | PostgreSQL, M0/M1 seeds | Agent API, tool, approval, provider, or frontend Agent changes. |
| M5 smoke | `npm run smoke:m5` | Live API URL by default; admin smoke token for pilot-readiness | Operations smoke against a running API. |
| Manual acceptance preflight | `npm run acceptance:preflight` | `.env`, running API, worker, frontend, PostgreSQL/object store dependencies | Automates manual acceptance steps through runtime health checks. |
| Browser acceptance | `npm run acceptance:browser` | `.env`, API-mode frontend/backend, PostgreSQL, object store, worker dependencies | Automates manual browser workflows A-H and writes generated evidence. |
| M5.12 CI local non-HDC acceptance | GitHub Actions `acceptance-local-non-hdc` job | PostgreSQL service container, local object store, deterministic Agent provider, simulator gateway | Runs PR/push browser acceptance, state models, a11y, visual, responsive, and archives evidence artifacts. |
| M5.12 target synthetic acceptance | GitHub Actions `target-synthetic-acceptance` workflow_dispatch | Target frontend/API URLs, auth secrets, optional target `DATABASE_URL`, external dependency evidence | Runs manual target non-HDC or full-pilot synthetic checks with `--no-start-runtime` and archives evidence artifacts. |
| M5 full pilot gate | `npm run test:m5` | PostgreSQL, live API, and target evidence inputs | Before claiming commercial pilot baseline in an environment. |
| M6.1 self-hosted baseline | `npm run selfhost:check` plus `npm run selfhost:smoke -- --base-url <target-url>` | Linux host, compose runtime, admin smoke token, object store, Agent provider | Before treating a self-hosted target as deployed. |
| M6.6 release, rollback, and capacity | `npm run capacity:gate` plus `npm run selfhost:release-gate` | Deployed self-hosted target, backup/restore evidence, queue readiness, observability, target synthetic acceptance, rollback rehearsal, capacity metrics | Before treating a self-hosted release candidate as ready for a controlled commercial pilot. |

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

The generated browser evidence is written to `docs/generated/acceptance-browser-evidence.md` and is derived from the Playwright JSON report at `test-results/acceptance/results.json`. Operation evidence is written to `docs/generated/acceptance-operation-evidence.md` and `docs/generated/acceptance-operation-evidence/index.json`. `npm run acceptance:models` is a deterministic non-browser gate; it uses fixed `fast-check` seeds to stress API/domain state transitions before browser acceptance claims that the workflows are stable.

Non-HDC modes require workflows A-E, G, and H to pass; HDC workflow F may be skipped only when explicitly out of scope. The evidence also records requirement-level coverage from `npm run acceptance:coverage` and operation-level evidence from `npm run acceptance:evidence`; missing required IDs, unknown markers, missing required automated operation evidence, or evidence records without review metadata block the run. Browser diagnostics fail acceptance on unexpected page errors, console errors, request failures, and critical WiseEff API `4xx/5xx` responses. Full pilot mode is valid only when HDC device-lab evidence is enabled and ready.

M5.10 evidence-grade rule: every passed operation evidence record must include runtime, trace/report, reproduction, role, route, assertion, status, and artifact metadata. If an operation matrix row declares `api`, `db`, or `audit` assertions, the evidence record must include the matching compact API request/response summary, DB predicate/observed-state summary, or audit event summary. API summaries should include method, path, status, and request ID when the response exposes one. DB summaries should name the table, predicate, observed state, and row count when available. Audit summaries should include event ID, kind, action, target ID, and request/trace correlation when available. Secrets, authorization values, tokens, keys, and bearer values must be redacted before evidence is written.

M5.11 quality-gate rule: UI-facing changes should run the narrow quality gate that matches the risk, plus `npm run acceptance:quality` when scripts or spec wiring change. `npm run acceptance:a11y` covers automated WCAG A/AA scans, `npm run acceptance:visual` covers stable masked snapshots, and `npm run acceptance:responsive` covers desktop/tablet/mobile usability and horizontal-overflow checks. These gates supplement browser acceptance; they do not replace operation evidence or manual judgment for ambiguous visual issues.

M5.12 CI/synthetic rule: `.github/workflows/ci.yml` must keep a local non-HDC acceptance job for PR/push candidates, a manual target synthetic job for `target-non-hdc` and `full-pilot`, and artifact uploads for Playwright reports, traces, screenshots, browser evidence, and operation evidence. Run `npm run acceptance:ci` after changing the workflow. PR CI may prove local non-HDC readiness only; full-pilot remains valid only when the manual workflow uses target environment secrets plus real HDC, backup/restore, rollback, object-store, worker, and Agent provider evidence.

## Documentation-Only Changes

Run:

```bash
npm run docs:check
git diff --check
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
- M6.6 release readiness must be recorded in [../generated/m6-release-readiness.md](../generated/m6-release-readiness.md) or an approved external release record. `npm run capacity:gate` without observed target metrics is a pending evidence artifact, not a capacity pass.
- Rollback rehearsal, target synthetic acceptance, queue drain/pause/resume, observability release watch, and HDC evidence cannot be marked complete from local script output alone.
