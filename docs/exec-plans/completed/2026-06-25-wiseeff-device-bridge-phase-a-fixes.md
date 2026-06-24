# Device Bridge Phase A — Sequential Fix Plan

**Status:** Completed (2026-06-25)

**Goal:** Close the gaps found in the Phase A architecture review so install → connect → detect works reliably on Windows and macOS without double-start or misleading wizard state.

**Prerequisite:** Phase A merged on `main` (PR #100).

**Execution rule:** Run tasks **in order**. Do not start the next task until the current task’s verification passes.

**Source review:** Phase A post-merge review (connect double-start, macOS LaunchAgent, wizard state, token expiry, URL hardening).

## Git & PR Workflow

All implementation for this plan follows the repository **branch → review → PR → merge** rule (see `docs/PLANS.md`).

| Role | Responsibility |
| --- | --- |
| Implementation agent (subagent) | Checkout feature branch from latest `main`, implement Steps 1–6, run verification, **local commits on branch only** |
| Parent agent (architect) | Review diff and verification output, create GitHub PR, merge PR, fast-forward **local** `main` |

**Branch for this plan:** `fix/device-bridge-phase-a-fixes` (from `origin/main`).

**Subagent must not:** push to `main`, open GitHub PRs, merge PRs, or update local `main`.

**Subagent start commands:**

```bash
git fetch origin main
git checkout main && git pull origin main
git checkout -b fix/device-bridge-phase-a-fixes
```

**Parent agent after review:**

```bash
gh pr create … && gh pr merge …   # or merge via GitHub UI
git checkout main && git pull origin main
```

---

## Task Sequence

| Step | Task | Primary files |
| --- | --- | --- |
| 1 | Non-blocking `connect` / `--handle-url` (no second blocking `start`) | `packages/device-bridge/src/connectCommand.ts`, `cli.ts`, tests |
| 2 | macOS `.pkg` postinstall LaunchAgent (remove build-machine side effect) | `ops/self-hosted/bridge-installer/macos/` |
| 3 | Token expiry → re-pair in `connect` | `packages/device-bridge/src/connectCommand.ts`, tests |
| 4 | Wizard panel status + 30s timeout error messages | `src/NodeDebuggingPage.tsx`, `LocalDeviceBridgeWizard.tsx`, tests |
| 5 | URL scheme input validation | `packages/device-bridge/src/urlScheme.ts`, tests |
| 6 | Tests + docs + manifest SHA256 (after Win/Mac installer build) | tests, runbook, `manifest.json`, move Phase A plan to `completed/` |

---

## Step 1 — Connect orchestration

**Problem:** URL scheme and `connect` call blocking `start`; conflicts with Windows Service and port `18787`.

**Done when:**

- `connect` / `--handle-url` exit within seconds (no `waitForTerminationSignal` in connect path).
- If local health is already `connected: true`, skip start.
- If offline, use non-blocking path (Windows `service start` and/or detached spawn).
- `npm run bridge:test -- packages/device-bridge/src/connectCommand.test.ts packages/device-bridge/src/cli.test.ts` passes.

---

## Step 2 — macOS LaunchAgent

**Problem:** LaunchAgent plist is written on the **build machine**, not installed for end users.

**Done when:**

- `postinstall` script registers `~/Library/LaunchAgents/com.wiseeff.bridge.plist` and loads it.
- Build script no longer writes LaunchAgent into builder `$HOME`.
- Runbook/README updated for macOS install behavior.

---

## Step 3 — Token expiry

**Problem:** Expired `tokenExpiresAt` skips re-pair when server URL matches.

**Done when:**

- Expired token + `--code` → re-pair then continue.
- Expired token without code → exit 1 with clear message.
- `connectCommand.test.ts` covers both cases.

---

## Step 4 — Wizard state machine

**Problem:** `paired` but WSS not connected shows Step 3 “insert USB”; timeout with `connected: false` is silent.

**Done when:**

- `paired && !connected` stays on Step 2 with accurate hint.
- Step 3 only when health `connected: true` and no device target.
- 30s timeout shows error when health exists but `connected: false`.
- Targeted frontend tests pass.

---

## Step 5 — URL hardening

**Problem:** `parseConnectUrl` accepts arbitrary `server` and unvalidated `code`.

**Done when:**

- Reject non `http(s)` server URLs (document localhost exception if needed).
- Reject non 6-digit codes when present.
- `urlScheme.test.ts` covers reject cases.

---

## Step 6 — Close out

**Done when:**

- New/updated unit tests for steps 1–5 are green.
- Real installer SHA256 in `ops/self-hosted/bridge-artifacts/0.1.0/manifest.json` (after Win/Mac build).
- `PHASE-A-DELIVERY.md` and runbooks note fixes.
- Phase A plan moved to `docs/exec-plans/completed/`; design spec marked Phase A implemented.
- `npm run docs:check` passes.

Manual (not blocking CI): clean Win/Mac VM — install → **连接本地设备** → health online ≤30s.

---

## Documentation Impact Matrix

| Area | File(s) | Action |
| --- | --- | --- |
| Repository maps | `docs/PLANS.md` | Update — add this plan |
| Product specs | `docs/product-specs/*` | No change |
| Architecture | `ARCHITECTURE.md` | No change |
| Runbooks | `docs/runbooks/local-device-bridge.md`, `docs/zh-CN/runbooks/local-device-bridge.md` | Update — steps 2, 5, 6 |
| Frontend docs | `docs/FRONTEND.md`, `docs/zh-CN/frontend.md` | Review — wizard status if Step 4 changes copy |
| Design spec | `docs/zh-CN/superpowers/specs/2026-06-24-device-bridge-zero-friction-design.md` | Update — Phase A implemented (Step 6) |
| Installer docs | `ops/self-hosted/bridge-installer/README.md`, `README.zh-CN.md`, `PHASE-A-DELIVERY.md` | Update — steps 2, 6 |
| Generated artifacts | `ops/self-hosted/bridge-artifacts/0.1.0/manifest.json` | Update — real installer SHA256 (Step 6) |
| Browser acceptance | `e2e/acceptance/local-device-bridge.acceptance.spec.ts` | Review — wizard assertions (Step 6) |
| Security | `docs/SECURITY.md` | Review — URL scheme exposure note (Step 5) |
| Phase A plan | `docs/exec-plans/active/2026-06-24-wiseeff-device-bridge-zero-friction-phase-a.md` | Move to `completed/` (Step 6) |

## Documentation Update Gate

Plan cannot move to `completed/` until:

- [ ] All `Update` rows above are committed or recorded unchanged with reason
- [ ] `npm run docs:check` passes
- [ ] Steps 1–5 verification commands pass

---

## Verification Matrix

```bash
# After each CLI step (1, 3, 5)
npm run bridge:test -- packages/device-bridge/src/connectCommand.test.ts packages/device-bridge/src/cli.test.ts packages/device-bridge/src/urlScheme.test.ts

# After step 4
npm test -- src/NodeDebuggingPage.test.tsx
# plus any new LocalDeviceBridgeWizard.test.tsx

# Before close (step 6)
npm run build
npm run docs:check
```
