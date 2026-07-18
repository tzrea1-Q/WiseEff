# Local non-HDC Readiness Gate Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore standard local non-HDC acceptance after the pilot-readiness API renamed `agentProvider` to `xiaozeLlm`, without weakening target/full-pilot gates.

**Architecture:** Keep the API contract authoritative and change only the preflight consumer's exact local allowlist. Preserve fail-closed behavior for unknown blockers, disabled runtime startup, and `--require-pilot-ready`; then run standard browser acceptance without `--skip-preflight` and report its actual result.

**Tech Stack:** TypeScript, Vitest, npm acceptance runners, Playwright, bilingual Markdown documentation.

**Design spec:** [`docs/superpowers/specs/2026-07-19-local-non-hdc-readiness-gate-compatibility-design.md`](../specs/2026-07-19-local-non-hdc-readiness-gate-compatibility-design.md)

---

## File Map

| Path | Responsibility |
| --- | --- |
| `scripts/run-acceptance-preflight.ts` | Interpret pilot-readiness for local, target, and full-pilot modes |
| `scripts/run-acceptance-preflight.test.ts` | Lock exact local blocker combinations and strict negatives |
| `docs/runbooks/manual-acceptance.md` | English operator contract |
| `docs/zh-CN/runbooks/manual-acceptance.md` | Chinese operator contract |
| Round6 English/Chinese active plans | Record diagnosis, implementation, and evidence |
| `docs/generated/acceptance-*` | Generated browser and operation evidence |

### Task 1: Fix the canonical readiness gate contract with TDD

**Files:**
- Modify: `scripts/run-acceptance-preflight.test.ts:227-283`
- Modify: `scripts/run-acceptance-preflight.ts:207-237`

- [ ] **Step 1: Replace stale positive expectations and add a legacy negative case**

Use these focused tests:

```ts
it("accepts local non-HDC readiness when deterministic Xiaoze and device gateway are the only blockers", () => {
  expect(
    evaluatePilotReadiness({ ok: false, status: "blocked", blockedBy: ["deviceGateway", "xiaozeLlm"] })
  ).toEqual({
    accepted: true,
    outcome: "non_hdc_local",
    detail: "Accepted for local non-HDC preflight; deviceGateway and xiaozeLlm remain blocked."
  });
});

it("accepts local non-HDC readiness when backup evidence is also blocked", () => {
  expect(
    evaluatePilotReadiness({
      ok: false,
      status: "blocked",
      blockedBy: ["deviceGateway", "xiaozeLlm", "backups"]
    })
  ).toEqual({
    accepted: true,
    outcome: "non_hdc_local",
    detail: "Accepted for local non-HDC preflight; deviceGateway, xiaozeLlm, and backups remain blocked."
  });
});

it("rejects the retired agentProvider gate name", () => {
  expect(
    evaluatePilotReadiness({ ok: false, status: "blocked", blockedBy: ["deviceGateway", "agentProvider"] })
  ).toMatchObject({ accepted: false, outcome: "blocked" });
});
```

Change the existing no-start negative input from `agentProvider` to `xiaozeLlm`.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npx vitest run scripts/run-acceptance-preflight.test.ts
```

Expected: FAIL because canonical `xiaozeLlm` combinations are rejected and the retired `agentProvider` combination is accepted.

- [ ] **Step 3: Implement the minimal canonical-name change**

In both local-only branches of `evaluatePilotReadiness`, use:

```ts
blockerSet.has("xiaozeLlm")
```

Return the exact canonical details from Step 1. Do not add aliases, wildcard matching, or changes to the `pilot_ready` branch.

- [ ] **Step 4: Run focused and related runner tests and verify GREEN**

```bash
npx vitest run scripts/run-acceptance-preflight.test.ts scripts/run-browser-acceptance.test.ts
```

Expected: both files PASS with no failed tests.

- [ ] **Step 5: Commit the tested evaluator fix**

```bash
git add scripts/run-acceptance-preflight.ts scripts/run-acceptance-preflight.test.ts
git commit -m "fix: align local readiness with xiaoze gate"
```

### Task 2: Update the bilingual operator contract

**Files:**
- Modify: `docs/runbooks/manual-acceptance.md:80,275`
- Modify: `docs/zh-CN/runbooks/manual-acceptance.md` matching paragraphs
- Modify: both Round6 active-plan files

- [ ] **Step 1: Replace stale operator wording**

The English runbook must say:

```markdown
When preflight starts the local deterministic Xiaoze runtime, it may also accept `deviceGateway` plus `xiaozeLlm`, with `backups` allowed only as the existing local non-customer evidence blocker; target and full-pilot modes remain strict.
```

The Chinese runbook must express the same contract with literal gate names.

- [ ] **Step 2: Record the diagnosed drift in both active plans**

Append a dated entry stating that the API returned `xiaozeLlm` while preflight checked `agentProvider`, and that local policy still yields only `non_hdc_local`. Keep TD-042 unchanged.

- [ ] **Step 3: Verify and commit documentation**

```bash
npm run docs:check
git diff --check
git add docs/runbooks/manual-acceptance.md docs/zh-CN/runbooks/manual-acceptance.md docs/exec-plans/active/2026-07-16-parameter-topology-round6-review-blockers.md docs/zh-CN/exec-plans/active/2026-07-16-parameter-topology-round6-review-blockers.md
git commit -m "docs: align local readiness gate terminology"
```

Expected: checks exit 0 before the commit.

### Task 3: Run clean-source standard acceptance and preserve honest evidence

**Files:**
- Modify when generated: `docs/generated/acceptance-browser-evidence.md`
- Modify when generated: `docs/generated/acceptance-operation-evidence.md`
- Modify when generated: `docs/generated/acceptance-operation-evidence/index.json`
- Modify: both Round6 active-plan files with actual results

- [ ] **Step 1: Run repository gates on the implementation commit**

```bash
npm run contract:check
npm run docs:check
npm run test:all
npm run build
npm run dts:toolchain:check
npm run dtc:seed:compile
npm run selfhost:check
git diff --check main...HEAD
git status --porcelain
```

Expected: commands exit 0 and status is empty before evidence generation.

- [ ] **Step 2: Prove standard preflight without bypass flags**

```bash
npm run acceptance:preflight
```

Expected: exit 0 with `Pilot outcome: non_hdc_local` and explicit blocked local gates. Do not use `--skip-gates`, `--skip-preflight`, or `--require-pilot-ready`.

- [ ] **Step 3: Run the standard local browser matrix**

```bash
npm run acceptance:browser -- --mode local-non-hdc
```

Expected for a complete local candidate: preflight and Playwright pass, workflows A-E and G-I pass, F is hardware-skipped, requirements are 59/59, and operations are 56/56.

If the shared `8787` API still fails due to incompatible auth/gateway state, preserve the report and diagnose that runtime boundary separately. Do not weaken preflight, authz, simulator, coverage, or evidence assertions.

- [ ] **Step 4: Validate immutable evidence**

After a passing browser matrix:

```bash
npm run acceptance:evidence
shasum -a 256 test-results/acceptance-evidence-runs/latest-full.json
```

Expected: no missing operation IDs, invalid records, or validation errors. Record run ID, source commit, and hash. If browser acceptance fails, evidence checking is diagnostic only and the failed run must not replace `latest-full`.

- [ ] **Step 5: Record and commit truthful evidence**

Update both active plans with exact results, then run:

```bash
npm run docs:check
git diff --check
git add docs/generated/acceptance-browser-evidence.md docs/generated/acceptance-operation-evidence.md docs/generated/acceptance-operation-evidence/index.json docs/exec-plans/active/2026-07-16-parameter-topology-round6-review-blockers.md docs/zh-CN/exec-plans/active/2026-07-16-parameter-topology-round6-review-blockers.md
git commit -m "docs: record standard local acceptance evidence"
```

Do not close TD-042 or claim target, production, full-pilot, or cutover readiness.
