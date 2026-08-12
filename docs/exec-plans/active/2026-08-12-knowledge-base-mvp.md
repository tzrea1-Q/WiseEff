# Knowledge base MVP

> Status: **Active** — planning locked 2026-08-12; Phase 1 implemented on `feat/knowledge-base-foundation` (2026-08-12); Phases 2–3 not started
> Date: 2026-08-12
> Design: [`docs/design-docs/2026-08-12-knowledge-base-design.md`](../../design-docs/2026-08-12-knowledge-base-design.md)
> Chinese: [`docs/zh-CN/exec-plans/active/2026-08-12-knowledge-base-mvp.md`](../../zh-CN/exec-plans/active/2026-08-12-knowledge-base-mvp.md)
> ADR: [ADR-0022](../../adr/0022-knowledge-retrieval-lives-in-postgres.md)

## Goal

Deliver the organization-scoped agentic knowledge base MVP locked in the design doc: flat, tagged markdown/file knowledge entries with a wiki-lite lifecycle and immutable revisions; published-only hybrid retrieval on pgvector + full-text search with graceful FTS-only degradation; Xiaoze knowledge tools with citation payloads; an approval-gated agent draft tool; and log-conclusion distillation.

## Non-goals

No second chat surface, no hierarchy/spaces, no approval queue for human writes, no external-link entries, no realtime co-editing, no MCP surface, no structural parameter-to-knowledge references, no reload-run distillation (all deferred; see the design doc roadmap).

## Git & PR Workflow

| Role | Allowed |
| --- | --- |
| Implementation agent | Commit on the phase feature branch; do not open or merge GitHub PRs |
| Parent agent | Review, run verification, open/merge the PR, then sync local `main` |

One branch per phase, each checked out from the latest `main` after the previous phase merges: `feat/knowledge-base-foundation`, `feat/knowledge-base-rag`, `feat/knowledge-base-distillation`.

## Phase 1 — knowledge foundation (`feat/knowledge-base-foundation`)

1. Migrations: `knowledge_entries` (org scope, content form, status, tags, source attribution), `knowledge_revisions` (immutable snapshots, head pointer), file metadata (object-store key, extraction status/text). Regenerate `docs/generated/db-schema.md`.
2. `server/modules/knowledge/` (routes, service, repository, schemas, types, tests): CRUD; publish/archive/restore; hard delete (manage); revision list + restore-as-new-revision; optimistic concurrency conflicts; file upload through the object-store seam with async text extraction status; FTS + trigram search over published entries only; `knowledge:view|edit|manage` enforcement and audit writes on every mutation; OpenAPI artifact + contract check update.
3. Frontend: `src/domain/knowledge/` types; `KnowledgeRepository` port; mock implementation with fixtures (same port shape); HTTP client; `/knowledge` page (list, tag/project filters, search, split edit/preview markdown editor, file upload with extraction status, revision history/restore); `/knowledge-admin` skeleton (archived management, hard delete); route/nav/permission wiring.
4. Acceptance: add KB-READ-001, KB-EDIT-001, KB-FILE-001 requirement and operation IDs to the coverage map and operation matrix (EN + zh) before implementation; create `e2e/acceptance/knowledge.acceptance.spec.ts`.

## Phase 2 — retrieval and Xiaoze (`feat/knowledge-base-rag`)

1. pgvector migration (guarded `CREATE EXTENSION`; chunk table with embedding column and FTS/trigram indexes); FTS-only mode when the extension or endpoint is missing.
2. Indexing pipeline: heading-aware markdown chunking with overlap, paragraph windows for extracted text; embedding client on `EMBEDDING_API_*`; async worker seam (polling default) triggered by publish/edit/archive; per-entry index status, failure surfacing, and rebuild in `/knowledge-admin`.
3. Hybrid retrieval (vector + FTS fusion) behind the existing search endpoint; citation payloads carry entry id, title, revision, excerpt.
4. Xiaoze: register `knowledge.search` / `knowledge.getDocument` read tools (tool registry, catalog labels/descriptions/schemas); citation rendering as source links in the Xiaoze UI; ask-the-knowledge-base entry on `/knowledge` (API mode only); an eval scenario for knowledge grounding.
5. Env and docs: `.env.example` gains `EMBEDDING_API_BASE_URL`, `EMBEDDING_MODEL`, `EMBEDDING_API_KEY`, `EMBEDDING_API_TIMEOUT_MS`; environment-variables docs (EN + zh); self-hosted runbook notes the pgvector requirement and degradation.
6. Acceptance: add KB-ASK-001 (and an index-health operation ID) before implementation.

## Phase 3 — distillation loop (`feat/knowledge-base-distillation`)

1. Distillation API: create a pre-filled knowledge draft from a log-analysis record (conclusion, evidence references, suggested actions), with source linkage stored on the entry.
2. Log-analysis result page action handing off into the pre-filled draft editor.
3. `action.createKnowledgeDraft` mutating tool: AG-UI interrupt, orchestrator approval chain, audit `actorType=agent`, draft-only semantics.
4. `/knowledge-admin` agent-draft publish queue: list, review, publish (edit-permission holders for own-session drafts; manage for any), archive-reject.
5. Acceptance: add KB-DISTILL-001, KB-ADMIN-001 before implementation.

## New surface summary

- Permissions: `knowledge:view`, `knowledge:edit`, `knowledge:manage` (role seeds + permission docs).
- Env keys (Phase 2): `EMBEDDING_API_BASE_URL`, `EMBEDDING_MODEL`, `EMBEDDING_API_KEY`, `EMBEDDING_API_TIMEOUT_MS`.
- Routes: `/knowledge`, `/knowledge-admin`; API namespace `/api/v1/knowledge/*`.
- Agent tools: `knowledge.search`, `knowledge.getDocument` (read), `action.createKnowledgeDraft` (approval-gated).

## UI interaction automation

Affected spec: `e2e/acceptance/knowledge.acceptance.spec.ts` (new). No KB requirement or operation IDs exist today; per the automation rule each phase adds its IDs to `docs/developer/browser-acceptance-coverage-map.md` and `docs/developer/user-operation-coverage-matrix.md` (EN + zh) before implementation: KB-READ-001, KB-EDIT-001, KB-FILE-001 (Phase 1); KB-ASK-001 (Phase 2); KB-DISTILL-001, KB-ADMIN-001 (Phase 3). Operation evidence stays on `npm run acceptance:browser` / `npm run acceptance:evidence`.

## Verification

Per phase: targeted vitest for `server/modules/knowledge/` and knowledge components; `npm run test:server`; `npm run build`; `npm run docs:check`; `npm run acceptance:browser` for the KB requirement IDs; playwright-cli viewport checks (1440x900 / 768x1024 / 390x844) for `/knowledge` and `/knowledge-admin`. Phase 2 additionally runs the Xiaoze eval scenario and `npm run test:all` before merge.

## Success criteria

- Phase 1: an org member with `knowledge:edit` creates, publishes, revises, and restores a markdown entry; a PDF upload becomes a searchable file entry with visible extraction status; search returns published entries only; every mutation is audited; the mock runtime serves the same port shape.
- Phase 2: with `EMBEDDING_API_*` configured, hybrid retrieval returns semantically related published chunks with citations; without it, every surface stays functional in FTS-only mode; Xiaoze grounds answers with source links under the caller's permissions and never sees drafts.
- Phase 3: a log-analysis conclusion becomes a pre-filled draft via UI and via the approval-gated tool; agent drafts stay out of retrieval until published from `/knowledge-admin` or by the owning engineer.

## Documentation Impact Matrix

| Area | Action | Paths |
| --- | --- | --- |
| Repository maps | Update | `ARCHITECTURE.md` + `docs/zh-CN/root/ARCHITECTURE.md` (knowledge module, tools, runtime shape) — Phase 1/2 |
| Planning | Update | This plan + zh companion; `docs/PLANS.md` + `docs/zh-CN/PLANS.md` (done at planning time) |
| Product specs | Update | `docs/product-specs/product-spec.md`, `docs/product-specs/index.md` + zh (fourth workflow) — Phase 1 |
| Domain / glossary | Update | `docs/design-docs/domain-model.md` + zh (knowledge entities); `CONTEXT.md` glossary + ADR index (done) |
| Design docs | Update | `docs/design-docs/2026-08-12-knowledge-base-design.md` + zh (done); `docs/design-docs/index.md` + zh (done) |
| API | Update | `docs/design-docs/api-contract.md` + zh; `docs/api/examples.md`; OpenAPI artifact — Phase 1 |
| Frontend | Update | `docs/FRONTEND.md` + `docs/zh-CN/frontend.md` (routes, ports, editor) — Phase 1 |
| Security | Update | `docs/SECURITY.md` + zh; `docs/security/user-permission-design.md` + zh (knowledge permissions, agent draft tool) — Phase 1/3 |
| Reliability / runbooks | Update | `docs/RELIABILITY.md` + zh; `docs/runbooks/self-hosted-runtime.md` + zh (pgvector, embedding endpoint, reindex) — Phase 2 |
| Developer env | Update | `docs/developer/environment-variables.md` + zh; `.env.example` (`EMBEDDING_API_*`) — Phase 2 |
| Quality / acceptance | Update | `docs/developer/browser-acceptance-coverage-map.md` + zh; `docs/developer/user-operation-coverage-matrix.md` + zh; `e2e/acceptance/knowledge.acceptance.spec.ts` — each phase |
| Generated artifacts | Update | `docs/generated/db-schema.md` after each migration |
| References | No change | `docs/references/` — not affected |
| Tech debt | Review | `docs/exec-plans/tech-debt-tracker.md` — record any deferral leaving this plan |

## Documentation Update Gate

- [x] Product spec EN + zh describe the knowledge workflow (Phase 1)
- [x] Domain model EN + zh document knowledge entities, lifecycle, and published-only retrieval (Phase 1)
- [x] API contract EN + zh and the OpenAPI artifact include `/api/v1/knowledge/*` (Phase 1)
- [x] FRONTEND EN + zh document `/knowledge`, `/knowledge-admin`, ports, and mock parity (Phase 1)
- [ ] SECURITY + user-permission-design EN + zh document `knowledge:*` permissions and the agent draft tool (Phase 1/3 — `knowledge:*` permissions done in Phase 1; agent draft tool pending Phase 3)
- [ ] environment-variables EN + zh and `.env.example` document `EMBEDDING_API_*` (Phase 2)
- [ ] Self-hosted runbook EN + zh document the pgvector requirement and FTS-only degradation (Phase 2)
- [ ] ARCHITECTURE EN + zh map the knowledge module and Xiaoze knowledge tools (Phase 1/2 — knowledge module mapped in Phase 1; Xiaoze tools pending Phase 2)
- [ ] Coverage map and operation matrix EN + zh gain the KB-* IDs before each phase implements (each phase)
- [ ] `docs/generated/db-schema.md` regenerated after migrations (each phase with migrations)
- [ ] Deferred work recorded in `docs/exec-plans/tech-debt-tracker.md` (closeout)
- [ ] `npm run docs:check` green before moving this plan to `completed/`
