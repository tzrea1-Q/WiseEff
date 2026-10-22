# Knowledge reference suggestions and PDF page citations

> Chinese: [中文](../../zh-CN/exec-plans/completed/2026-10-21-knowledge-reference-suggestions-and-page-citations.md)

Status: delivered 2026-10-21. Design settled the same day (grilling session, three rounds, all recommendations accepted); page citations merged as [#1347](https://github.com/tzrea1-Q/WiseEff/pull/1347) and reference suggestions as [#1348](https://github.com/tzrea1-Q/WiseEff/pull/1348), stacked on #1347 (R25 delivered as two PRs). Each PR records its verification evidence. Spec: [#1338](https://github.com/tzrea1-Q/WiseEff/issues/1338); tickets #1339–#1341 (reference suggestions) and #1342–#1345 (page citations). Takes up two items deferred by [user-curated knowledge](2026-10-21-knowledge-user-curation.md): parameter-name detection on import (K15) and PDF page-level citations (K22).

## Authorized outcome

Imported and existing knowledge becomes connected and checkable:

- **Reference suggestions.** The platform proposes definition references for entries whose text mentions a parameter definition. The entry's governors accept or dismiss them, so bulk-imported documents can reach definition pages, DTS reload runs and debug nodes without hand-linking each one.
- **Page citations.** Citations of PDF knowledge name the page they came from. Readers can open the PDF at that page.

Starting point:

- Definition references are explicit only (`knowledge_definition_references`, governed by the entry per K20, audited add and remove that refuse retired definitions).
- Catalog property keys are unique per catalog subject (module), not per organization. They are short snake_case strings, for example `r_pcb` or `ic_para1`.
- PDF extraction (`pdf-parse`) joins pages and discards per-page text. Chunks carry no position.
- Xiaoze citations link to the entry. Log runs record `{entryId, revisionId}` only.
- Files download as attachments; there is no PDF viewer.

## Decisions

| ID | Decision |
| --- | --- |
| R1 | A **reference suggestion** is persisted per entry and definition: `pending → accepted / dismissed`. Accepting writes an ordinary definition reference through the existing add path. Dismissal is remembered and never returns for that entry and definition. |
| R2 | Only the entry's governors (owner or `knowledge:manage`) see and act on suggestions; readers see accepted references only. |
| R3 | A pending suggestion is not a binding: it never changes any knowledge scope, related-knowledge list, Xiaoze or log-analysis retrieval (ADR-0049). |
| R4 | Detection runs whenever a revision is indexed (drafts included), plus one backfill over existing entries. Definitions the entry already references are never suggested. |
| R5 | Detection applies to every knowledge origin alike. |
| R6 | A PDF citation's page is the 1-based physical page index (what a viewer's `#page=N` opens), shown as 「第 N 页」 or 「第 N–M 页」. |
| R7 | Page citations are PDF-only; DOCX, Markdown and text keep heading-trail citations. |
| R8 | Existing PDFs gain pages by re-extraction and re-indexing, without a new revision. Stored citations and completed-run provenance are never rewritten. |
| R9 | A mention is an exact, case-sensitive, whole-token property-key match (no `[A-Za-z0-9_,.+?#-]` adjacent), keys of at least 4 characters. Display names are not matched. Each suggestion stores evidence: a snippet and, for PDFs, the page. |
| R10 | A key that exists in several modules yields one suggestion per candidate definition, grouped by key with module names in the UI. Accepting one does not dismiss the others. |
| R11 | Active and deprecated definitions are suggested; deprecated ones are marked 「已弃用」. Retired definitions never are. |
| R12 | Candidates come from the organization's authenticated catalog read; acceptance re-checks through the existing add path. |
| R13 | Governors meet suggestions in the entry detail's definition-reference editor (「建议关联」 with 接受 / 忽略 and 「全部接受」), plus a 「待处理建议」 list filter and count badge. No notifications. |
| R14 | The batch bar gains 「接受建议关联」: each selected entry is authorized and accepted individually with its own audit and a per-entry result (same rules as #1331). |
| R15 | `/knowledge-admin` offers 「重新检测建议关联」 (`knowledge:manage`) to rescan the organization after catalog changes; catalog publication is not coupled to knowledge. Dismissals survive rescans. |
| R16 | Accept writes the existing definition-reference-add audit, marked as from a suggestion; dismiss writes its own audit event; detection writes none (derived data, like indexing). |
| R17 | Extraction stores the character offset at which each PDF page starts, beside the extracted text. Chunks keep their paragraph windows and record `page_start` / `page_end`. Citations point to the start page. |
| R18 | A page citation opens entry detail at 「引用位置：第 N 页」 with 「打开第 N 页」, which opens the PDF in a new tab through a typed blob URL with `#page=N` (browser viewer; no pdf.js; the attachment header is unchanged). |
| R19 | Pages reach `/knowledge` search results, Xiaoze citations (label and link) and new log-analysis runs. New runs record the pages of retrieved chunks per entry revision, and the report shows 「第 3、7 页」. Earlier results stay as recorded. |
| R20 | A page citation carries its revision. If that revision is not the head, opening it says 「引用的是历史修订」 and opens that revision's file (K9). |
| R21 | A pending suggestion whose key is no longer mentioned by the latest revision is withdrawn; it may return if a later revision mentions the key again. Accepted references and dismissals are never changed automatically. |
| R22 | Archived entries get no detection. Their pending suggestions stay hidden until unarchive, then are re-checked against the head revision. |
| R23 | Every match is stored with its mention count and listed by count, descending, with no cap. |
| R24 | Xiaoze neither lists nor acts on suggestions in this round. |
| R25 | The two features ship as two independent PRs, built in parallel and merged once green. |

## Invariants

- Retrieval scope is unchanged. Only accepted, explicit references bind knowledge to a definition (ADR-0049). Published-only retrieval and organization isolation cover suggestions, their evidence, page offsets and page citations.
- A suggestion never becomes a reference without a governor's act. Every accept and dismiss is an audited write in its own transaction (ADR-0027).
- Stored citations, run provenance and dismissals are never rewritten by detection, rescans or re-indexing.

## Slices

### Feature A — reference suggestions (one PR)

- **A1, detect and govern:** the suggestion store; detection on indexing; withdrawal (R21) and archive (R22) rules; a one-time backfill; governor read, accept and dismiss APIs with audit; the 「建议关联」 section in entry detail; the 「待处理建议」 filter and count badge.
- **A2, at scale:** 「接受建议关联」 in batch actions, and the admin rescan on `/knowledge-admin`.
- Verification: knowledge HTTP API against real PostgreSQL (matching rules, ambiguity, lifecycle, governance refusals, cross-organization isolation, withdrawal, dismissal memory); page-level UI tests; knowledge acceptance spec covering import → suggestion → accept → definition related knowledge. One independent review of the governance seam.

### Feature B — PDF page citations (one PR)

- **B1, pages in the index:** page offsets at extraction; chunk page ranges; one-time re-extraction and re-index of existing PDFs; page shown in `/knowledge` search results.
- **B2, pages in citations:** Xiaoze citation label and link; page recording on new log runs and in the report; entry detail 「打开第 N 页」 with revision pinning (R18, R20).
- Verification: extraction and chunking tests on multi-page PDFs; knowledge HTTP API for search pages and revision-pinned citations; UI tests for the citation and open-at-page action; acceptance spec for search → open at page. `/knowledge` and the log report checked at 1440x900.

## Deferred

Agent-assisted linking (approval-gated); notifications for new suggestions; display-name or fuzzy matching; printed page labels; DOCX page estimation; an embedded PDF viewer.

## Documentation Impact Matrix

| Area | Update |
| --- | --- |
| Domain language | `CONTEXT.md` reference suggestion and page citation (done in the design session) |
| Decision record | None: both features apply ADR-0049 and K9 without changing them |
| Knowledge design | Roadmap item 8 in the knowledge design doc and its Chinese companion (done) |
| HTTP and database schema | Regenerate OpenAPI and the database schema reference in each PR |
| User guide | Suggestions and page citations, with each PR |

## Documentation Update Gate

Run `npm run contract:check`, `npm run db:schema-doc:check` and `npm run docs:check` in each PR. Keep English and Chinese companions aligned. Record actual verification in each PR description, separately from planned or unrun acceptance.
