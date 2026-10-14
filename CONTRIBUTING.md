# Contributing

> Chinese: [Chinese](docs/zh-CN/root/CONTRIBUTING.md)

WiseEff changes should keep the product usable, testable, and auditable. Start with the repository maps, then use the focused developer docs for setup and verification.

## Start Here

1. Read [AGENTS.md](AGENTS.md) for repository routing and agent rules.
2. Use [Development workflow](docs/agents/development-workflow.md) for ordinary delivery and [docs/README.md](docs/README.md) as an index, not a mandatory reading queue.
3. Use [docs/developer/local-development.md](docs/developer/local-development.md) to prepare the local runtime.
4. Use relevant rows of [docs/developer/verification-matrix.md](docs/developer/verification-matrix.md) to choose the right checks before finishing work.

## Local Setup

```bash
npm ci
copy .env.example .env
npm run dtc:bootstrap
npm run dtc:check -- --required
npm run db:migrate
npm run db:seed:m0
npm run db:seed:m1
npm run db:seed:m2
npm run db:seed:m3
```

`db:seed:m1` compiles the three full DTS project fixtures before writing parameter data. The seed therefore requires `dtc`; the bootstrap command installs it with Homebrew on macOS or the native package manager on supported Linux distributions.

For a new local/demo database with the published Catalog, use `npm run db:seed:all` instead of the four individual seed commands. It installs the Catalog between M0 and M1; M1 alone only synchronizes an already published Catalog. The default seed is `crel_vendor_catalog_3` version `1.2.1` (Chinese display names and documentation), after the unchanged Acme and vendor 1/2 releases. The disposable semantic Binding helper extends this exact seed with `crel_acceptance_bindings_1` version `1.3.0`, deriving its predecessor pin and next sequence from the compiled seed; replay still goes through the installer. `schemas/dts/catalog-release/vendor-catalog-1.yaml` freezes the original compiled source so historical digests and revisions are not rewritten.

Author seed presentation content in the property `displayName` and `documentation` fields of `schemas/dts/vendor/wiseeff/*.yaml`. `displayName` is optional and defaults to the unchanged property key; invalid names are rejected by the Catalog content/release schema. Refresh `catalog.json` with `npx tsx scripts/enrich-vendor-property-docs.ts`, then compile with `npm run catalog:compile-vendor -- --localized --out /tmp/vendor-catalog-zh.json`. The localized successor changes presentation only, not keys, subjects, value schemas, units, matching, Bindings or Project values. The retained, retired Acme sample's Chinese presentation is seed content in the compiler; its historical fixture stays unchanged. For an adopted or live Catalog, use the normal typed ChangeSet and reviewed release path; do not reseed or edit database rows to rename definitions.

For the full DTS toolchain (dtc + fdtoverlay + dt-validate) used by fail-closed production publish:

```bash
npm run dts:toolchain:check
```

Semantic parameter-identity cutover rehearsal commands (`parameter-identities:migrate` / `cutover` / `check`) are operator-only. Follow [docs/runbooks/parameter-identity-cutover.md](docs/runbooks/parameter-identity-cutover.md); never continue after a failed `--apply`.

For isolated browser tests, `WISEEFF_ACCEPTANCE_NESTED_API_PORT` and `WISEEFF_ACCEPTANCE_NESTED_FRONTEND_PORT` fix the nested API/frontend listeners, including the canonical DTS reload spec. Set `WISEEFF_ACCEPTANCE_NO_START_RUNTIME=true` and use `--no-deps` to avoid a parent runtime occupying those ports. Controlled-device loopback sockets remain test-owned and ephemeral. CI leaves the overrides unset.

Fill `XIAOZE_LLM_API_BASE_URL`, `XIAOZE_LLM_MODEL`, and `XIAOZE_LLM_API_KEY` in `.env` when testing live Xiaoze LLM behavior. The canonical group is atomic: if any canonical key is present, blank values are explicit and legacy aliases are ignored. The default `.env.example` profile prepares local PostgreSQL, local object storage, multi-protocol device gateway, production-mode local account auth defaults, and optional HMAC smoke inputs.

## Development Rules

- Keep edits scoped to the requested behavior.
- Preserve mock runtime for demos and tests unless a plan explicitly removes it.
- Production-oriented paths must use the API runtime, backend authz, validation, transaction writes, and audit evidence.
- Update the closest documentation when a behavior, runtime, environment variable, command, or acceptance rule changes.
- Do not claim pilot readiness from local skips. Record real target-environment evidence in [docs/generated/m5-pilot-acceptance.md](docs/generated/m5-pilot-acceptance.md).

## Plans And Docs

Use an active plan under `docs/exec-plans/active/` for cross-session work, architecture changes, risky rollout, multi-team coordination, or an explicit task contract. Other bounded work may use a task/PR summary. Existing active plans retain their gates; every active implementation plan except `development-roadmap.md` must include:

- `## Documentation Impact Matrix`
- `## Documentation Update Gate`

Run:

```bash
npm run docs:check
```

before marking a plan complete. Repository skills are optional task-specific aids, not an external-pack prerequisite. See [Skills and client configuration](docs/agents/skill-maintenance.md).

## Verification

Use targeted tests while editing, then broaden according to risk:

```bash
npm test -- <affected-test-files>
npm run test:server -- <affected-test-files>
npm run build
npm run docs:check
```

### Local Vitest impact selection

`test:impact` lists tests; it does not execute them or start the API, browsers, or test databases:

```bash
npm run test:impact -- src/DebuggingPage.tsx
npm run --silent test:impact -- --base origin/main --json > /tmp/vitest-impact.json
```

Pass repository-relative changed files **or** `--base <commit>`. The base compares that commit with the current working tree, including committed, staged, unstaged, and untracked changes; renames include both paths. Runnable suite, static-gate, and browser commands go to stderr and JSON (`changedPaths`, `fullFallback`, `reasons`, `suites`, `gates`, `browser`, `commands`) to stdout; `--json` suppresses the command listing. Use npm's `--silent` when piping JSON.

Selection uses Vitest's transitive related-test discovery in the frontend, server, scripts, and Bridge configurations. Ordinary scripts select related tests, not the entire scripts suite; ops and package changes also select their complete owning suite. Local component/feature CSS selects all frontend and scripts tests so file-reading style guards are not missed. Shared shell/UI primitives, global styles, explicitly identified CI/receipt/partition/seed-contract/runtime harness files, configs, missing/deleted or unmapped code, and dependency-discovery failures select all four suites.

Markdown under `docs/` or at the repository root selects `docs:check` without loading Vitest; runbook Markdown also selects `docs:runbook-commands:check`, which reuses the existing runbook-command validator. OpenAPI/DTO schema changes select `contract:check`, frontend CSS/TSX selects `ui:check`, and workflows/CI scripts select `acceptance:ci`. Gate implementation changes also select their gate alongside related tests: ownership is derived from package script commands, relative tooling imports, and generators in the same namespace or sharing those tooling helpers. The generated OpenAPI artifact selects only its contract gate. Gate names are deduplicated in `gates`, and their runnable commands are appended to `commands`.

A selection is empty only when both `suites` and `gates` are empty; gate-only documentation changes are valid. Empty changes and missing required full-suite inventories still fail. Inspect `fullFallback` and respect the task's verification budget before running emitted commands; this local tool does not replace PR CI, browser acceptance, or any existing gate.

Browser selection uses `e2e/quality/route-ownership.ts` next to the quality route registries. `browser` reports its own `fullFallback`, `reasons`, `qualityRoutes`, `qualityGrep`, `acceptanceSpecs`, and `commands`; an unknown browser owner selects full browser coverage even when Vitest finds related tests. The quality grep retains warmup and unlabelled interaction checks, and any cross-route test mentioning a selected route. Acceptance specs are selected by the existing operation matrix's visited routes plus static navigation evidence, never by spec names. Discovery resolves route literals, runtime URL templates, imported constants, called helpers' arguments/defaults, and visible navigation labels from `src/appConfig.ts`; uncalled helpers do not contribute routes. Only genuinely unresolved navigation remains selected conservatively, through the reasoned `unresolvedBrowserNavigation` allow-list in `scripts/browser-navigation.ts` (currently empty, capped at five specs). New unresolved navigation, stale entries, or missing reasons fail discovery instead of silently broadening selection. API-only specs without navigation need not run for an isolated route change. For example, a `/logs` change includes knowledge distillation and the runtime-URL log904 related-parameter flow. Shared changes and Vitest discovery failures select full browser coverage; documentation/generated-OpenAPI-only changes emit no browser command. Empty browser inventories or code selections fail rather than emit a passing no-op. These outputs are advisory runnable selections; they do not change CI gates or execute Playwright.

### Codex scoped browser runner (D3)

Local Unix-domain IPC is allowed only beneath the current user's canonical temp directory's `tsx-<effective UID>` subdirectory. Child `TMPDIR` is pinned to that canonical temp directory so tsx's socket path matches the profile; non-loopback IP networking remains denied.

`test:browser:codex` is the local runner for #1179, not a replacement for CI or coordinator acceptance. Run it from the root of a dedicated linked worktree on a `codex/<task>` branch, with an explicitly exported `WISEEFF_RUNTIME_LANE` and a localhost PostgreSQL `DATABASE_URL`. Choose a lane ID not used by another worktree or browser session. Provision and seed the derived `<database>_lane_<N>` database using the existing browser runtime setup first; the runner does not provision, migrate, reset, or seed databases. PostgreSQL URL query overrides and databases already belonging to a different lane are rejected.

```bash
export WISEEFF_RUNTIME_LANE=7
npm run test:browser:codex -- src/features/log-analysis/LogsPage.tsx
npm run test:browser:codex -- --check test-results/lanes/7/codex-browser-evidence.json
```

Alternatively pass `--base <commit>` instead of changed paths, with the same committed/staged/unstaged/untracked selection semantics as `test:impact`. The runner uses that selector's implementation and records the effective browser selection and commands. It executes only the quality grep and exact acceptance spec paths, retaining existing warmup dependencies. On non-Linux hosts, it excludes the `visual` quality project and spec files containing screenshot/snapshot baseline assertions, recording each exclusion in `skipped` with reason `platform: Linux-only baselines`; Linux selection has no such exclusions (CI renders remain authoritative). Unknown/shared changes retain the selector's full browser fallback; if the task's budget prohibits that run, leave it to the coordinator rather than narrowing it manually. Quality and acceptance run sequentially in the same lane, with the existing lane-specific database, ports, object store, outputs, and refusal to reuse servers. Owned runtime descriptors, externally supplied skip-runtime settings, quality-project partition overrides, alternate snapshot roots, and object stores outside the worktree are rejected. Before either runtime starts, selected acceptance tests require nonblank `AUTH_TOKEN_ISSUER` and `AUTH_TOKEN_HMAC_SECRET`. The runner loads the worktree's `.env` with explicit environment values taking precedence, then validates and pins lane ownership. This includes smoke-authorization/provider settings, not just token issuer/secret, matching plain Playwright's auth-provider selection. Child dotenv input remains `/dev/null`; `.env.local` overrides of database, bind ports/host, object store, or lane endpoints are rejected. Missing auth produces a nonzero exit and a receipt with `status: "blocked: missing <names>"`, `missingConfig` names only, and empty `runs`; secret values are never copied into the receipt.

Before each suite, the runner verifies that both lane TCP ports can be bound exclusively on loopback; it never kills an existing listener or reuses it. It starts API/frontend servers itself in detached, sandboxed process groups using the shared Playwright web-server environment builder. Acceptance retains its existing production-auth setting even when the parent exports `AUTH_MODE=development`. After readiness, a token generated with the browser sign-in helper must receive HTTP 200 from `/api/v1/me` both directly and through the frontend proxy before any tests launch. Proxy environment variables are removed and `NO_PROXY=*` prevents inherited proxies from affecting loopback checks. Only the runner's internally owned Playwright child receives the skip-web-server flag. Every suite awaits reverse-order process-group termination (TERM, KILL if needed, verified absent) before the next suite starts; lane ports are checked again between suites and after the final teardown. SIGINT/SIGTERM also enter cleanup. Port conflicts, probe/startup failures, interruptions, and cleanup failures exit nonzero with `blocked: <reason>` and a sanitized `block` containing suite, conflicting ports or HTTP status where applicable; only already-attempted runs remain in the receipt. A teardown failure prevents the next suite from starting. Readiness and native runtime behavior still require coordinator verification.

The current execution backend is **macOS only**: native `/usr/bin/sandbox-exec` confines Playwright, Chromium, API/frontend servers and their descendants to loopback IP networking. Other platforms or an unavailable/denied sandbox fail closed; there is no unrestricted fallback, browser download, shell-command input, git write, push, or PR action. D3's user-approved Codex sandbox bypass is only for a coordinator-launched dedicated task session under those same boundaries; this runner never enables bypass itself. The coordinator must verify the native network restriction and Chromium startup live before accepting this backend. This ticket's normal-sandbox implementer does not launch it.

The version-1 receipt is `test-results/lanes/<N>/codex-browser-evidence.json`. It contains `worktree` (root, branch, HEAD, dirty flag), credential-free `lane` (database name, URLs and artifact roots), `network`, `selection.changedPaths`, the exact `selection.browser`, timestamps, overall `status`, executed test-label `themes`, and two ordered `runs` (quality, acceptance). Each run records exit code, elapsed milliseconds, JSON report path, report error count, and tests with file/title/project, title-labelled routes/theme, expected status, native outcome, total duration, and per-attempt status/retry/duration/artifact paths. Unlabelled routes remain `[]` and unlabelled themes remain `null`; these are report labels, not proof of which pages a browser actually visited. Inline attachments point to their original JSON report instead of duplicating bytes. Raw JSON reports, HTML reports, screenshots and traces stay in their existing lane directories and retain the existing artifact-sanitization/sharing obligations.

The exported `codexBrowserEvidenceSchema` and `--check <receipt>` validate the machine-readable format and reconcile status with results. Nonzero/interrupted launches, malformed/missing reports, unexpected/flaky results, omitted selected acceptance specs, zero executed non-warmup tests, and wholly skipped runs cannot pass. Previous JSON results are removed before launch, output symlinks cannot escape the worktree, and a lane-local lock rejects concurrent runner invocations within the same worktree. A forcibly terminated runner may leave `.codex-browser-lock`; the coordinator may remove that empty directory only after confirming its processes are stopped. Receipts initially contain `spotCheck: null`: the coordinator records a real review by replacing it with `{ "reviewer": "<name>", "checkedAt": "<ISO timestamp>", "outcome": "passed|failed", "notes": "<change, routes/themes, screenshots/interactions checked>" }` and reruns `--check`. Pending spot-check is printed explicitly; a structurally valid failed run or failed spot-check exits nonzero. Demonstration on a real change, the recorded coordinator spot-check, Playwright quality/acceptance, `ui:check`, and screenshots remain live-runtime evidence, not unit-test claims.

### Test database isolation

Local quality and acceptance Playwright configs accept `WISEEFF_RUNTIME_LANE=<N>` (an integer 1–10000, without leading zeros). Supply a PostgreSQL `DATABASE_URL`: the descriptor selects `<database>_lane_<N>`, API port `20000 + 2*N`, frontend port `20001 + 2*N`, `<OBJECT_STORE_ROOT>/lane-<N>` (default `.wiseeff-object-store/lane-<N>`), and `test-results/lanes/<N>/<quality|acceptance>` plus `playwright-report/lanes/<N>/<quality|acceptance>`. It propagates these settings to browser workers and sets `WISEEFF_TEST_DATABASE_PREFIX=pw_lane_<N>` for nested fixtures. Provision and seed each lane database using the existing runtime setup before starting Playwright; the descriptor does not create or reset databases. Choose distinct IDs for simultaneous runs, including quality versus acceptance, and keep the object store in local mode. Lane runs refuse server reuse and cannot be combined with owned Gate0 descriptors/flags; existing owned runtime isolation stays unchanged. Without a lane, all existing defaults and overrides remain unchanged.

For example, run `WISEEFF_RUNTIME_LANE=1 npx playwright test --config playwright.quality.config.ts` with the base `DATABASE_URL` exported; another worktree can use lane 2 with the same base URL. `WISEEFF_QUALITY_LANE` still selects quality projects independently. Lane output/report locations take precedence over shared output overrides. Direct `npm run dev` honors `WISEEFF_FRONTEND_PORT` (default 5173) and `VITE_WISEEFF_API_BASE_URL` (default `http://127.0.0.1:8787`); `npm run dev:api` continues to honor `PORT` (default 8787). Both Vite API/download proxies use the selected API URL.

In lane mode, the frontend child receives its own Vite origin as `VITE_WISEEFF_API_BASE_URL`, so browser API/download requests stay same-origin. `WISEEFF_DEV_API_PROXY_URL` selects the separate API upstream for Vite's `/api` and `/downloads` proxies. Node-side browser fixtures and seed tools retain the direct API URL. This avoids requiring broader API CORS permissions for lane ports and preserves authorization headers; non-lane launch behavior is unchanged. Manually launched lane frontends need the same browser-base/proxy-upstream split.

Disposable post-cutover browser fixtures use `<prefix>_disposable_…` when `WISEEFF_TEST_DATABASE_PREFIX` is set; otherwise they retain `wiseeff_acceptance_disposable_…`. Manual runs may pin nested listeners with `WISEEFF_ACCEPTANCE_NESTED_API_PORT` and `WISEEFF_ACCEPTANCE_NESTED_FRONTEND_PORT` (distinct integer ports from 1–65535). Run nested-only specs with `WISEEFF_ACCEPTANCE_NO_START_RUNTIME=true` and `--no-deps` when reusing the manual runtime's ports; do not start a parent runtime on those listeners. CI leaves these overrides unset and retains allocated, isolated ports.

The PostgreSQL test harness (`server/testing/testDatabase.ts`) connects using nonblank `TEST_DATABASE_URL`, then `DATABASE_URL`, then the local Compose default. For parallel worktrees on the same cluster, set a distinct `WISEEFF_TEST_DATABASE_PREFIX` before starting each test process. The trimmed prefix defaults to `wiseeff` when unset or blank; it must match `^[a-z][a-z0-9_]{0,15}$` (1–16 characters, starting with a lowercase ASCII letter, followed by lowercase ASCII letters, digits, or underscores). Invalid prefixes fail before database setup.

The prefix names migration templates (`<prefix>_test_tpl_…`), temporary template builds (`<prefix>_test_tplbuild_…`), and worker/ephemeral databases (`<prefix>_test_wk_…`). When the variable is supplied, managed-instance fixtures use `<prefix>_m…`; with it unset, they retain `wiseeffm…`. Stale-template and orphan-worker cleanup is limited to the selected template/worker prefixes (underscores are matched literally), and worker teardown also matches the current run token. Choose a unique prefix, such as `review_fixes`, so one worktree's cleanup does not select another's test databases. This setting does not change the database URL, grant permissions, or remove the shared cluster role-catalog lock.

WiseEff is PC-first: visible work defaults to the affected route/state at `1440x900`, not a three-device walkthrough. Add one compact desktop check for a concrete layout risk; tablet/mobile checks are opt-in. Follow the [UI quality checklist](docs/developer/ui-quality-checklist.md) for real-browser evidence and specialized acceptance boundaries.

Use the phase gates in [docs/developer/verification-matrix.md](docs/developer/verification-matrix.md) for M1-M5 work. Documentation-only changes should still run `npm run docs:check` and `git diff --check`.
