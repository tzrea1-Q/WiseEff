# User-curated knowledge

> Chinese: [中文](../../zh-CN/exec-plans/active/2026-10-21-knowledge-user-curation.md)

Status: design settled 2026-10-21 (grilling session, three rounds, all recommendations accepted); no slice implemented yet. Spec: [#1324](https://github.com/tzrea1-Q/WiseEff/issues/1324). Each slice ships as its own PR based on current `main`.

## Authorized outcome

People curate the knowledge base themselves as a first-class source, alongside distillation and agent drafts: they upload Markdown, text, PDF and Word documents singly or in bulk, manage them in batches, and find the workflow on discovery surfaces. Every consuming module uses that knowledge through one contract ([ADR-0049](../../adr/0049-knowledge-scope-is-an-explicit-binding-or-the-organization.md)).

Starting point: single-entry Markdown authoring and single-file upload (PDF, DOCX, TXT, MD; 20 MB) already exist on `/knowledge`, but the workflow is hidden from discovery (ADR-0036), uploads are one file at a time, and an uploaded `.md` is stored as a non-editable file entry.

## Decisions

| ID | Decision |
| --- | --- |
| K1 | Goal is a discoverable, bulk-manageable, user-curated source consumed through one contract — not a new upload system. |
| K2 | The program ends by adding `knowledge` to `VISIBLE_WORKFLOWS` (S4), once the management slices land. Module integrations (S5, S6) may follow the launch. |
| K3 | No separate "user knowledge" kind. **Knowledge origin** (authored / uploaded / distilled / agent-drafted / imported) is reader-facing provenance; only publication decides retrievability. |
| K4 | `.md` and `.txt` uploads become editable markdown-form entries; PDF and DOCX stay file-form. Both upload paths (`/knowledge`, skill workspace) behave the same. |
| K5 | **Knowledge import**: several files or one `.zip`; each document becomes one draft; folder names become tags, never a hierarchy; caps 200 files and 100 MB per batch, 20 MB per file. |
| K6 | Formats stay PDF, DOCX, TXT, MD. A file with no extractable text is shown as unsearchable, never as a success. |
| K7 | Every published entry stays visible to the whole organization. Restricted knowledge is a separate future decision. |
| K8 | Wiki-lite governance for human uploads: owners publish their own; batch publish covers own entries unless `knowledge:manage`; only agent drafts use the review queue. |
| K9 | One integration contract: published-only, organization-scoped, revision-pinned citations, honest retrieval mode. Consumers differ only in **knowledge scope**. |
| K10 | Consumers in scope: Xiaoze, analysis skills, parameter catalog definitions, DTS reload and node debugging. Project configuration, audit and admin pages are out. |
| K11 | Xiaoze always searches the organization; the page it is opened from never narrows retrieval. |
| K12 | Skills bind explicit entry identities; "add everything tagged X" is a picker shortcut that expands to identities. |
| K13 | A skill with no bound entries keeps its organization-generic fallback, reported as such. |
| K14 | Definitions show explicitly referenced knowledge only (no similarity suggestions); references can also be added from the definition page. |
| K15 | Import does not detect parameter names or suggest references (deferred). |
| K16 | Debugging surfaces derive related knowledge from their parameter-definition bindings; no new binding, nothing shown without a definition; node debugging is not a distillation source in this program. |
| K17 | Import never overwrites: byte-identical files are skipped and reported; changed content becomes a new draft; updating an existing entry stays an explicit per-entry file replace. |
| K18 | An import may apply batch-level tags in addition to folder tags. |
| K19 | Existing file-form `.md` entries stay as they are; no conversion migration. |
| K20 | Definition references stay owned by the entry: adding one from the definition page requires governing the entry (owner or `knowledge:manage`), so the picker offers only entries the caller governs. |
| K21 | Debugging shows a read-only related-knowledge list per reload-run parameter and on debug-node detail. |
| K22 | PDF page-level citations are deferred. |
| K23 | Bulk import lives on `/knowledge` only; the skill workspace keeps single-document upload. |
| K24 | Archived bound entries stay listed on binding screens as "已归档，不参与检索"; hard delete stays allowed (`knowledge:manage`, audited), leaving a dangling identity shown as "已删除"; completed-run provenance is never rewritten. |

## Invariants

- Published-only retrieval holds for every consumer, including import results: imported entries are drafts until published.
- Organization isolation covers entries, revisions, files, chunks, embeddings, origins and every binding. Duplicate detection only compares against entries the importer can read, so it never reveals another person's drafts.
- Every create, publish, archive, tag change and reference change is an audited write in its own transaction (ADR-0027); a batch adds one summary audit and never replaces per-entry audits.
- Batch actions authorize each entry individually and report per-entry outcomes; one refused or failed entry never rolls back or silently skips the others.
- Archive bounds: no path traversal, entry-count, expanded-size or nesting limit is ever bypassed by a `.zip`.

## Slices

### S1 — Editable uploads, honest extraction, origin

- `.md` / `.txt` uploads on `/knowledge` create markdown-form drafts (UTF-8 required; invalid encoding is refused with a clear message; the existing 200 000-character markdown limit applies). PDF and DOCX unchanged.
- Extraction that yields no text records a failure ("无可提取文本"), and the entry shows as unsearchable. Existing file entries with empty extracted text surface in `/knowledge-admin` index health (zero chunks) rather than through a rewrite.
- Persist knowledge origin at creation; the skill-package import path records `imported`. Backfill existing rows honestly: agent source → agent-drafted; source log or reload run → distilled; file form → uploaded; otherwise authored (earlier skill-package imports are indistinguishable and stay authored).
- UI: origin column and filter on the entry list, origin badge on entry detail.
- Verification: migration and backfill on real PostgreSQL; service tests for conversion, encoding refusal and empty extraction; focused UI tests; `/knowledge` at 1440x900.

### S2 — Knowledge import

- "批量导入" on `/knowledge`: choose several files or one `.zip`, optional batch tags, then a progress view and an import report (created / duplicate skipped / unsupported skipped / extraction failed), each row linking to its draft.
- Files are submitted one per request so the existing per-file limits, audit and extraction path apply and progress is natural; a `.zip` is expanded server-side through the bounded archive reader and processed the same way within the batch caps.
- Folder segments become tags (trimmed, de-duplicated, tag-length bounded); unsupported types are reported, never silently dropped.
- Duplicate check: SHA-256 of the file bytes against readable entries' files and markdown sources in the same organization.
- Requires `knowledge:edit`. Independent review of the diff (upload, archive and tenancy seams).

### S3 — Batch management

- Multi-select on the entry list with 添加标签 / 移除标签 / 发布 / 归档; each entry authorized individually (own entries, or any with `knowledge:manage`) with a per-entry result summary.
- Independent review of the authorization seam.

### S4 — Launch

- Add `knowledge` to `VISIBLE_WORKFLOWS`; update homepage cards, flow tabs and promotional copy per ADR-0036.
- Run the knowledge acceptance specs locally before merge, since PR CI does not run browser acceptance.

### S5 — Linking surfaces

- Definition detail gains "关联已有知识": a picker of non-archived entries the caller governs, writing through the existing definition-reference API (K20).
- Binding screens (skill knowledge section, entry reference editor) show archived and deleted bound entries honestly (K24); fill only the gaps found.

### S6 — Debugging related knowledge

- DTS reload run: a read-only related-knowledge list per parameter with a definition binding, using the published-only related-to-definition read. Debug-node detail: the same for nodes bound to a definition. Nothing renders without a definition or without `knowledge:view`.

## UX decisions (delegated, recorded here)

- Origin labels: 手动编写 / 上传 / 沉淀 / 小泽草稿 / 技能包导入.
- Import uses a dialog with a file/zip picker and batch tags, then a progress list and a final report table; leaving the page does not cancel files already submitted.
- Unsearchable file entries show a warning badge in the list and an explanation on detail, with replace-file as the action.

## Deferred

PDF page citations; parameter-name detection on import; more formats (PPTX, XLSX, HTML, OCR); restricted knowledge; node-debugging distillation; collections; MCP surface; agent curation (dedup, staleness, gap detection).

## Documentation Impact Matrix

| Area | Update |
| --- | --- |
| Domain language | `CONTEXT.md` knowledge entry, origin, import and scope (done in the design session) |
| Decision record | ADR-0049 and Chinese companion (done) |
| Knowledge design | Link this plan from the knowledge design doc and its Chinese companion (done); update non-goals as slices land |
| HTTP and database schema | Regenerate OpenAPI and the database schema reference for S1–S3 |
| User guide | Knowledge upload, import and batch management once S4 lands |

## Documentation Update Gate

Run `npm run contract:check` and `npm run docs:check` in each slice that changes API or schema. Keep English and Chinese companions aligned. Record actual verification in each PR description, separately from planned or unrun acceptance.
