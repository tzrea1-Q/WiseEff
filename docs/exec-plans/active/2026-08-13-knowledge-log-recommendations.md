# Related-knowledge recommendations on log-analysis results

> Status: **Active**
> Date: 2026-08-13
> Branch: `feat/knowledge-log-recommendations`
> Chinese: [`docs/zh-CN/exec-plans/active/2026-08-13-knowledge-log-recommendations.md`](../../zh-CN/exec-plans/active/2026-08-13-knowledge-log-recommendations.md)
> Design: [`docs/design-docs/2026-08-12-knowledge-base-design.md`](../../design-docs/2026-08-12-knowledge-base-design.md) — deferred roadmap item 1 (grilled decision D8 named it the first post-MVP add-on)
> Predecessor: [`docs/exec-plans/completed/2026-08-12-knowledge-base-mvp.md`](../completed/2026-08-12-knowledge-base-mvp.md)

## Goal

A completed log-analysis record surfaces the published knowledge entries most related to its conclusion: the backend derives a similarity query from the record's stored conclusion/impact text and runs it through the existing hybrid retrieval (vector + FTS fusion when available, FTS/trigram-only otherwise) with a relevance cutoff, and the log result page renders a 相关知识 section with citation deep links into `/knowledge?entryId=…`, an honest retrieval-mode caption, and an honest 「暂无相关知识」 empty state.

## Non-goals

- No coupling to analyzer internals or rule ids — the similarity query reads ONLY the stored analysis-record DTO (conclusion, impact); the parallel log-analysis kernel rewrite behind `LogAnalysisAdapter` cannot break it.
- No changes to the worker-facing `read_domain_knowledge` retrieval seam (`logDomainRetrieval.ts`) — that seam serves the analysis agent, this endpoint serves the human reading the result.
- No new migrations, embeddings config, or index-pipeline changes; no audit events (pure read, matching `knowledge.search`).
- No structural parameter-to-knowledge references, reload-run distillation, or collections (still deferred roadmap items 2-4).

## Git & PR Workflow

| Role | Allowed |
| --- | --- |
| Implementation agent | Commit on `feat/knowledge-log-recommendations`; do not push, open, or merge GitHub PRs |
| Parent agent | Review, run verification, open/merge the PR, then sync local `main` |

Branch: `feat/knowledge-log-recommendations`, checked out from the latest `main` (worktree-isolated).

## Tasks

1. **Acceptance registration first**: add `KB-REC-001` (completed analysis shows related published knowledge with a deep link; draft/archived entries never appear) to `docs/developer/browser-acceptance-coverage-map.md`, `docs/developer/user-operation-coverage-matrix.md` (EN + zh), `e2e/acceptance/requirements.ts`, and `e2e/acceptance/operationMatrix.ts` before implementing the UI.
2. **Backend** (`server/modules/knowledge/`): `relatedKnowledge.ts` derives the similarity query from `LogRecordDto.conclusion`/`impact` and owns the relevance cutoffs; repository gains a published-only trigram-similarity ranking (`word_similarity` with cutoff) and a distance-cutoff variant of the chunk-embedding search; `findRelatedKnowledgeForLog` in `service.ts` gates `knowledge:view` server-side plus `logs:view` + organization scope through `getLogRecord`, requires a completed analysis, fuses vector + trigram rankings when embeddings are configured (RRF, same `fuseKnowledgeSearchResults`), and reports the honest `retrieval.mode`; route `GET /api/v1/knowledge/related-to-log?logId=…&limit=…`; routeManifest + schemaRegistry entries; regenerate `docs/generated/openapi.json`.
3. **Frontend**: `KnowledgeRepository` port method `relatedToLog(logId)`; HTTP client implementation; mock implementation with the same published-only semantics (CJK-bigram overlap scoring over the prototype log record) plus one published fixture related to the completed mock log; `canView` added to `KnowledgeCapability` (API mode `knowledge:view`, mock mode member default); `RelatedKnowledgeSection` on the log-analysis result page (visible only for completed analyses and `knowledge:view` holders) with loading/error/empty states, entry deep links via `/knowledge?entryId=…`, and the retrieval-mode caption.
4. **Acceptance spec**: extend `e2e/acceptance/knowledge.acceptance.spec.ts` with the KB-REC-001 scenario (seed a completed analysis; publish a related entry; keep a related draft and a related archived entry out; assert the section, the deep link into `/knowledge`, and operation evidence).
5. **Docs**: api-contract EN + zh; FRONTEND EN + zh; mark deferred-roadmap item 1 as shipped in the design doc EN + zh; review product-spec wording.

## Verification

- Targeted vitest: `server/modules/knowledge/relatedKnowledge.test.ts`, `server/modules/knowledge/relatedKnowledgeService.test.ts` (published-only, relevance cutoff, org-isolation and permission negatives, retrieval-mode honesty, vector-path fusion), `server/modules/knowledge/routes.test.ts`, `src/logsPage.relatedKnowledge.test.tsx`, `src/infrastructure/mock/mockKnowledgeRepository.test.ts`, `src/infrastructure/http/knowledgeClient.test.ts`.
- `npm run test:server`; `npm test`; `npm run build`; `npm run docs:check`; `npm run contract:openapi` + `npm run contract:check`; `npm run acceptance:coverage` + `npm run acceptance:operations`.
- `npm run acceptance:browser -- --require KB-REC-001` on an isolated stack (dedicated database, free ports within the CORS whitelist).
- playwright-cli checks of `/logs` with the new section at 1440x900 / 768x1024 / 390x844 (snapshot + screenshot under `work/ui-checks/`, `console error` clean), exercising the deep link into `/knowledge`.

## Success criteria

- For a completed analysis the caller can read, the endpoint returns top-N related **published** entries with citation fields (`entryId`, `title`, `excerpt`, `revisionId`), similarity-honest ordering, and an honest `retrieval.mode`; unrelated entries are cut off rather than padded in; drafts and archived entries never appear.
- Callers without `knowledge:view` or `logs:view` get 403; records of another organization are 404; non-complete analyses are 400.
- The log result page shows 相关知识 with working deep links for `knowledge:view` holders in both API and mock modes, and hides the section for users without `knowledge:view`.

## Documentation Impact Matrix

| Area | Action | Paths |
| --- | --- | --- |
| Planning | Update | This plan + zh companion; `docs/PLANS.md` + `docs/zh-CN/PLANS.md` |
| Design docs | Update | `docs/design-docs/2026-08-12-knowledge-base-design.md` + zh (mark deferred roadmap item 1 shipped) |
| API | Update | `docs/design-docs/api-contract.md` + zh; `docs/generated/openapi.json` |
| Frontend | Update | `docs/FRONTEND.md` + `docs/zh-CN/frontend.md` (related-knowledge section, port method, capability) |
| Quality / acceptance | Update | `docs/developer/browser-acceptance-coverage-map.md` + zh; `docs/developer/user-operation-coverage-matrix.md` + zh; `e2e/acceptance/knowledge.acceptance.spec.ts` |
| Product specs | Review | `docs/product-specs/product-spec.md` + zh — mention recommendation only if workflow wording needs it |
| Repository maps | No change | `ARCHITECTURE.md` — no new module or runtime seam |
| Domain / glossary | No change | `docs/design-docs/domain-model.md`, `CONTEXT.md` — no new entities, lifecycle, or state machines |
| Security | No change | `docs/SECURITY.md` — read path reuses existing `knowledge:view` / `logs:view` gates; no new permissions |
| Reliability / runbooks | No change | No new env keys, jobs, or operations procedures |
| Developer env | No change | `.env.example`, `docs/developer/environment-variables.md` — no new keys |
| Generated artifacts | Update | `docs/generated/openapi.json` (contract regeneration); `docs/generated/db-schema.md` unchanged (no migration) |
| References | No change | `docs/references/` — not affected |
| Tech debt | Review | `docs/exec-plans/tech-debt-tracker.md` — record any deferral leaving this plan |

## Documentation Update Gate

- [ ] KB-REC-001 registered in coverage map + operation matrix (EN + zh) before UI implementation
- [ ] api-contract EN + zh and `docs/generated/openapi.json` include `GET /api/v1/knowledge/related-to-log`
- [ ] FRONTEND EN + zh document the related-knowledge section, `relatedToLog` port method, and `canView` capability
- [ ] Design doc EN + zh mark deferred roadmap item 1 as shipped
- [ ] Product-spec reviewed — updated or recorded unchanged with evidence
- [ ] PLANS EN + zh list this active plan
- [ ] Tech-debt tracker reviewed for deferrals leaving this plan
- [ ] `npm run docs:check` green before moving this plan to `completed/`
