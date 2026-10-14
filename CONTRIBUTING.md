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

### Test database isolation

Disposable post-cutover browser fixtures use `<prefix>_disposable_…` when `WISEEFF_TEST_DATABASE_PREFIX` is set; otherwise they retain `wiseeff_acceptance_disposable_…`. Manual runs may pin nested listeners with `WISEEFF_ACCEPTANCE_NESTED_API_PORT` and `WISEEFF_ACCEPTANCE_NESTED_FRONTEND_PORT` (distinct integer ports from 1–65535). Run nested-only specs with `WISEEFF_ACCEPTANCE_NO_START_RUNTIME=true` and `--no-deps` when reusing the manual runtime's ports; do not start a parent runtime on those listeners. CI leaves these overrides unset and retains allocated, isolated ports.

The PostgreSQL test harness (`server/testing/testDatabase.ts`) connects using nonblank `TEST_DATABASE_URL`, then `DATABASE_URL`, then the local Compose default. For parallel worktrees on the same cluster, set a distinct `WISEEFF_TEST_DATABASE_PREFIX` before starting each test process. The trimmed prefix defaults to `wiseeff` when unset or blank; it must match `^[a-z][a-z0-9_]{0,15}$` (1–16 characters, starting with a lowercase ASCII letter, followed by lowercase ASCII letters, digits, or underscores). Invalid prefixes fail before database setup.

The prefix names migration templates (`<prefix>_test_tpl_…`), temporary template builds (`<prefix>_test_tplbuild_…`), and worker/ephemeral databases (`<prefix>_test_wk_…`). When the variable is supplied, managed-instance fixtures use `<prefix>_m…`; with it unset, they retain `wiseeffm…`. Stale-template and orphan-worker cleanup is limited to the selected template/worker prefixes (underscores are matched literally), and worker teardown also matches the current run token. Choose a unique prefix, such as `review_fixes`, so one worktree's cleanup does not select another's test databases. This setting does not change the database URL, grant permissions, or remove the shared cluster role-catalog lock.

WiseEff is PC-first: visible work defaults to the affected route/state at `1440x900`, not a three-device walkthrough. Add one compact desktop check for a concrete layout risk; tablet/mobile checks are opt-in. Follow the [UI quality checklist](docs/developer/ui-quality-checklist.md) for real-browser evidence and specialized acceptance boundaries.

Use the phase gates in [docs/developer/verification-matrix.md](docs/developer/verification-matrix.md) for M1-M5 work. Documentation-only changes should still run `npm run docs:check` and `git diff --check`.
