# DTS-reload run distillation into knowledge drafts

> Status: **Active**
> Date: 2026-08-13
> Branch: `feat/knowledge-reload-distillation`
> Chinese: [`docs/zh-CN/exec-plans/active/2026-08-13-knowledge-reload-distillation.md`](../../zh-CN/exec-plans/active/2026-08-13-knowledge-reload-distillation.md)
> Design: [`docs/design-docs/2026-08-12-knowledge-base-design.md`](../../design-docs/2026-08-12-knowledge-base-design.md) — deferred roadmap item 3
> Predecessors: [`2026-08-12-knowledge-base-mvp.md`](../completed/2026-08-12-knowledge-base-mvp.md) (Phase 3 log distillation is the template), [`2026-08-13-knowledge-log-recommendations.md`](../completed/2026-08-13-knowledge-log-recommendations.md)

## Goal

A terminal DTS reload run — any post-device-write terminal: behaviourally verified, unverifiable, contradicted, or failed (the honest outcome is part of the knowledge value) — can be distilled into a pre-filled knowledge draft from the `/dts-reload` run history/detail surface, exactly like the Phase 3 log-conclusion distillation: pre-filled title/tags/markdown assembled ONLY from the stored run/snapshot DTO, `?entryId=` handoff into the `/knowledge` draft editor, durable `source_reload_run_id` linkage shown wherever the log source link shows, and the same draft rules (revision 1, audited, invisible to retrieval until a human publishes).

## Non-goals

- No coupling to bridge internals, deploy steps, or kernel-signal capture code — the pre-fill reads ONLY the stored `ReloadRunDto` / `ReloadSnapshotDto`.
- No inlining of the whole kernel log into the draft: per-parameter excerpt lines at most, with the run referenced as the evidence subject.
- No distillation of non-terminal runs (`pending`, `blocked`, `validated`, `deploying`) — nothing happened on a device yet, so there is no debugging outcome to distil.
- No changes to reload run lifecycle, residue bookkeeping, or the reload permission model; the reload read gate is reused as-is (`requireDtsReloadView`: `debugging:view` or `debugging:dts-reload`, org-scoped).
- No structural parameter-to-knowledge references or collections (still deferred roadmap items 2 and 4).

## Git & PR Workflow

| Role | Allowed |
| --- | --- |
| Implementation agent | Commit on `feat/knowledge-reload-distillation`; do not push, open, or merge GitHub PRs |
| Parent agent | Review, run verification, open/merge the PR, then sync local `main` |

Branch: `feat/knowledge-reload-distillation`, checked out from the latest `origin/main` (worktree-isolated). A sibling knowledge branch (`feat/knowledge-parameter-references`) is in flight; migration numbers are checked against `origin/main` at start and again before the final commit, and the parent agent renumbers at merge time if the branches clash.

## Tasks

1. **Acceptance registration first**: add `KB-DISTILL-002` (terminal reload run → pre-filled draft with honest outcome wording → publish) to `docs/developer/browser-acceptance-coverage-map.md`, `docs/developer/user-operation-coverage-matrix.md` (EN + zh), `e2e/acceptance/requirements.ts`, and `e2e/acceptance/operationMatrix.ts` before implementing the UI.
2. **Migration** (number-checked against `origin/main`; next free at plan time: `0109`): one additive migration adding `knowledge_entries.source_reload_run_id` (nullable, `references dts_reload_runs(id) on delete set null`) plus a partial index, alongside Phase 3's `source_log_id`.
3. **Backend** (`server/modules/knowledge/` + one read seam in `server/modules/dts-reload/`):
   - `server/modules/dts-reload/service.ts` gains `getReloadRunRecord(db, auth, runId)` — the same `requireDtsReloadView` + organization-scope gate as `getReloadRun`, without the object-store overlay-source read (the pre-fill never needs overlay source).
   - `server/modules/knowledge/reloadDistillation.ts`: terminal-status set + `buildReloadDistillationDraft(run: ReloadRunDto)` — title from run purpose + board/device context; markdown body assembling the parameter set with baseline → debug values, per-parameter behavioural verification outcomes, the run terminal state stated honestly (unverifiable ≠ success; contradicted and failed stated plainly), artifact digest, and a kernel-log excerpt reference (never the whole log; the run is the evidence subject); tags `参数调试`, `DTS重载`, plus the terminal-state tag.
   - `distillKnowledgeFromReloadRun` in `service.ts`: `knowledge:edit` + readable run (reload read gate + org scope) enforced server-side; refuses non-terminal runs; creates the draft through the shared `createMarkdownDraftWithSource` path (revision 1, ADR-0027 audited write with `reloadRunId` metadata, invisible to retrieval until published).
   - `source_reload_run_id` threaded through repository insert/read, `KnowledgeEntryDto`, and the reject-audit metadata.
   - Route `POST /api/v1/knowledge/distill-from-reload-run` (`{ runId }`); `routeManifest` + `schemaRegistry` entries; regenerate `docs/generated/openapi.json`.
4. **Xiaoze**: `action.createKnowledgeDraft` schema gains optional `sourceReloadRunId` (approval semantics unchanged); execution validates the run with the same reload read gate + org scope before linking; deterministic model accepts `来源重载:<runId>` for reproducible acceptance; deterministic eval scenarios reviewed.
5. **Frontend**: `KnowledgeRepository` port method `distillFromReloadRun(runId)`; HTTP client; mock repository mirrors the builder from the same run DTO through a `getReloadRun` seam wired to the runtime's mock `DtsReloadRepository` instance (port parity, ADR-0002); `sourceReloadRunId` on the frontend entry type; a 沉淀为知识 button on the `/dts-reload` run result section (terminal runs only, `knowledge:edit` holders) handing off via `/knowledge?entryId=…`; `/dts-reload?runId=…` deep link opens a history run so source links can point back; the `/knowledge-admin` agent-draft queue and the entry detail dialog show the reload-run source link exactly like the log source link.
6. **Acceptance spec**: extend `e2e/acceptance/knowledge.acceptance.spec.ts` with KB-DISTILL-002 — seed a terminal (`unverifiable`) reload run with snapshot evidence directly in the isolated stack (the dts-reload acceptance seeding pattern), distil from `/dts-reload` as a Hardware Committer, assert the pre-filled draft's honest outcome wording, publish, and assert `source_reload_run_id` + audit evidence.
7. **Docs (bilingual)**: api-contract EN + zh; FRONTEND EN + zh; domain-model EN + zh note that distillation now has two sources; `CONTEXT.md` glossary row updated; design-doc roadmap item 3 marked shipped with an honest link; db-schema regenerated against a pgvector container.

## Verification

- Targeted vitest: `server/modules/knowledge/reloadDistillation.test.ts` (builder wording pinned, honest terminal statements), `server/modules/knowledge/reloadDistillationService.test.ts` (permission negatives for `knowledge:edit` and the reload read gate, org isolation, non-terminal refusal, audit evidence, draft-invisible-until-published), `server/modules/knowledge/routes.test.ts`, `server/modules/agent/tools/actionTools.knowledgeDraft.test.ts` (sourceReloadRunId validation), `src/features/dts-reload/DtsReloadPage.test.tsx` (affordance visibility/permission/terminal gating + handoff), `src/infrastructure/mock/mockKnowledgeRepository.test.ts`, `src/infrastructure/http/knowledgeClient.test.ts`.
- `npm run test:server`; `npm test`; `npm run build`; `npm run docs:check`; `npm run contract:openapi` + `npm run contract:check`; `npm run acceptance:coverage` + `npm run acceptance:operations`.
- `npm run acceptance:e2e -- knowledge.acceptance.spec.ts` on an isolated stack (dedicated pre-migrated database `wiseeff_kb_reload`, frontend port within the CORS whitelist and distinct from the sibling branch's).
- Xiaoze deterministic eval if the tool schema change touches scenarios.
- playwright-cli checks of `/dts-reload` (history → run detail → distil affordance) and the `/knowledge` draft handoff at 1440x900 / 768x1024 / 390x844 (snapshot + screenshot under `work/ui-checks/`, `console error` = 0).

## Success criteria

- A terminal reload run the caller can read distils into a markdown draft whose title/tags/body come only from the stored run/snapshot DTO, state the outcome honestly (unverifiable, contradicted, and failed never read as success), reference the run as kernel-log evidence without inlining the whole log, and carry `source_reload_run_id`.
- Callers without `knowledge:edit` get 403; callers who cannot read the run (no `debugging:view`/`debugging:dts-reload`, or another organization) get 403/404; non-terminal runs are 400.
- The `/dts-reload` affordance appears only for terminal runs and `knowledge:edit` holders in both API and mock modes and hands off into the `/knowledge` draft editor; the admin queue and entry detail show the reload-run source link.
- `action.createKnowledgeDraft` accepts `sourceReloadRunId` with unchanged approval semantics and validates the linkage server-side.

## Documentation Impact Matrix

| Area | Action | Paths |
| --- | --- | --- |
| Planning | Update | This plan + zh companion; `docs/PLANS.md` + `docs/zh-CN/PLANS.md` |
| Design docs | Update | `docs/design-docs/2026-08-12-knowledge-base-design.md` + zh (mark deferred roadmap item 3 shipped) |
| API | Update | `docs/design-docs/api-contract.md` + zh; `docs/generated/openapi.json` |
| Frontend | Update | `docs/FRONTEND.md` + `docs/zh-CN/frontend.md` (distil affordance, port method, source links) |
| Domain / glossary | Update | `docs/design-docs/domain-model.md` + zh (distillation now has two sources); `CONTEXT.md` Knowledge distillation row |
| Quality / acceptance | Update | `docs/developer/browser-acceptance-coverage-map.md` + zh; `docs/developer/user-operation-coverage-matrix.md` + zh; `e2e/acceptance/knowledge.acceptance.spec.ts` |
| Generated artifacts | Update | `docs/generated/openapi.json`; `docs/generated/db-schema.md` (new column; regenerate against a pgvector container) |
| Product specs | Review | `docs/product-specs/product-spec.md` + zh — mention only if workflow wording needs it |
| Security | No change | `docs/SECURITY.md` — no new permissions; reuses `knowledge:edit` + the reload read gate server-side |
| Reliability / runbooks | No change | No new env keys, jobs, or operational procedures |
| Repository maps | No change | `ARCHITECTURE.md` — no new module or runtime seam |
| Developer env | No change | `.env.example`, `docs/developer/environment-variables.md` |
| References | No change | `docs/references/` |
| Tech debt | Review | `docs/exec-plans/tech-debt-tracker.md` — record any deferral leaving this plan |

## Documentation Update Gate

- [ ] KB-DISTILL-002 registered in coverage map + operation matrix (EN + zh) before UI implementation
- [ ] api-contract EN + zh and `docs/generated/openapi.json` include `POST /api/v1/knowledge/distill-from-reload-run`
- [ ] FRONTEND EN + zh document the reload distil affordance, `distillFromReloadRun` port method, and reload-run source links
- [ ] domain-model EN + zh + `CONTEXT.md` glossary state distillation's two sources
- [ ] Design doc EN + zh mark deferred roadmap item 3 as shipped
- [ ] `docs/generated/db-schema.md` regenerated with `source_reload_run_id`
- [ ] Product-spec reviewed
- [ ] PLANS EN + zh list this active plan
- [ ] Tech-debt tracker reviewed
- [ ] `npm run docs:check` green
