# PCW workbench shell wave-3 — navigation / load / canvas / activity sessions

> Status: **Complete** — shell `wc -l` = **1496** (≤ ~1500 soft gate); stretch 800–1000 residual; closes #258 via #273–#278
> Date: 2026-08-09
> Chinese: [`docs/zh-CN/exec-plans/completed/2026-08-09-pcw-workbench-shell-wave-3.md`](../../zh-CN/exec-plans/completed/2026-08-09-pcw-workbench-shell-wave-3.md)
> Parent program: [#258](https://github.com/tzrea1-Q/WiseEff/issues/258) (wave-1 PR #266; wave-2 PR #272; wave-3 #273–#278)
> Locked design: [`docs/design-docs/2026-08-06-project-configuration-workbench-design.md`](../../design-docs/2026-08-06-project-configuration-workbench-design.md) §16

## Context

Wave-1 extracted domain Workbench sessions; wave-2 extracted presentation adapters plus `ConfigSetOpsSession`. The shell [`ProjectConfigurationWorkbench.tsx`](../../../src/components/project-configuration-workbench/ProjectConfigurationWorkbench.tsx) is ~**2407** lines after PR #272. Remaining bulk is orchestration: URL/selection sync, workspace loads, canvas history/compare sources, and Activity load + event→navigate — not more dock JSX.

Grill decisions (2026-08-09, wave-3):

| ID | Decision |
| --- | --- |
| W3-D1 | Soft close gate: shell is selection / URL / ConfirmDialog + session wiring; **≤ ~1500** LOC may close #258; **800–1000** is stretch |
| W3-D2 | Extract four Workbench sessions: Navigation (incl. unified search), WorkspaceLoad, CanvasHistory, Activity |
| W3-D3 | Continue under #258 with a new wave-3 parent ticket + children |
| W3-D4 | Out: server ReleaseUnit, WorkingConfiguration move, ADR-0018 upload closure, wide port file splits (review C2–C5) |
| W3-D5 | Strangler order: Navigation → WorkspaceLoad → CanvasHistory → Activity → verify |
| W3-D6 | All four are Workbench sessions (CONTEXT glossary updated) |
| W3-D7 | WorkspaceLoad = configSets / project files / members / active source / structure (+ retries); not versions or readiness/baselines |
| W3-D8 | Navigation commands: select config set / member / structure target, apply URL, runSearch, selectSearchHit |
| W3-D9 | CanvasHistory owns history / unified-diff / side-by-side only; candidate source stays on CandidateVersionFlow |
| W3-D10 | Five child tickets; no mid-wave LOC gates |
| W3-D11 | One branch `feat/pcw-workbench-shell-wave-3`, one PR |
| W3-D12 | Exec-plan EN/ZH first (this file), then GitHub tickets |

## Goal

1. Extract **WorkbenchNavigationSession** (URL/selection + unified search).
2. Extract **WorkbenchWorkspaceLoadSession** (configSets / files / members / active source / structure loads + retries).
3. Extract **WorkbenchCanvasHistorySession** (history/compare source load + enter/exit working snapshot).
4. Extract **WorkbenchActivitySession** (timeline load/present + event→navigate).
5. Verify shell ≤ ~1500 LOC and orchestration-focused; update module-map docs; **close #258** when the soft gate is met.

## Non-goals

- Hard requirement of ≤ 1000 shell LOC (stretch only).
- Review candidates C2–C5 (ReleaseUnit, WorkingConfiguration tip locality, wide port splits, candidate vocabulary / conflict module merge).
- Product behaviour changes to governance, release, candidate CAS, or conflict outcomes.
- Moving file-versions load or readiness/baseline refresh into WorkspaceLoad.

## Architecture

```text
ProjectConfigurationWorkbench (shell: ConfirmDialog + wire sessions)
├─ presentation adapters (wave-2…)
└─ application/project-configuration/
   ├─ (wave-1/2 sessions…)
   ├─ WorkbenchNavigationSession      ← NEW
   ├─ WorkbenchWorkspaceLoadSession   ← NEW
   ├─ WorkbenchCanvasHistorySession   ← NEW
   └─ WorkbenchActivitySession        ← NEW
```

Shell keeps: ConfirmDialog ownership, cross-session bridges (`isDirty` → release gates), and thin prop wiring into existing docks/adapters.

## Strangler order

1. **Navigation** — selection + URL apply + search.
2. **WorkspaceLoad** — cancelable loads + retry tokens for working configuration reads.
3. **CanvasHistory** — non-working history/compare sources; leave candidate bytes on CandidateVersionFlow.
4. **Activity** — audit list via injected AuditQuery + deep-link restore via Navigation.
5. **Slim verify + docs** — `wc -l` ≤ ~1500, FRONTEND/design §16, close #258.

## Git & PR Workflow

| Role | Allowed |
| --- | --- |
| Implementation agent | Branch from latest `main` **after #272 merges**; commit on feature branch; do not open/merge PRs |
| Parent agent | Review, open/merge PR, sync local `main` |

Branch: `feat/pcw-workbench-shell-wave-3` from `origin/main` (post-#272).

## Tasks / tickets

Tracked as GitHub children of [#273](https://github.com/tzrea1-Q/WiseEff/issues/273):

| Order | Issue | Work | Acceptance sketch |
| --- | --- | --- |
| T1 | [#274](https://github.com/tzrea1-Q/WiseEff/issues/274) | `WorkbenchNavigationSession` | URL/selection + search commands live in session; deep-link regressions green |
| T2 | [#275](https://github.com/tzrea1-Q/WiseEff/issues/275) | `WorkbenchWorkspaceLoadSession` | Working loads/retries leave the shell; cancelable effects preserved |
| T3 | [#276](https://github.com/tzrea1-Q/WiseEff/issues/276) | `WorkbenchCanvasHistorySession` | History/compare enter/exit + source load in session; candidate source unchanged |
| T4 | [#277](https://github.com/tzrea1-Q/WiseEff/issues/277) | `WorkbenchActivitySession` | Activity load + event locate via session; shell does not own timeline state machine |
| T5 | [#278](https://github.com/tzrea1-Q/WiseEff/issues/278) | Slim verify + docs | Shell ≤ ~1500; docs module map; close #258 |

## Verification

```bash
npx vitest run src/application/project-configuration/ src/components/project-configuration-workbench/
npm run build
wc -l src/components/project-configuration-workbench/ProjectConfigurationWorkbench.tsx
npm run docs:check
```

Frontend-visible session wiring requires playwright-cli checks per `AGENTS.md` on affected routes/viewports.

## Documentation Impact Matrix

| Area | Action | Paths |
| --- | --- | --- |
| Repository maps | Review | `AGENTS.md`, `ARCHITECTURE.md` |
| Planning | Update | this plan; `docs/PLANS.md` / `docs/zh-CN/PLANS.md` |
| Product specs | No change | — |
| Architecture / design | Update | design §16 EN/ZH module map when sessions land |
| Frontend docs | Update | `docs/FRONTEND.md`, `docs/zh-CN/frontend.md` Workbench sessions table |
| Quality / testing | Review | workbench component tests; no new acceptance ID unless behaviour changes |
| Reliability / runbooks | No change | — |
| Security | No change | — |
| Generated / references | No change | — |
| CONTEXT.md | Done (grill) | Workbench session examples include Navigation / Load / Canvas / Activity |

## Documentation Update Gate

Blocking before moving this plan to `completed/` and closing #258:

- [x] EN/ZH design §16 lists the four wave-3 sessions
- [x] EN/ZH FRONTEND Workbench sessions table includes them
- [x] `docs/PLANS.md` / zh-CN companion point at this plan while active, then move to completed/
- [x] `npm run docs:check` passes
- [x] Shell `wc -l` ≤ ~1500 with orchestration-only responsibilities; stretch 800–1000 noted if missed (**1496**; stretch residual)
- [x] #258 closed with completion evidence (or explicit residual debt if soft gate waived by owner)

## Risks

- Navigation and WorkspaceLoad couple tightly through selected identities — extract Navigation first so loads take stable inputs.
- Activity event→navigate must call Navigation commands, not re-implement URL patches in the Activity session.
- Soft LOC gate: if shell remains slightly above 1500 but is orchestration-only, record residual on #258 / tech-debt rather than force unsafe splits.
