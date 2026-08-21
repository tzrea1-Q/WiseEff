# Self-Hosted Operations Handbook

> Status: **Completed 2026-08-21**
> Date: 2026-08-21
> Branch: `codex/self-hosted-operations-handbook`

## Goal

Create one bilingual, operator-facing command handbook for the WiseEff Linux self-hosted runtime. It must route operators to the correct action for first setup, ordinary start/stop/restart, health and log inspection, upgrade/recovery, backup drills, monitoring, and incidents without weakening the detailed specialist runbooks.

## Scope

- Add `ops/self-hosted/operations.md` and `ops/self-hosted/operations.zh-CN.md`.
- Document commands that are safe to copy from the deployment checkout, and distinguish deployment-host commands from development/evidence-runner commands.
- Add a decision table, quick reference, data-safety invariants, and common-failure routing.
- Link the handbook from the self-hosted entry pages and the English/Chinese runbook indexes.
- Do not change runtime behavior or scripts.

## Git & PR Workflow

- Implement and verify on `codex/self-hosted-operations-handbook`, branched from current `main`.
- Open a GitHub PR after local gates pass.
- Merge only after required CI is green, then sync local `main`.

## Documentation Impact Matrix

| Area | Decision | Evidence / path |
| --- | --- | --- |
| Repository maps | Review | Root maps already route operations through `docs/runbooks/README.md`; update the runbook index only. |
| Planning docs | Update | This plan records scope and verification; archive it when complete. |
| Product specifications | No change | No product behavior changes. |
| Architecture | No change | No service or deployment topology changes. |
| Quality/testing | No change | Existing documentation-only gate remains authoritative. |
| Reliability/runbooks | Update | Add the handbook and link it from both runbook indexes. |
| Security/governance | Review | Preserve deployment-user, secret, backup, lock, proxy, and destructive-command boundaries already documented by setup/upgrade runbooks. |
| Frontend/design | No change | No user-visible application changes. |
| Generated artifacts | No change | No generated evidence changes. |
| References | No change | Specialist runbooks remain the detailed source of truth. |

## Tasks

- [x] Inventory public self-hosted script actions and existing runbooks.
- [x] Write the English handbook.
- [x] Write the separate linked Chinese handbook.
- [x] Update English and Chinese entry indexes.
- [x] Run `npm run docs:check`, `git diff --check`, and `npm run selfhost:check`.

## Documentation Update Gate

- [x] English and Chinese handbook pages link to each other.
- [x] Every copied command maps to an existing script, Compose action, or package script.
- [x] First setup, ordinary lifecycle, upgrade, recovery, backup, monitoring, and incident paths are distinguishable.
- [x] Data-loss hazards and `sudo` boundaries are explicit.
- [x] `npm run docs:check` passes.
- [x] `git diff --check` passes.

## Expected Outcome

A deployment operator can start at one page, choose the correct lifecycle action, copy the safe command, and follow a specialist runbook only when the operation requires deeper procedure or evidence.

## Verification Evidence

- `npm run docs:check` — passed; local pgvector canonical artifact check skipped because the extension is unavailable, as expected, and remains covered by CI.
- `npx vitest run --config vitest.scripts.config.ts scripts/check-doc-governance.test.ts` — 17 tests passed.
- `git diff --check` — passed.
- `npm run selfhost:check` — passed with no missing scripts, services, Compose tokens, environment keys, proxy tokens, or files.
