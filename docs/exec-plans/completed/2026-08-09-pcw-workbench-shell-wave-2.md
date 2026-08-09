# PCW workbench shell wave-2 — presentation adapters + ConfigSetOps

> Status: **Complete** — shell ≤ ~2500 LOC; adapters + ConfigSetOpsSession landed on `feat/pcw-workbench-shell-wave-2`
> Date: 2026-08-09
> Chinese: [`docs/zh-CN/exec-plans/completed/2026-08-09-pcw-workbench-shell-wave-2.md`](../../zh-CN/exec-plans/completed/2026-08-09-pcw-workbench-shell-wave-2.md)
> Parent program: [#258](https://github.com/tzrea1-Q/WiseEff/issues/258) (wave-1 sessions landed in PR #266)
> Locked design: [`docs/design-docs/2026-08-06-project-configuration-workbench-design.md`](../../design-docs/2026-08-06-project-configuration-workbench-design.md) §16

## Context

Wave-1 (#259–#265 / PR #266) extracted Workbench sessions:

- `StructuredEditSession`
- `CandidateVersionFlow`
- `ReleaseBaselineSession`
- `ConflictLocateFacade`
- plus `AuditQuery` injection

The shell [`ProjectConfigurationWorkbench.tsx`](../../../src/components/project-configuration-workbench/ProjectConfigurationWorkbench.tsx) is still ~**4021** lines. Most remaining bulk is JSX presentation and config-set ops / URL / load orchestration — not the four domain sessions.

Grill decisions (2026-08-09):

| ID | Decision |
| --- | --- |
| W2-D1 | **Hybrid** wave: extract the largest presentation adapters first, then one deferred Workbench session (`ConfigSetOps`). |
| W2-D2 | Intermediate success bar: shell **≤ ~2500 lines** and orchestration-focused. Aspirational **800–1000** deferred to wave-3 (tree/search + canvas chrome + navigation/load session). |
| W2-D3 | **Implement from `main` only after PR #266 merges.** Planning and tickets may land before merge. |

## Goal

1. Extract **WorkbenchInspectorPanel** (largest JSX ~660) as a presentation adapter: props in / callbacks out; no new domain state machine.
2. Extract **WorkbenchCommandBar** (header chrome ~360, including create-config modal trigger wiring) as a presentation adapter.
3. Extract **ConfigSetOpsSession** for create config set / add-remove member / export / manual sync behind a narrow command interface under `src/application/project-configuration/`.
4. Verify shell LOC ≤ ~2500, update module-map docs, leave completion evidence on #258 (do not force-close #258 unless product owner asks).

## Non-goals

- Reaching 800–1000 shell LOC in this wave.
- Extracting unified search, source-canvas chrome, or a full Activity Workbench session (wave-3+).
- Server ReleaseUnit, wide port splits, ADR-0018 legacy upload, product behaviour changes.
- Stacking commits onto `feat/pcw-workbench-sessions` before #266 merges.

## Architecture

```text
ProjectConfigurationWorkbench (shell orchestrator)
├─ WorkbenchCommandBar          ← NEW presentation adapter
├─ tree / search / canvas         (stay in shell this wave)
├─ WorkbenchInspectorPanel      ← NEW presentation adapter
│  └─ existing BaselineDock / candidate blocks as children or slots
├─ task dock chrome               (stay; already thin vs inspector)
└─ application/project-configuration/
   ├─ (wave-1 sessions…)
   └─ ConfigSetOpsSession       ← NEW Workbench session
```

Shell keeps: URL/selection sync, ConfirmDialog ownership for destructive ops, wiring between sessions (`isDirty` → release gates), retry tokens for loads that remain in the shell.

## Strangler order

1. **Inspector presentation adapter** — move JSX + local-only UI state; shell passes data/callbacks.
2. **Command bar presentation adapter** — same pattern; preserve readiness summary + more-menu + upload candidate entry points.
3. **ConfigSetOpsSession** — move create/add/remove/export/sync command paths; shell keeps ConfirmDialog + navigation refresh.
4. **Slim verification + docs** — `wc -l` gate, FRONTEND/design §16, comment on #258.

## Git & PR Workflow

| Role | Allowed |
| --- | --- |
| Implementation agent | Branch from latest `main` **after #266 merges**; commit on feature branch; do not open/merge PRs |
| Parent agent | Review, open/merge PR, sync local `main` |

Branch: `feat/pcw-workbench-shell-wave-2` from `origin/main` (post-#266).

## Tasks / tickets

Tracked as GitHub children of [#267](https://github.com/tzrea1-Q/WiseEff/issues/267):

| Order | Issue | Work | Acceptance sketch |
| --- | --- | --- | --- |
| T1 | [#268](https://github.com/tzrea1-Q/WiseEff/issues/268) | `WorkbenchInspectorPanel` | Shell no longer inlines inspector level bodies; existing inspector/cutover tests green |
| T2 | [#269](https://github.com/tzrea1-Q/WiseEff/issues/269) | `WorkbenchCommandBar` | Header/actions/create-config entry live in adapter; command-bar regressions green |
| T3 | [#270](https://github.com/tzrea1-Q/WiseEff/issues/270) | `ConfigSetOpsSession` | Session owns ops commands + narrow repo Picks; unit tests; shell wires ConfirmDialog |
| T4 | [#271](https://github.com/tzrea1-Q/WiseEff/issues/271) | Slim verify + docs | Shell ≤ ~2500 LOC; docs module map; #258 evidence comment |

## Verification

```bash
npx vitest run src/application/project-configuration/ src/components/project-configuration-workbench/
npm run build
wc -l src/components/project-configuration-workbench/ProjectConfigurationWorkbench.tsx
npm run docs:check
```

Frontend-visible extractionsions require playwright-cli checks per `AGENTS.md` on affected routes/viewports when UI structure moves.

## Documentation Impact Matrix

| Area | Action | Paths |
| --- | --- | --- |
| Repository maps | Review | `AGENTS.md`, `ARCHITECTURE.md` |
| Planning | Update | this plan; `docs/PLANS.md` / `docs/zh-CN/PLANS.md` active list |
| Product specs | No change | — |
| Architecture / design | Update | design §16 EN/ZH module map when adapters land |
| Frontend docs | Update | `docs/FRONTEND.md`, `docs/zh-CN/frontend.md` Workbench sessions table |
| Quality / testing | Review | workbench component tests; no new acceptance ID unless behaviour changes |
| Reliability / runbooks | No change | — |
| Security | No change | — |
| Generated / references | No change | — |
| CONTEXT.md | Review | Workbench session term already covers ConfigSetOps |

## Documentation Update Gate

Blocking before moving this plan to `completed/`:

- [x] EN/ZH design §16 lists CommandBar + InspectorPanel adapters and ConfigSetOpsSession
- [x] EN/ZH FRONTEND Workbench sessions table includes ConfigSetOpsSession
- [x] `docs/PLANS.md` / zh-CN companion point at this plan while active, then move to completed/
- [x] `npm run docs:check` passes
- [x] Any deferred shell thinning (canvas/tree/Activity) recorded on #258 or tech-debt tracker

Note: wave-2 also extracted `WorkbenchSourceTree` / `WorkbenchSourceCanvas` / `WorkbenchTaskDock` / shell chrome+dialog adapters to meet the ≤ ~2500 intermediate gate; aspirational 800–1000 shell LOC remains wave-3.

## Risks

- Inspector extract without careful props will churn cutover query tests (`inspector=config-set` / file). Prefer mechanical JSX move first; keep URL override effects in the shell.
- ConfigSetOps ConfirmDialog must stay in the shell (same pattern as release/candidate) so focus/inert contracts stay centralized.
- LOC gate is a proxy: if adapters are huge but shell is thin, still count success by shell responsibilities + `wc -l` on the orchestrator file.
