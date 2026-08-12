# Knowledge Base Design

> Status: **Locked design** — decisions D1–D20 settled 2026-08-12 in a grilled design session
> Date: 2026-08-12
> Chinese: [`docs/zh-CN/design-docs/2026-08-12-knowledge-base-design.md`](../zh-CN/design-docs/2026-08-12-knowledge-base-design.md)
> Execution plan: [`docs/exec-plans/active/2026-08-12-knowledge-base-mvp.md`](../exec-plans/active/2026-08-12-knowledge-base-mvp.md)
> Related: [`ARCHITECTURE.md`](../../ARCHITECTURE.md), [Xiaoze agent design](2026-06-24-xiaoze-agent-design.md), [`docs/SECURITY.md`](../SECURITY.md), [ADR-0022](../adr/0022-knowledge-retrieval-lives-in-postgres.md)

## Positioning

The knowledge base is the fourth product workflow, a peer to parameter management, log analysis, and debugging. It is the organization-scoped home for enterprise engineering knowledge: tuning experience, fault cases, hardware manuals, and process norms. It never means the repository `docs/` developer documentation, which is a development artifact rather than a product surface.

"Agentic" means two things in the MVP, with a third explicitly kept open:

1. **Agent-readable** — Xiaoze grounds answers in published knowledge through registered retrieval tools and cites its sources.
2. **Agent-writable** — Xiaoze can distil conversation outcomes into knowledge drafts through an approval-gated tool; a human always publishes.
3. **Agent-curated (deferred)** — autonomous tidy-up (dedup, staleness flags, gap detection) is a later evolution; the domain model must not preclude it.

### Non-goals (MVP)

- No second chat system. Xiaoze remains the sole Agent surface; the knowledge page adds an entry point into Xiaoze, not a new assistant.
- No hierarchy. Flat entries with multi-tags; no space/folder trees and their curation burden. A single-level collection concept may come later.
- No review/approval queue for human-authored knowledge. Wiki-lite governance only.
- No external-link entries, no realtime collaborative editing, no MCP/external agent surface.
- No structural parameter-to-knowledge references yet (they need reference-integrity rules; deferred together with log-page recommendations and reload-run distillation).

## Domain model

| Concept | Rule |
| --- | --- |
| Knowledge entry | The unit of knowledge. Content form is exactly one of `markdown` (created and edited in product) or `file` (uploaded binary in the object store; extracted text is searchable; the binary is replaceable, never editable). Organization-scoped, flat, multi-tagged (project tags included). |
| Lifecycle | `draft → published → archived`. Published entries edit in place; archived entries leave the retrieval index but keep history; restore returns them to `published`. Hard delete is a manage-level act with audit evidence. |
| Knowledge revision | Every save produces an immutable revision. Rollback restores a prior revision's content as a new revision. Optimistic concurrency: saves carry the expected head revision and fail with a conflict when stale. |
| Agent knowledge draft | Born `draft` via the approval-gated tool. Agents never modify existing entries in the MVP. Invisible to retrieval until a human publishes; the publisher takes content responsibility. |
| Published-only retrieval | Search, RAG, and Xiaoze only see `published` entries. Publishing is the single trust gate. |
| Knowledge chunk | Derived retrieval projection of a published revision: a text segment plus full-text state and an optional embedding. Never authored, always rebuildable. |
| Knowledge distillation | A structured analysis outcome becomes a pre-filled draft with evidence references. MVP source: log-analysis conclusions. |

Scenario checks the model must satisfy:

- **Bulk import**: uploading 30 PDF manuals creates 30 file-form entries directly, with no shell documents.
- **Agent draft**: a draft distilled in one engineer's session is visible to that engineer and manage-level admins only, and publishable by that engineer (edit permission) or an admin.
- **Conflict**: two editors save the same entry; the second save returns a revision conflict, the editor reviews the diff and retries. No silent overwrite, no realtime merge.

## Retrieval and RAG

- **Storage**: chunk rows in PostgreSQL with a pgvector embedding column plus full-text/trigram indexes ([ADR-0022](../adr/0022-knowledge-retrieval-lives-in-postgres.md)). No dedicated vector database.
- **Embeddings**: an OpenAI-compatible `EMBEDDING_API_*` endpoint, mirroring the `AGENT_API_*` seam. Self-hosted deployments may target a local OpenAI-compatible inference server. When unconfigured, the knowledge base runs in FTS-only mode: fully usable, no semantic retrieval.
- **Indexing pipeline**: an asynchronous worker seam mirroring the log-analysis module (polling default, queue-ready). Publish, edit, and archive enqueue index refreshes; failures surface in `/knowledge-admin` with per-entry status and a rebuild action. The index is always rebuildable from published revisions.
- **Chunking**: markdown splits heading-aware with overlap; extracted file text splits by paragraph windows. Chunks carry entry and revision identity so citations can deep-link.
- **Hybrid retrieval**: when embeddings exist, vector similarity is fused with full-text ranking; otherwise full-text alone. CJK caveat: PostgreSQL default FTS does not segment CJK text, so Phase 1 pairs trigram matching for CJK with standard FTS for latin text; a dedicated CJK tokenizer stays a future option.
- **Extraction**: file-form entries get server-side text extraction (PDF and Word first); extraction status is visible on the entry.

## Xiaoze integration

- Read tools `knowledge.search` and `knowledge.getDocument` join the perception catalog: auto-executing, permission-checked under the calling user's AuthContext, returning citation payloads (entry id, title, revision, excerpt) that the UI renders as source links.
- Write tool `action.createKnowledgeDraft` follows the standard mutating-tool contract: AG-UI interrupt, orchestrator approval chain, audit `actorType=agent`. It creates a new draft only. The invariant "every agent write pauses for approval" stays unbroken — draft creation is not exempted even though drafts are inert, because one uniform rule beats a memorized exception list.
- The `/knowledge` page offers an ask-the-knowledge-base entry that opens Xiaoze with knowledge context preloaded. Mock mode has no Agent UI, so this entry is API-mode only, consistent with the existing Xiaoze rule.

## Permissions and audit

| Permission | Grants |
| --- | --- |
| `knowledge:view` | Read published entries, search, and be eligible for Xiaoze knowledge grounding. Default for all organization members. |
| `knowledge:edit` | Create entries; edit, publish, and archive own entries; publish agent drafts distilled in own sessions. |
| `knowledge:manage` | Govern any entry (edit, archive, hard delete), publish any agent draft, and administer the index. Admin-tier. |

- Publisher accountability: `edit` never publishes another person's work; cross-person governance concentrates in `manage`.
- Organization isolation applies to entries, revisions, chunks, and embeddings alike; retrieval APIs enforce `knowledge:view` plus organization scope server-side.
- Every write is audited with the platform envelope; agent-initiated writes carry `actorType=agent`.

## Product surfaces

- `/knowledge`: entry list with tag/project filters and search; markdown editor (edit + preview split); file entry upload with extraction status; revision history with restore; the ask-the-knowledge-base entry.
- `/knowledge-admin`: agent-draft publish queue (a governance surface, not notifications), archived-entry management, hard delete, index health and rebuild.
- Log-analysis result page: a distil-to-knowledge action pre-fills a draft from the conclusion, evidence, and suggested actions (Phase 3).

## Deployment and operations

- Self-hosted PostgreSQL must provide the pgvector extension for semantic retrieval; without it FTS-only mode applies (the same degradation as a missing `EMBEDDING_API_*` endpoint).
- New environment group: `EMBEDDING_API_BASE_URL`, `EMBEDDING_MODEL`, `EMBEDDING_API_KEY`, `EMBEDDING_API_TIMEOUT_MS`.
- Backup/restore inherits the existing PostgreSQL and object-store drills; chunks and embeddings are derived data and may be rebuilt instead of restored.
- Changing the embedding model is a reindex maintenance operation surfaced in `/knowledge-admin`.

## Deferred roadmap

Ordered next candidates after the MVP, all compatible with this model:

1. Related-knowledge recommendations on log-analysis results (similarity search from conclusion text).
2. Structural parameter-to-knowledge references with integrity rules (behavior on spec deprecation and entry archive).
3. DTS-reload run distillation.
4. Single-level collections, if tag navigation proves insufficient.
5. External agent surface (an MCP wrapper over the HTTP API).
6. Agent-curated maintenance: dedup, staleness flags, knowledge-gap detection.

## Decision log

| # | Decision |
| --- | --- |
| D1 | In-product fourth workflow for enterprise engineering knowledge; never the repository docs |
| D2 | Agentic = agent-readable + agent-writable (draft-only) now; agent-curated later |
| D3 | Organization-scoped with project tags; no project-private knowledge bases |
| D4 | Markdown first-class plus file-form entries; external links deferred |
| D5 | Xiaoze is the only conversational surface; knowledge adds tools, not a second chat |
| D6 | pgvector in PostgreSQL; OpenAI-compatible embedding endpoint; FTS-only degradation (ADR-0022) |
| D7 | Wiki-lite governance for humans; drafts plus human publish for agents; no approval queue |
| D8 | MVP linkage: Xiaoze grounding with citations plus log-conclusion distillation |
| D9 | In-product access only; no MCP surface in the MVP |
| D10 | Flat plus multi-tags; no hierarchy |
| D11 | `draft → published → archived`; edit-in-place with immutable revisions and rollback; agents never edit existing entries |
| D12 | File uploads create file-form entries directly |
| D13 | The retrieval index contains published entries only |
| D14 | Agent draft creation keeps the HITL approval interrupt |
| D15 | Distillation MVP source: log-analysis conclusions only |
| D16 | `/knowledge` plus `/knowledge-admin`; the agent-draft queue lives in the admin surface |
| D17 | Single-editor optimistic locking; split edit/preview editor; no realtime collaboration |
| D18 | `knowledge:view` / `knowledge:edit` / `knowledge:manage` with publisher accountability |
| D19 | Three delivery phases: foundation, RAG plus Xiaoze, distillation loop |
| D20 | The session deliverable is documentation; implementation starts from the execution plan |
