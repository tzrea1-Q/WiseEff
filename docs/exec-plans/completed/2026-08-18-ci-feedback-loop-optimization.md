# CI Feedback Loop Optimization

> Status: **Completed 2026-08-18** — #523 (Wave 0+1), #524 (L1 import ratchet), #525 (Wave 2). First Wave 2 `main` L2: [`32109015523`](https://github.com/tzrea1-Q/WiseEff/actions/runs/32109015523) (wall 31m12s).
> Date: 2026-08-18
> Implementation branches: `feat/ci-feedback-loop`, `feat/ci-l2-harden`, `feat/ci-wave2`
> Chinese: [`docs/zh-CN/exec-plans/completed/2026-08-18-ci-feedback-loop-optimization.md`](../../zh-CN/exec-plans/completed/2026-08-18-ci-feedback-loop-optimization.md)

**Goal:** Stop treating the 38-minute M5.12 local-non-HDC suite as the PR merge bar. Keep that suite as the post-merge / on-demand evidence gate, and give everyday changes a layered GitHub Actions pipeline that matches how mature TypeScript products schedule work.

**Architecture:** Three layers, one workflow file, one sentinel required check.

| Layer | When it runs | What it proves | Target wall clock |
| --- | --- | --- | --- |
| L0 detect | Every event | Which paths changed; which later jobs are allowed to skip | < 1 min |
| L1 merge bar | Every product PR; `main` | Unit/integration, lint, docs, UI ratchet, contract, build; quality-once when UI paths change; tagged `@ci-smoke` acceptance when product paths change | 10–15 min typical; 2–5 min docs-only |
| L2 full local-non-HDC | `push` to `main`, nightly schedule, `full-acceptance` label, `workflow_dispatch` | Sibling `acceptance-quality` + `acceptance:browser --mode local-non-hdc` + evidence archive | ~29 min expected after Wave 2 (browser 25m39s is the floor) |
| L3 target synthetic | Manual only | Unchanged `target-non-hdc` / `full-pilot` | as today |

**Tech Stack:** GitHub Actions (`concurrency`, path filters, job `if`, `timeout-minutes`), existing Playwright/Vitest scripts, a rewritten `scripts/check-acceptance-ci.ts` ratchet, optional `dorny/paths-filter` or a tiny in-repo changed-files script (no Nx/Turborepo).

---

## Industry Research (primary sources)

Claims below come from the projects' own workflow YAML or first-party docs, fetched 2026-08-18. Secondary blogs are not used as authority.

### Scheduling and double-runs

- [GitHub Actions concurrency](https://docs.github.com/en/actions/using-jobs/using-concurrency): a concurrency group allows one run at a time; `cancel-in-progress: true` cancels the stale run. Official example for PRs: `group: ${{ github.head_ref || github.run_id }}`.
- [vitejs/vite `ci.yml`](https://github.com/vitejs/vite/blob/main/.github/workflows/ci.yml): `on.push` is limited to `main` / release / feat / fix / perf / version tags; `pull_request` is unrestricted. `concurrency.group` is `${{ github.workflow }}-${{ github.event.number || github.sha }}` with `cancel-in-progress: true`. A `changed` job skips the heavy `test` matrix when the diff is only `docs/**`, `**.md`, templates, or most `.github/**` (except `ci.yml` itself). A `test-passed` / `test-failed` sentinel still reports status when the matrix is skipped.
- [vercel/next.js `build_and_test.yml`](https://github.com/vercel/next.js/blob/canary/.github/workflows/build_and_test.yml): `push` only on `canary`; `pull_request` types `opened, synchronize`. Concurrency cancels in-progress PR runs (`…-pr-{ref}`) but isolates pushes by SHA. A `changes` job sets `docs-only`; native/build jobs `if: needs.changes.outputs.docs-only == 'false'`. The required aggregator is named `thank you, next` (YAML comment: merging is blocked unless it passes). Deploy-to-Vercel e2e is **not** every PR; PRs run deploy tests only for new/changed test files.
- [prisma/prisma `main` `ci.yml`](https://github.com/prisma/prisma/blob/main/.github/workflows/ci.yml): `pull_request` + `merge_group` only — **no `push`**. Comment “Pattern 1”: required jobs still launch and report on docs-only PRs; Postgres-backed **steps** skip when the diff is inert.
- [prisma/prisma `v7` `test.yml`](https://github.com/prisma/prisma/blob/v7/.github/workflows/test.yml) first-party comment: *“Run on `push` only for main, if not it will trigger `push` & `pull_request` on PRs at the same time.”* That is the double-run WiseEff has today.
- [Turborepo GitHub Actions guide](https://turbo.build/repo/docs/guides/ci-vendors/github-actions): canonical example is `push.branches: ["main"]` plus `pull_request` types `opened, synchronize`, with `timeout-minutes: 15`. Feature-branch pushes are not a second full CI.
- [microsoft/playwright `tests_primary.yml`](https://github.com/microsoft/playwright/blob/main/.github/workflows/tests_primary.yml): `push` and `pull_request` only on `main` / `release-*`. PR `paths-ignore` includes `docs/**` (workflow-level; see the Pending trap below). Concurrency: `${{ github.workflow }}-${{ github.head_ref || github.run_id }}` + `cancel-in-progress: true` — unique `run_id` on push so main runs do not cancel each other. Matrix `fail-fast: false`. Test-runner jobs shard (`--shard N/M` plus `PWTEST_SHARD_WEIGHTS`).
- [microsoft/playwright `tests_secondary.yml`](https://github.com/microsoft/playwright/blob/main/.github/workflows/tests_secondary.yml): the expensive mac/Windows/channel matrix is **`pull_request` types `[labeled]`** (plus push to `main`/`release-*`). Ordinary synchronize does not start it. Some jobs further require label `CQ1`.
- [vitest-dev/vitest `ci.yml`](https://github.com/vitest-dev/vitest/blob/main/.github/workflows/ci.yml): `push` only `main`. Same Vite-style `changed` skip. Unit / e2e / coverage are **separate runners**, not one serial machine. Browser suite shards; `fail-fast: false`; `merge-reports` is `if: !cancelled()`.
- [grafana/grafana `pr-e2e-tests.yml`](https://github.com/grafana/grafana/blob/main/.github/workflows/pr-e2e-tests.yml): `push` limited to `main` / `release-*.*.*`. Change-detection excludes `*.md` and `docs/**`. `cancel-in-progress` is **PR-only**: `${{ startsWith(github.ref, 'refs/pull/') }}`. Docs PRs skip Playwright shards; a placeholder job `All E2E tests complete` stays required. **`push` to main always runs e2e.**
- [home-assistant/core `ci.yaml` / `e2e-tests.yml`](https://github.com/home-assistant/core/blob/dev/.github/workflows/ci.yaml): `push` only `dev`/`rc`/`master`. PR gate is lint + affected pytest. [Playwright e2e](https://github.com/home-assistant/core/blob/dev/.github/workflows/e2e-tests.yml) is `workflow_dispatch` + `workflow_call` only — **not on `pull_request`**. Full pytest matrix needs core-file hits, trunk push, or label `ci-full-run`.
- [rust-lang/rust `ci.yml`](https://github.com/rust-lang/rust/blob/master/.github/workflows/ci.yml): feature-branch `push` is not a second matrix. PR runs a `pr:` subset; the comment on [`jobs.yml`](https://github.com/rust-lang/rust/blob/master/src/ci/github-actions/jobs.yml) says the jobs that must be green to merge are the bors `auto:` jobs, not every PR push.

WiseEff today does the opposite: unrestricted `on: push` and `on: pull_request`, no concurrency, no path filter. One PR commit therefore starts two full 38-minute runs (~96 billed minutes).

### Do not skip the whole workflow when a check may be required

GitHub status-check docs: a job skipped by `if:` reports **Success** and does not block merge. A workflow that never starts because of `on.paths` / `paths-ignore` / `[skip ci]` leaves its checks **Pending** and **blocks** a required check. Official wording: avoid requiring workflows that can be skipped.

- [About status checks](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/collaborating-on-repositories-with-code-quality-features/about-status-checks)
- [Skip workflow runs](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/skip-workflow-runs)
- [Troubleshooting required checks](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/collaborating-on-repositories-with-code-quality-features/troubleshooting-required-status-checks)

Vite and Vitest already do this: the workflow always starts; expensive jobs use `if:`; lint still runs on docs-only. Playwright's own `tests 1` uses PR `paths-ignore: docs/**` — that is the unsafe pattern **if** those jobs are later marked required (`infra` still runs, which is why they survive). Grafana keeps an always-present placeholder required job. [Supabase `docs-e2e.yml`](https://github.com/supabase/supabase/blob/master/.github/workflows/docs-e2e.yml) states the same trap in-repo: *“Docs E2E” is a required status check on master, so this workflow must produce a check run on every PR — a `paths` trigger filter would leave non-docs PRs waiting on a check that never reports.* Prisma `main` calls the same idea Pattern 1.

**WiseEff rule:** never add `on.pull_request.paths` / `paths-ignore` to `ci.yml`. Skip with job `if:` only. The sentinel job always runs.

### Expensive browser suites are not the default PR gate

- [calcom/cal.diy `pr.yml`](https://github.com/calcom/cal.diy/blob/main/.github/workflows/pr.yml) (GitHub resolves `calcom/cal.com` here; Cal.com production is closed-source): `pull_request_target` only, no `push`. `dorny/paths-filter` treats markdown / `docs/**` / help / locales / `.vscode` as not requiring all checks. Playwright e2e waits for label `ready-for-e2e`. The `required` job is `if: always()`. Docs-only PRs stay green without Playwright. **Code PRs are the opposite of “optional e2e”:** the [Playwright agent rule](https://github.com/calcom/cal.diy/blob/main/agents/rules/testing-playwright.md) says *when E2E tests are skipped, the `required` check intentionally fails to prevent merging without E2E.* Merge queue [`all-checks.yml`](https://github.com/calcom/cal.diy/blob/main/.github/workflows/all-checks.yml) always runs the full e2e set. The label **defers** the expensive suite; it does not make e2e optional for merge.
- [twentyhq/twenty `ci-e2e-main.yaml`](https://github.com/twentyhq/twenty/blob/main/.github/workflows/ci-e2e-main.yaml): product Playwright runs on **`push` to `main`** or a PR labeled `run-merge-queue`. Ordinary PRs skip e2e. The `*-status-check` job fails only if a needed job **failed**, not if it was skipped — so an unlabeled PR stays green. `cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}`.
- [supabase/supabase `studio-e2e-test.yml`](https://github.com/supabase/supabase/blob/master/.github/workflows/studio-e2e-test.yml): workflow **starts** on every `push: master` and every `pull_request`; Playwright steps run only when studio-related paths changed. Matrix `fail-fast: false`, two shards with weights `62:38`.
- [Microsoft DevOps engineering](https://learn.microsoft.com/en-us/devops/develop/how-microsoft-develops-devops): a PR runs a **fast subset** (~60,000 tests in about 5 minutes) that is explicitly *not* the full Microsoft matrix; longer acceptance is post-merge.
- [Google Testing Blog — Just Say No to More End-to-End Tests](https://testing.googleblog.com/2015/04/just-say-no-to-more-end-to-end-tests.html): a feedback loop must be fast, reliable, and isolate failures. Using an overnight e2e suite as the *only* ship gate caught user-facing bugs but blocked the team for a week. Keep a small number of real e2e tests; do not make them the sole merge bar.
- [Nx “affected”](https://nx.dev/ci/features/affected): as the graph grows, re-testing everything becomes too slow; CI should run tasks only on projects touched by the PR (plus dependents). Nx is not adopted here; the same *decision* is expressed with path filters in a single package.
- [Google Testing Blog — Test Sizes](https://testing.googleblog.com/2010/12/test-sizes.html) and [Hackable Projects, Pillar 3](https://testing.googleblog.com/2016/11/hackable-projects-pillar-3.html): small tests are the presubmit signal; large / UI / multi-resource tests are slower and flakier. Comment on the latter post (Google SET discussion): most projects are fine running unit tests in presubmit and broader platform suites postsubmit. [Flaky Tests at Google](https://testing.googleblog.com/2016/05/flaky-tests-at-google-and-how-we.html): large tests are the flaky class; some teams keep low-consistency tests out of the submission gate and in a reliability suite.

WiseEff's M5.12 rule currently puts the Large suite (shared Postgres, Vite, four Playwright process boots, 129 acceptance tests, 11 routes × 3 viewports) on every PR and every push.

### Playwright's own CI advice (what to copy, what not to cargo-cult)

- [Playwright CI](https://playwright.dev/docs/ci): on GitHub-hosted runners, prefer `workers: 1` for stability; use **sharding across jobs** for speed, not more workers on one 2–4 core VM. Always set `timeout-minutes`. `--only-changed` is a *preliminary* fail-fast on PRs; the same page says it is a heuristic and the full suite must still run afterwards. Caching browser binaries is **not** recommended (restore ≈ download, and OS deps are not cacheable).
- [Playwright sharding](https://playwright.dev/docs/test-sharding): `--shard=x/y` only helps tests that can run in parallel. `fullyParallel: true` balances at test granularity; without it, shards are file-level and uneven files waste machines. Merge blob reports after.

WiseEff already follows `workers: 1` / `fullyParallel: false` because the acceptance database is shared and mutating. Sharding that suite **before** isolation would be incorrect. Quality-route tests and disposable-DB specs are the only shards that are honest today.

### Patterns adopted

1. Feature branches: `pull_request` only; `push` limited to `main` (Vite / Next / Prisma v7 comment / Turbo / Grafana / Home Assistant / Rust). Prisma `main` goes further (`pull_request` + `merge_group`, no `push`); we keep `push: main` because L2 evidence must run after merge without a merge queue.
2. `concurrency` on every run; **`cancel-in-progress` only for pull requests** (Grafana `startsWith(github.ref, 'refs/pull/')`; Twenty `github.ref != 'refs/heads/main'`; Playwright / Next isolate push by `run_id` / SHA). Do not cancel an in-flight `main` L2 seed.
3. Path detect + **job-level** `if:` skip on docs-only (Vite / Vitest / Next / Prisma Pattern 1 / Supabase Docs E2E / Cal.diy / Grafana). **Never** workflow-level `paths-ignore` on `ci.yml` (GitHub Pending trap). Empty or unrecognized diffs run L1 (same as Prisma / Next fail-open to “run tests”), never silently become docs-only.
4. Sentinel / `required` job that always starts (`if: always()`), so a future required check has a stable name (Next `thank you, next`, Vite `test-passed`, Cal.diy `required`, Grafana `All E2E tests complete`, Twenty `*-status-check`).
5. Large browser suite off the default PR critical path; keep it on `main`, schedule, label, and dispatch. Two first-party policies disagree: Cal.diy **blocks merge** of code PRs until labeled e2e runs; Twenty **does not**. WiseEff takes the Next-shaped middle: cheap L1 + `@ci-smoke` on every product PR (no label), full L2 on `main` / nightly / `full-acceptance`.
6. One Playwright process per suite, not three quality boots (Playwright CI + our measured 3+3+5 minute quality steps). Vitest splits unit/e2e onto separate runners rather than one serial machine.
7. `timeout-minutes` on every job (Vite 20, Playwright install-test 45, Turbo example 15). Shard matrices use `fail-fast: false`.
8. Do not adopt Nx/Turbo or shard the shared-DB suite in this plan. Do not cache Playwright browsers (Playwright CI docs; Playwright's own `run-test` does not cache).

---

## WiseEff baseline (why this is blocking)

Measured on 2026-08-17 green run [`32000206916`](https://github.com/tzrea1-Q/WiseEff/actions/runs/32000206916) and the 2026-08-18 workflow file:

- Wall clock **38 min 32 s**. Critical path is `Acceptance local non-HDC` (2309 s). `Build and test` is 596 s and is hidden behind acceptance.
- Acceptance breakdown: browser 1519 s, responsive 277 s, a11y 182 s, visual 163 s, seed 59 s. Four separate Playwright processes, each with `CI` so `reuseExistingServer` is false.
- `workers: 1` / `fullyParallel: false` in both Playwright configs. Shared seed database. Topology / semantic specs boot a second disposable Postgres + API + Vite inside the serial queue.
- `scripts/check-acceptance-ci.ts` requires the workflow text to contain four independent commands (`acceptance:a11y`, `acceptance:visual`, `acceptance:responsive`, `acceptance:browser -- --mode local-non-hdc`). That ratchet freezes the slow shape.
- `docs/developer/verification-matrix.md` already says documentation-only work is `docs:check` locally. CI ignores that.
- No `concurrency`, no `timeout-minutes`, no path filter. Recent `main` redness made every later PR pay ~20 minutes of quality gates before a late acceptance import error.

This plan does not fix product acceptance failures (TD-079 and friends). It stops those failures from costing 40 minutes of queue to discover, and stops green docs PRs from costing 38 minutes.

---

## Settled decisions

1. **The merge bar is L1, not today's L2.** Full local-non-HDC plus evidence archive remains mandatory on `main`, on a nightly schedule, on label `full-acceptance`, and on `workflow_dispatch` mode `local-non-hdc`. It is not required to start on every feature-branch push.
2. **Smoke is not “skip e2e until a human labels the PR”.** Cal.diy's `ready-for-e2e` still **blocks** code-PR merge until full e2e runs; the cost is waiting on a label. Twenty's unlabeled PR stays green with no Playwright. Neither matches this repo's merge-to-`main` pace. Product-path PRs always run a tagged `@ci-smoke` subset (existing specs, ≤ 5 tests, no disposable-DB specs). Label `full-acceptance` opts a PR *into* L2 before merge.
3. **Docs-only PRs run L0 + `docs:check` (+ script tests if `scripts/check-doc-governance*` or `docs` checkers change) and the sentinel.** They do not install Playwright, DTS, or seed Aurora.
4. **One Playwright invocation for M5.11 quality** when quality runs. Keep `acceptance:a11y` / `visual` / `responsive` as local narrow scripts. CI calls `acceptance:quality` (or one `playwright test --config playwright.quality.config.ts` without a single-project filter). Set `WISEEFF_QUALITY_SKIP_SEED=true` after the job-level migrate/seed.
5. **No Nx, no Turborepo, no self-hosted runners, no browser-binary cache** in this plan.
6. **Do not shard the shared-DB acceptance job** until a later isolation change (out of scope). Wave 2 may run quality and full acceptance as sibling jobs and may shard quality routes only.
7. **Required GitHub check, when humans turn protection on, is the sentinel job name** (`CI / required` or `CI / Merge bar`), not `Acceptance local non-HDC`. Skipped L2 must not fail the PR. The `ci.yml` workflow must **always start** on every PR; expensive jobs skip via `if:` only.
8. **`latest-full.json` and M5.10 evidence index stay full-run only.** Smoke uses the existing focused-run namespace and must not publish `latest-full`.
9. **Full-pilot stays manual and non-default.** Unchanged.
10. **Wave 0 may merge without Wave 1** if review wants a no-contract PR first. Wave 1 is the actual feedback-loop fix.
11. **Cancel stale PR runs only.** `main` / nightly / dispatch L2 is not cancelled by a later SHA (Postgres + seed is expensive to restart).

---

## Scope

Includes:

- Rewrite `.github/workflows/ci.yml` in waves.
- Rewrite `scripts/check-acceptance-ci.ts` + tests so the ratchet describes layers, not four serial Playwright process names.
- Tag a `@ci-smoke` subset; add `acceptance:smoke` script.
- Update verification matrix, testing-strategy M5.12 text (EN is currently missing the section that ZH already has), QUALITY_SCORE CI note, and the M5.12 “PR/push runs full local-non-HDC” sentence.
- `timeout-minutes`, concurrency, docs-only detect, sentinel job.

Excludes:

- Fixing currently red acceptance specs.
- Changing product UI behavior.
- Isolating the shared acceptance database for `workers > 1`.
- Adopting Nx/Turbo remote cache.
- Making `full-pilot` a PR default.
- Required-status-check clicks in GitHub settings (documented for a human; agents cannot set them).

---

## Git & PR Workflow

| Role | Allowed |
| --- | --- |
| Implementation agent | Commit on `feat/ci-feedback-loop` (or `feat/ci-hygiene` then rebase onto a Wave 1 branch); do not open or merge GitHub PRs |
| Parent agent | Review, run verification, open/merge the PR, then sync local `main` |

**Landing decision (2026-08-18):** Wave 0+1 landed in **one** PR (#523). #524 added the L1 `@playwright/test` ratchet. Wave 2 landed in #525 after measuring green `main` L2 at 35m20s; first Wave 2 `main` L2 was 31m12s wall.

---

## Wave 0 — Hygiene (no M5.12 layer change)

Still runs today's full L2 on every **product** PR. Removes waste around it.

- [x] Limit `on.push` to `main`. Keep `pull_request` and `workflow_dispatch`. Do **not** add `on.paths` / `paths-ignore` (workflow-level skip → required check Pending).
- [x] Add workflow `concurrency` with `group: ${{ github.workflow }}-${{ github.event.pull_request.number || github.run_id }}` and `cancel-in-progress: ${{ github.event_name == 'pull_request' }}` (Grafana / Playwright: cancel stale PRs only).
- [x] Add `timeout-minutes`: 20 on `build-and-test`, 50 on acceptance.
- [x] Add L0 changed-files **job**. If the diff vs base is only `docs/**`, `**/*.md`, and `.github/**` excluding `workflows/ci.yml` / `workflows/log-analysis-quality-gate.yml`, skip heavy jobs via `if:` (except `docs:check` + `test:scripts` when those paths warrant it). Mirror Vite: workflow still starts; `ci.yml` itself is never in the skip set.
- [x] Add a sentinel job `required` / `merge-bar` that is `if: always()` and fails only when a job that was *supposed* to run failed (Next `thank you, next` / Cal.diy / Grafana placeholder). Skipped L2 on a product PR must not fail the sentinel (Twenty-style, not Cal.diy-style).
- [x] Set `WISEEFF_QUALITY_SKIP_SEED=true` on the local acceptance job after the existing `db:seed:all` step.
- [x] Collapse the three quality steps into one Playwright process (`acceptance:quality-run` running all quality projects). Update `check-acceptance-ci` tokens so the ratchet accepts one quality invocation plus the four script names still existing in `package.json`.
- [x] Put cheap steps before expensive ones inside `build-and-test` (already mostly true). Do **not** make acceptance `needs: build-and-test` in Wave 0 (that would serialize 10+38). Fail-fast for import/config errors stays a Wave 1 smoke concern.

**Wave 0 success:** docs-only PR wall clock ≤ 5 minutes; product PR wall clock ≤ 35 minutes (quality cold-starts paid once); one commit no longer starts two 38-minute runs; a superseded PR push cancels the old run (does not cancel an in-flight `main` L2). No workflow-level `on.paths` on `ci.yml`.

**Wave 0 verification:** `npm test -- scripts/check-acceptance-ci.test.ts`; `npm run acceptance:ci`; `npm run docs:check`; `git diff --check`. After merge, confirm on a docs PR and a no-op product PR via `gh run view`.

---

## Wave 1 — Layered merge bar (M5.12 contract change)

This is the plan's actual product decision.

- [x] Define path classes in L0 (implementation may use `dorny/paths-filter@v3` like Cal.diy / Supabase, or a small `scripts/ci-changed-paths.ts` with tests):
  - `docs-only` — Wave 0 definition
  - `ui` — `src/**`, `e2e/quality/**`, `index.html`, CSS tokens, public assets
  - `product` — `src/**`, `server/**`, `e2e/**`, `packages/**`, `playwright*.ts`, migrations, seed scripts, `package.json` / lockfile
  - `workflow` — `.github/workflows/**`, `scripts/check-acceptance-ci.ts`
- [x] L1 `build-and-test` stays required for `product` and `workflow`.
- [x] L1 quality-once runs when `ui` or `product` (not `docs-only`).
- [x] Add `acceptance:smoke`: Playwright acceptance config, grep `@ci-smoke`, `workers: 1`. Tag existing cheap tests only (must include shell/workflow A; must not include disposable-DB specs, HDC, ADB, or topology). Target ≤ 8 minutes including one API+Vite boot.
- [x] L2 full job `if:` `github.ref == 'refs/heads/main'` on push, or `github.event_name == 'schedule'`, or PR label `full-acceptance`, or `workflow_dispatch` with `local-non-hdc`. Keep artifact upload on L2.
- [x] Nightly schedule (e.g. `30 18 * * *` UTC) runs L1 + L2 on `main`.
- [x] Rewrite `requiredAcceptanceCiWorkflowTokens` to require: layered job ids, smoke script, full-job artifact paths, `full-acceptance` label or equivalent `if:`, sentinel, and the existing target-synthetic / full-pilot-not-default rules. Stop requiring three separate `npm run acceptance:a11y|visual|responsive` lines in the workflow text.
- [x] Update EN+ZH verification-matrix M5.12 paragraph: PR proves L1 (+ smoke on product paths); L2 proves local-non-HDC evidence on `main` / nightly / label / dispatch.
- [x] Add the missing English testing-strategy M5.12 section (ZH already has §8) and retarget it to layers. Update ZH §8 in the same change.
- [x] QUALITY_SCORE: one-line note that PR CI is the merge bar, not the full evidence archive.
- [x] Document for a human: after Wave 1, set the GitHub required check to the sentinel job only.

**Wave 1 success:** typical product PR wall clock 10–15 minutes; docs-only ≤ 5 minutes; `main` still produces full Playwright reports and operation evidence artifacts; `npm run acceptance:browser` locally unchanged; `latest-full.json` still only from a clean full run.

**Wave 1 verification:** unit tests for the path classifier and the new ratchet; `acceptance:ci`; `docs:check`; a dry `acceptance:smoke` locally against an already-seeded DB if Postgres is available (do not claim L2 green from smoke). After merge, compare `gh run list` wall clocks for a docs PR, a frontend PR, and a `main` push.

---

## Wave 2 — Make remaining L2 cheaper (after Wave 1 measurement)

Measured on 2026-08-18 `main` push after #522 ([`32105098601`](https://github.com/tzrea1-Q/WiseEff/actions/runs/32105098601)): run wall **36m29s**, `Acceptance local non-HDC` **35m20s**. Breakdown: setup ~2m50s, quality-run **6m45s**, browser **25m39s**. Split expected wall ≈ setup + browser ≈ **29 min**. The original ≤25 min target is blocked by the shared-DB browser suite (do not shard).

- [x] Split L2 quality and L2 browser acceptance into sibling jobs (two boots: reuse `acceptance-quality` on L2 events; L2 job is browser + models + evidence).
- [x] Cache `.wiseeff-tools/dts-toolchain` keyed on `tools/dts-toolchain/versions.json` + `requirements.txt` via `.github/actions/setup-dts-toolchain` (DTS only; do not cache Playwright browsers).
- [x] Persist ESLint cache with `actions/cache` (L1 lint was 24s).
- [ ] Optional quality-route shard — **skipped**: after the split, quality is not on the wall-clock critical path.
- [ ] Optional `--only-changed` pre-step — **skipped**: does not help `main` L2.

**Wave 2 success:** quality off the L2 critical path; expected wall ≈ 29 min. Hitting 25 min needs a faster browser suite or shared-DB isolation (TD-118 remainder).

---

## Expected files

Modify:

- `.github/workflows/ci.yml`
- `scripts/check-acceptance-ci.ts`
- `scripts/check-acceptance-ci.test.ts`
- `package.json` (`acceptance:smoke`; `acceptance:quality` must actually run all quality projects)
- `playwright.acceptance.config.ts` / selected `e2e/acceptance/*.spec.ts` (`@ci-smoke` tags only)
- `docs/developer/verification-matrix.md` + `docs/zh-CN/developer/verification-matrix.md`
- `docs/design-docs/testing-strategy.md` + `docs/zh-CN/design-docs/testing-strategy.md`
- `docs/QUALITY_SCORE.md` + `docs/zh-CN/QUALITY_SCORE.md` (one factual CI sentence)
- `docs/PLANS.md` + `docs/zh-CN/PLANS.md` (this plan listed while active)
- `docs/exec-plans/active/development-roadmap.md` (Current Active Focus pointer)

Create only if a path classifier is easier to test than YAML:

- `scripts/ci-changed-paths.ts`
- `scripts/ci-changed-paths.test.ts`
- `.github/actions/setup-dts-toolchain/action.yml` (Wave 2 DTS cache)

Do not create Nx/Turbo config.

---

## Risks

| Risk | Mitigation |
| --- | --- |
| A PR skips L2 and merges a browser regression | Smoke covers shell + one API/DB path; L2 runs on `main` the same hour; label `full-acceptance` for acceptance-heavy PRs; humans can require the sentinel plus L2 on selected paths later |
| Required-check UI still points at the old job name | Sentinel + runbook sentence; Wave 1 does not enable protection automatically |
| Workflow-level `paths-ignore` on `ci.yml` | Forbidden; job `if:` only (GitHub / Supabase Docs E2E: skipped workflow → Pending) |
| Sentinel copies Cal.diy and fails when L2 is skipped | Product-PR L2 skip is Success (Twenty-style). Cal.diy-style “skipped e2e fails required” is only for their labeled full suite, not our default PR |
| `check-acceptance-ci` tests lock the old four-command shape | Rewrite tests in the same PR as the workflow |
| Path classifier misses `src/` via a docs-looking rename | Treat lockfile, `package.json`, and workflow edits as `product` / `workflow`; fail closed to L1 when detection errors |
| Smoke set grows into a second full suite | Cap at 5 tagged tests; ratchet a comment in `check-acceptance-ci` or a unit test that counts `@ci-smoke` |
| Wave 0 docs-only skip looks like a coverage drop | Sentinel + `docs:check`; verification-matrix already defined that local gate |

---

## Implementation Contract (locked for this PR)

Seams under test: `classifyChangedPaths`, `evaluateAcceptanceCiConfiguration` (layered tokens + `@ci-smoke` count), existing quality-gate metadata. No new product UI seams.

### Job graph

`on.push.branches: [main]` · `pull_request` types `opened, synchronize, reopened, labeled` · `schedule: 30 18 * * *` (UTC) · existing `workflow_dispatch`. **No** workflow-level `paths`.

```
detect                 always (classify + `docs:check`)
build-and-test         if run_l1
acceptance-quality     if run_quality
acceptance-smoke       if run_smoke
acceptance-local-non-hdc  if run_l2
target-synthetic-acceptance  dispatch && mode != local-non-hdc
required (name: Merge bar)   if: always()
```

`concurrency.group`: `${{ github.workflow }}-${{ github.event.pull_request.number || github.run_id }}`  
`cancel-in-progress`: `${{ github.event_name == 'pull_request' }}`

| Event | run_l1 | run_quality | run_smoke | run_l2 |
| --- | --- | --- | --- | --- |
| Docs-only PR | no | no | no | no |
| UI-only PR (e.g. `public/**` only) | yes | yes | no | no |
| Product PR | yes | yes | yes | only if label `full-acceptance` |
| Workflow PR (`ci.yml` / ratchet) | yes | no unless also ui/product | yes | only if labeled |
| `push` `main` / nightly | yes | yes (sibling job, not inside L2) | no (L2 covers) | yes (browser + evidence) |
| `workflow_dispatch` `local-non-hdc` | no | yes | no | yes |
| `workflow_dispatch` target / full-pilot | no | no | no | no (target job only) |

Empty or unrecognized diffs → run L1 + quality + smoke (fail-open). `main` / schedule ignore the file list and force the row above.

Sentinel fails on `failure` or `cancelled` of a needed job; `skipped` is success (Twenty-style).

Timeouts: detect 5 · docs-governance 10 · build-and-test 20 · quality 25 · smoke 20 · L2 50 · target 50 · required 5.

### Path classes (`scripts/ci-changed-paths.ts`)

- **docs-inert:** `docs/**`, `**/*.md`, `.github/**` except `.github/workflows/ci.yml` and `.github/workflows/log-analysis-quality-gate.yml`
- **workflow:** `.github/workflows/**`, `.github/actions/**`, `scripts/check-acceptance-ci.ts`, `scripts/ci-changed-paths.ts` (+ their tests)
- **product:** `src/**`, `server/**`, `e2e/**`, `packages/**`, root `playwright*.ts`, migrations, seed/`db` scripts, `package.json` / lockfile / `.nvmrc` / Vite+Vitest config
- **ui:** `src/**`, `e2e/quality/**`, `index.html`, `**/*.css`, `public/**`
- Unknown path → product

`docsOnly` only when every path is docs-inert. `runL1 = !docsOnly`. `runQuality = ui || product`. `runSmoke = product || workflow`.

### Quality collapse

`acceptance:quality` stays the **metadata** checker (`check-quality-gates.ts`). Do not overload it.

New `acceptance:quality-run` = `playwright test --config playwright.quality.config.ts` (warmup + a11y + visual + responsive, **one** webServer). Local `acceptance:a11y|visual|responsive` stay. L2 and target synthetic call `acceptance:quality-run` instead of three npm lines. After job-level `db:seed:all`, set `WISEEFF_QUALITY_SKIP_SEED=true`.

### Smoke set (cap 5, ship 3)

Playwright tags `@ci-smoke`. Script: `acceptance:smoke` lists only warmup + the three smoke specs (do not load the full `e2e/acceptance` tree; unrelated specs currently import `@playwright/test` and would fail collection). Grep is `@ci-smoke|warm vite entry graph`. Set `WISEEFF_ACCEPTANCE_EVIDENCE_RUN_ID=focused-ci-smoke` (must not publish `latest-full.json`).

| Spec | Test | Why |
| --- | --- | --- |
| `shell-navigation.acceptance.spec.ts` | `loads / without a runtime crash` | Workflow A shell |
| `auth-runtime.acceptance.spec.ts` | local HMAC current-user load | Auth/API |
| `parameter-home.acceptance.spec.ts` | summary + hotspots APIs | Product API/DB |

No topology, HDC, ADB, disposable-DB specs.

### Ratchet

`check-acceptance-ci` must require: job ids `detect`, `required`, `acceptance-smoke`, `acceptance-local-non-hdc`, `target-synthetic-acceptance`; scripts `acceptance:smoke` and `acceptance:quality-run`; L2 tokens `npm run acceptance:quality-run` and `npm run acceptance:browser -- --mode local-non-hdc`; `full-acceptance`; concurrency; artifact paths; target/full-pilot `--no-start-runtime`; pgvector; Playwright Chromium install; `./.github/actions/setup-dts-toolchain`. **Stop** requiring three separate `npm run acceptance:a11y|visual|responsive` lines in the workflow text. Keep those scripts in `package.json`. Fail if `@ci-smoke` count is 0 or > 5.

### Wave 2

Landed in #525. First Wave 2 `main` L2 ([`32109015523`](https://github.com/tzrea1-Q/WiseEff/actions/runs/32109015523)): wall **31m12s**, browser job 30m22s, quality sibling 8m1s. Quality is the existing `acceptance-quality` job on L2 events; the L2 job no longer runs `acceptance:quality-run`. DTS setup is a composite action with `actions/cache`. TD-118 remainder is the shared-DB browser suite (27m in that run).

### Follow-up after #523

`main` L2 on #523 failed in collection: two specs imported `@playwright/test` (package not installed; the repo uses `playwright/test`). Those files were corrected on `main` via #522. #524 makes `acceptance:ci` fail closed on that import and runs it on L1. First green `main` L2 after the import fix: [`32105098601`](https://github.com/tzrea1-Q/WiseEff/actions/runs/32105098601) (35m20s job / 36m29s wall).

---

## UI Interaction Automation Review

This plan changes CI scheduling and evidence *when* the existing suite runs. It does not change user-facing interaction behavior.

- Affected specs: existing `e2e/acceptance/*.acceptance.spec.ts` (tags only). No new requirement IDs.
- Coverage map / operation matrix: no new IDs. Smoke must not satisfy a required ID that only the full spec proves.
- Evidence: L2 still runs `acceptance:browser` and uploads the same artifact paths. Smoke must not publish `latest-full.json`.

---

## Documentation Impact Matrix

| Area | Status | Files | Notes |
| --- | --- | --- | --- |
| Repository maps | Review | `AGENTS.md`, `docs/README.md` | Commands stay in the verification matrix; no map rewrite unless a new top-level CI command is added. |
| Planning docs | Update | `docs/PLANS.md`, `docs/zh-CN/PLANS.md`, `docs/exec-plans/active/development-roadmap.md`, this plan + Chinese companion | List the active plan. Archive both languages together when complete. |
| Product specs | No change | `docs/product-specs/` | No product workflow change. |
| Architecture docs | No change | `ARCHITECTURE.md`, `docs/design-docs/full-stack-architecture.md` | Runtime architecture unchanged. |
| Quality/testing docs | Update | `docs/developer/verification-matrix.md`, `docs/zh-CN/developer/verification-matrix.md`, `docs/design-docs/testing-strategy.md`, `docs/zh-CN/design-docs/testing-strategy.md`, `docs/QUALITY_SCORE.md`, `docs/zh-CN/QUALITY_SCORE.md` | Retarget M5.12: PR = L1/smoke; `main`/nightly/label = L2 evidence. Add the missing EN testing-strategy M5.12 section. |
| Reliability/runbooks | Review | `docs/runbooks/manual-acceptance.md`, `docs/zh-CN/manual-acceptance.md` | Update only if CI artifact / mode text still says “every PR runs full local-non-HDC”. |
| Security/governance docs | Review | `docs/SECURITY.md`, `docs/security/` | Secrets and `permissions: contents: read` stay; no authz change. |
| Frontend/design docs | No change | `docs/FRONTEND.md`, `docs/DESIGN.md` | No UI or token change. |
| Generated artifacts | Review | `docs/generated/acceptance-*` | Still produced by L2, not by smoke. |
| References | No change | `docs/references/` | Research lives in this plan, not a second note. |
| Chinese developer docs | Update | `docs/zh-CN/exec-plans/completed/2026-08-18-ci-feedback-loop-optimization.md` plus the ZH quality/testing rows above | Companion required because the merge-bar rule is developer-facing. |

---

## Documentation Update Gate

- `npm run docs:check` must pass before this plan moves to `completed/`.
- Every `Update` row must be updated in the Wave that makes it true (Wave 0: planning indexes; Wave 1: M5.12 contract docs).
- Every `Review` row must be unchanged with evidence or updated in the same Wave.
- Deferred work goes to `docs/exec-plans/tech-debt-tracker.md` (for example “shared-DB acceptance isolation so L2 can shard”).

---

## Verification

```bash
npm test -- scripts/check-acceptance-ci.test.ts
npm run test:scripts -- scripts/check-acceptance-ci.test.ts
npm run acceptance:ci
npm run docs:check
git diff --check
```

After each merged Wave, record in the PR:

- `gh run list --workflow=ci.yml --limit 10` with event, conclusion, and duration
- One docs-only sample URL
- One product-PR sample URL
- After Wave 1, one `main` L2 artifact URL proving evidence still uploaded

Recorded 2026-08-18:

| Sample | URL | Wall / notes |
| --- | --- | --- |
| Product PR (Wave 1) | [32102487377](https://github.com/tzrea1-Q/WiseEff/actions/runs/32102487377) (#523) | ~11 min; L2 skipped; Merge bar green |
| Workflow PR (Wave 2) | [32108148756](https://github.com/tzrea1-Q/WiseEff/actions/runs/32108148756) (#525) | ~11 min; quality+L2 skipped |
| Wave 1 `main` L2 | [32105098601](https://github.com/tzrea1-Q/WiseEff/actions/runs/32105098601) | 36m29s wall; L2 job 35m20s (quality 6m45s + browser 25m39s) |
| Wave 2 `main` L2 | [32109015523](https://github.com/tzrea1-Q/WiseEff/actions/runs/32109015523) | **31m12s** wall; L2 browser job 30m22s (browser 27m); quality sibling 8m1s hidden; evidence uploaded |

Human follow-up: if branch protection is enabled, require **Merge bar** only.
