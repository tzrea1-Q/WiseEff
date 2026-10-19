# DTS source editor implementation plan

> Chinese: [DTS 源码编辑实施方案](../../zh-CN/exec-plans/active/2026-10-19-dts-source-editor.md)

Status: implemented. The initial local checks and their broader regression failures are recorded below; current integration acceptance and merge status belong in the PR description. No deployment is authorized.

Workspace: `codex/frontend-ui-refinement`, inspected HEAD `56fdcccfb09302061f713aad15244f03c53ca84e`. Existing uncommitted navigation and typed-editor work remains intact. This proposal supersedes the UI direction of [Configuration value editor refinement](2026-10-19-configuration-value-editor.md); its historical verification is not evidence for the new design.

PR integration uses `codex/dts-source-editor` on main `cabf75eb6`. Main had already published migrations 0190–0193, so this change's unpublished source migrations were renamed from 0190–0192 to 0194–0196 without changing their SQL. The original preview worktree/database is retained. Earlier upgrade results below refer to the original unpublished numbering; integration checks must use the new migration inventory.

## Outcome and boundaries

Make the complete selected DTS file the editable document. The workbench has one source editor, a Preview/Edit switch and one Save changes entry point. Strings, arrays, references, comments and node structure are edited as source. Retain the navigation filter for registered organization modules and their real DTS ancestors; navigation filtering never removes source text.

This proposal includes saving comments, whitespace, unregistered properties and added/removed nodes, not just bound property values. Preserve organization definitions and stable Binding identities; a project source edit never renames a global Definition. Ambiguous identity continuity or invalid references block application with a precise explanation.

Keep one file per save, the current 2 MiB UTF-8 byte limit, existing configuration membership and existing file-write/review permissions. Includes and overlays are validated in the pinned configuration context. File creation/removal, configuration membership, baseline publication and device writes keep their existing separate operations. This iteration does not add multi-file atomic editing, collaboration, AI completion or automatic whole-file formatting. JSON workflows keep their current behavior.

## Current seams and required changes

| Observed implementation | Consequence |
| --- | --- |
| `ProjectPrimaryDtsViewer.tsx` maps every line to DOM and scans line elements on scroll | It is a viewer, not an editor. Introduce a proper editor in this workbench rather than adding contentEditable to it. |
| `ParameterFileRepository.createCandidate` accepts complete file bytes | Reuse candidate storage, download, diagnostics, version history and review entry points. |
| `candidateService.ts` chooses the file's current version when creating a candidate | An editor must supply and enforce its original file and configuration revision before candidate creation, as well as at review/apply. |
| `canonicalFileWorkflow.ts` and `canonicalSource.ts` prove exact bound-property patches | Comments, formatting and unbound changes need an explicit whole-source request kind. Keep the old proof intact for old operations. |
| `ingestService.ts` sourceCommit mode requires the same node cohort and refuses new logical identities | Whole-source changes need reviewed identity continuity, additions and removals through a separate explicit ingest mode. |
| Request kinds are single/batch; migration 0165 requires at least two batch targets | A comment-only request must support zero parameter targets without inventing a dummy Binding or weakening batch constraints. |
| `sessionDraftStorage.ts` explicitly stores property patches only | Keep that store compatible. Use a separate, scoped whole-source draft store. |
| `parser.ts` deliberately tolerates unknown value forms | Indexing success alone is not syntax or compilation acceptance. Reuse config resolution, the configured toolchain and Definition validation. |

Relevant accepted contracts: [ADR-0046](../../adr/0046-source-occurrence-identity-spans-dts-and-software-configuration.md) for occurrence/Binding identity; [ADR-0034](../../adr/0034-referenced-property-key-rename-is-a-source-cutover.md) for global property-key changes. Implementation must document the new whole-source request contract alongside these constraints; it must not reinterpret existing single/batch requests.

## Visible interaction

The source header contains file name/version, Preview/Edit, draft state, Save changes and Discard changes. The right inspector defaults closed and contains read-only Definition details and diagnostics. Remove typed-edit controls and the expanded typed editor from this workbench after the replacement can save; retain shared components used elsewhere.

| Event | Required behavior |
| --- | --- |
| Open a file | Default to Preview. Restore a compatible local draft with a visible draft label; otherwise show the current source. |
| Enter Edit | Enable the same editor document. Preserve selection, scroll, folded regions and undo history. |
| Return to Preview | Make the current buffer read-only, including paste/drop/replace commands. Do not reload server text or discard edits. Search, copy and folding remain available. |
| Edit text | Mark unsaved immediately. Invalid and incomplete text remains editable and recoverable. |
| Save changes or Cmd/Ctrl+S | Capture one immutable buffer snapshot, validate it and open the existing review/confirmation surface with its full diff. No change means no request. |
| Syntax or semantic failure | Keep the buffer and undo history; show diagnostics below the editor and jump to their source position when available. |
| Submit succeeds | Show Pending review, not Saved to working configuration. Link the existing request. Keep the submitted source available while the active version is unchanged. |
| Approval applies | Refresh the authoritative file/version and navigation. Clear only a local snapshot that exactly matches the applied receipt; retain subsequent typing. |
| Switch file / leave / refresh | Flush draft persistence and restore by scope. If persistence failed or is still unconfirmed, warn before navigation; never claim recovery is guaranteed. |
| Discard changes | Confirm only when dirty, then restore the latest explicitly loaded base. Discarding a local draft does not withdraw a submitted request. |
| History / candidate / comparison | Read-only; returning to the working file restores its editor session. |

Use one compact save dialog: full text diff, concise counts of parameter/structure changes, reason and reviewer where required, then Confirm update or Submit review according to the server workflow. Unresolved existing parameter drafts block submission and link to their existing resolution flow; do not silently overlay them or add a new conflict-choice grid to the editor.

## Editor and local state

Use CodeMirror 6 directly through one React component, lazy loaded on the workbench route. The repository has no installed editor engine. Use its existing search, history, line numbers, bracket matching, selection, virtual viewport and dynamic read-only configuration. Add only required CodeMirror packages, no additional React wrapper or editor framework. Official behavior: [read-only example](https://codemirror.net/examples/readonly/), [viewport reference](https://codemirror.net/docs/ref/#view.EditorView.viewport), [basic extensions](https://codemirror.net/examples/basic/).

Add a small DTS highlighting adapter for comments, strings, numbers, labels/references and directives; highlighting is not semantic validation. Use comment/string-aware node ranges for folding. Reuse the existing DTS lexer/parser in a worker if needed for ranges and navigation; do not import database/server dependencies into the browser or invent a second authoritative parser. The initial editor integration must prove this bundle boundary with the build.

Keep editor document/history in CodeMirror. React owns file scope, mode, dirty/status and candidate/request IDs, not a second full string on each keystroke. Debounce draft persistence and local range analysis; discard responses whose document generation is stale. Serialize complete text on persistence/save, not on every character. Disable soft wrapping by default for long arrays; allow the existing visual treatment to expose wrapping without restructuring values.

Proposed file draft record:

```text
scope: userId, organizationId, projectId, configSetId, fileId
base: fileVersionId, configRevisionId, sourceDigest
content: sourceText, encoding/newline metadata, updatedAt, generation
position: selection, firstVisibleLine
submission: candidateId?, requestId?, submittedDigest?
```

Store whole documents asynchronously in native IndexedDB, with one current draft per scoped file and a base-version pin. Do not put multi-megabyte files into the old synchronous localStorage property store. A failed/quota-blocked write leaves the buffer editable, shows Recovery unavailable, and offers Download draft. A transactional stored-generation check prevents two tabs from silently overwriting each other's recovery copy. Switching account or organization cannot restore another scope. Do not claim undo history survives a page reload; only same-session mode/file switching preserves it.

Preserve raw numeric tokens, empty/duplicate strings, grouping, `/bits/`, reference arguments and comments. No JS Number/JSON round-trip or format-on-save. Preserve supported UTF-8 BOM and consistent LF/CRLF. If mixed newline styles require normalization by the editor, expose that change in the diff before submission; never silently claim byte-for-byte preservation. The applied/downloaded bytes must equal the confirmed serialized buffer.

For navigation, map existing source ranges through editor transactions so inserting lines does not leave jumps at old line numbers. Recompute draft ranges after a pause or explicit validation; syntax failure retains the last valid map and marks its state. Deleted/ambiguous targets must not jump to unrelated lines. Filter newly parsed draft navigation by the same registered-module rule; never repopulate the full DTS tree. Reload canonical navigation after approval.

## Server contract and storage

Extend the existing candidate endpoint rather than creating a second upload protocol. For editor submissions, add an explicit intent `source_revision`, `expectedCurrentVersionId`, `expectedConfigRevisionId` and `clientMutationId`; retain the current upload contract for existing callers. The server checks permissions, file/config ownership, membership, limits and both versions before accepting the candidate. It persists the intended base; it must not silently replace it with a newer version.

Extend existing candidate source-preview and source-review endpoints with the whole-source variant. The server derives changed parameters, identity continuity, authority requirements and blockers; the client cannot nominate trusted mappings or bypass review. Diagnostics use file/line/column when available, with a document-level message when they are not. Include full source diff, affected registered parameters, unregistered changes, node additions/removals and references affected across member files. Large diffs use context hunks and editor rendering rather than one DOM row for every file line.

Add `request_kind = source_revision` to the existing request header through a new additive migration. Keep single and batch constraints and history unchanged. A strict source context records file/config/base revision, candidate and content digests, frozen member versions, catalog/registration context, existing Binding tips and the reviewed identity/impact plan. Existing relational targets may represent affected existing Bindings; proposed new occurrences and zero-target source-only changes live in this typed source context until apply. Do not populate old batch columns merely to trick batch dispatch into accepting this kind.

Extend ownership checks, immutable snapshot/receipt constraints, role grants, review dispatch, diff readers, inbox/history, pending-request detection and readiness to understand this explicit kind. Search every single/batch discriminator before changing it. Readers that cannot display the new kind must reject it explicitly; never interpret it as a single request. The upgrade test starts from populated single/batch history and proves its behavior remains unchanged.

Candidate creation and review submission use scoped mutation keys. Retrying the same key/content returns the same result; a different payload with that key conflicts. A pending request owns an immutable candidate. Subsequent editing creates a new local generation; updating a submitted request requires withdrawal/revalidation through the existing workflow. Initially allow only one pending source revision per configuration set to avoid overlapping whole-file proofs; surface the existing request in the save dialog.

## Preview, review and atomic apply

1. Capture the submitted text, both base revisions and mutation key. Validate the UTF-8 byte size. Create a candidate without changing active files, values, navigation or memberships.
2. Resolve a configuration snapshot made from the frozen member files with this one file replaced. Reuse the existing include paths, entry point, overlay order and toolchain. Report the configured compiler result truthfully; unavailable or disabled compilation never becomes a pass. Require the current effective validation policy before apply.
3. Compute semantic impact and identity continuity. Reuse existing matching/continuity code in a read-only preparation seam. Freeze its results against the exact candidate digest and catalog context; preview must not stabilize live Bindings or allocate active values.
4. Review the exact source diff and impact. Recheck role, assigned reviewer rules, self-review prohibition, sensitive-node controls, version/cohort/catalog drift and conflicts at submission and application. Keep current administrative file-write permissions; do not grant all parameter editors whole-file writes implicitly.
5. Store candidate bytes in the existing object store, then transactionally publish the file version, config revision, structural occurrences, Binding/value/pin changes, history, audit and approved receipt. Reuse the existing version/ingest/value owners. Object storage is not part of the PostgreSQL transaction: failed apply leaves at most a staged, unreferenced object handled by existing cleanup; no active partial version.
6. Re-read/reparse the new source, verify the frozen impact and return the authoritative version/config/request receipt. A duplicate approval returns the verified existing receipt. Errors roll back all active relational changes and preserve the candidate and local buffer.

| Source change | Apply rule |
| --- | --- |
| Comments/format only; zero parameter changes | Allow a source request. Advance file/config provenance and affected pins; parameter business values remain equal. |
| Existing registered property changes | Validate against its pinned Definition and review all affected effective values, including overlay/include effects. Preserve Binding identity. |
| Unregistered property/node changes | Preserve full source and validate structure/references. Do not invent organization Definitions or add unregistered navigation modules. |
| New node/property matching existing registration | Prepare the match, then create the occurrence/Binding through current owners only on approved apply. Freeze the proposed match so changed registrations force revalidation. |
| Removed property/node | Compute the final effective configuration first. If a fallback property becomes effective, review that resulting value. If genuinely absent, retain historical Binding/value records and create explicit reviewed absence/tombstone proof anchored to the before occurrence and after revision; do not delete history or fabricate an old property span. |
| Moved/renamed node | Preserve identity only with unambiguous continuity evidence. Otherwise block application and explain the unresolved identity; never guess by line or display name. |
| Changed reference/include/compatible | Evaluate the complete pinned config set and all affected registered values. Block unresolved references, out-of-membership dependencies or unknown identity effects. |

Implement a distinct reviewed-source ingest option carrying the frozen continuity plan. Do not remove the old sourceCommit cohort guard or call an unrestricted import path that silently creates mappings. For source-only revisions, repin affected values as derived provenance changes where the current value model requires a new revision; do not label those as business-value edits.

## Work packages and owning paths

| Package | Concrete work and ownership | Completion check |
| --- | --- | --- |
| 1. Editor surface | Add `WorkbenchDtsEditor.tsx` and a bounded DTS adapter beside `WorkbenchSourceCanvas.tsx`; update canvas/header/CSS and package lock. Reuse current app primitives. | Read-only is enforced; strings/arrays edit as source; selection, folding, search and undo survive mode switches at 1440×900 and 1280×800. |
| 2. File draft session | Add `sourceEditSession.ts` and `sourceDraftStorage.ts` under application/project-configuration; wire selection, dirty state, recovery and snapshot generations in `ProjectConfigurationWorkbench.tsx`. | Refresh/file switches, persistence failure, two tabs, stale bases and typing during save cannot lose edits. |
| 3. Source request contract | Extend repository/client, candidate service/routes/DTOs, request kind/storage/dispatch and review UI. Add the migration and typed context. | Zero-target and mixed changes preview/submit; old single/batch requests remain compatible; duplicate requests and cross-tenant calls are rejected or replayed correctly. |
| 4. Full-source application | Add focused `sourceRevisionService.ts` / `sourceRevisionCommit.ts` in parameter-files and connect existing ingest, continuity, catalog-value, pin, audit and history owners. Share existing helpers only where there are actual callers. | Real PostgreSQL approve/apply/reparse/export round-trip passes for comments, registered/unregistered values and added/deleted nodes, including rollback on mid-apply failure. |
| 5. Workbench switch and cleanup | Connect Save to candidates/review and read-only diagnostics. Remove typed editing from this DTS workbench; update task dock and navigation mapping. | A complete real API browser flow saves an actual bound DTS; the prior unbound demo alone is insufficient. |
| 6. Acceptance and docs | Update operation coverage, focused tests, bilingual guides and API/schema docs. Complete selected gates and independent review of changed authorization/identity/concurrency/migration seams. | Current candidate evidence passes; incomplete historical regressions are not reused as new acceptance. |

Dependency order: packages 1–2 establish local editing; packages 3–4 establish real persistence; package 5 switches the product only when both paths work; package 6 completes acceptance. The local editor milestone is a preview, not delivery of this request. Keep source-editor visibility internal until application and supported review readers are ready; use the existing capability convention if rollout needs version coordination, not a new settings screen.

Keep old property drafts recoverable during the switch. Compatible complete drafts may be explicitly applied to a file buffer using the existing lossless patch machinery with a visible diff. Stale or incomplete drafts stay in their old bucket and can be exported as recovery data; never silently drop, coerce or automatically submit them. Removing this workbench entry does not remove shared typed-editor callers elsewhere. Preserve the previous navigation and parser correctness changes unless focused review shows a specific replacement is required.

## Acceptance and performance

Build synthetic fixtures only; no deployment project data is required. Use two fixture families: a large unbound DTS for editing/rendering and a genuinely registered/bound configuration set for review/application.

| Case | Required result |
| --- | --- |
| 20/200/2,000 strings or integers; a long array line | Direct paste/edit/undo; no per-element input grid; empty/duplicate/escaped strings and groups preserved. |
| `/bits/ 64`, value above 2^53, bytes, repeated and parameterized references | Exact source tokens survive editor, review, apply, download and reimport. |
| Invalid syntax, incomplete value, unresolved reference, invalid registered value | Specific diagnostics; no active writes; local text survives. Indexer tolerance is not acceptance. |
| Pure comment/whitespace edit | Zero-target request can be reviewed and applied, preserving equal business values. |
| Node/property add/remove and overlay fallback | Registered impact is complete, identity/history is consistent and the filtered tree refreshes correctly. |
| Local mode/file switch; refresh; mixed newline/BOM | Preview has no mutation commands; same-session undo works; recovery and byte serialization follow the documented rules. |
| Another user advances file, config, binding tip or registration | Save/apply conflicts without overwriting; show latest-versus-local comparison and retain local content. |
| Request retry, double approval, interrupted response, continued typing | One durable request/application per key; reconcile by receipt; newer local generations survive. |
| Cross-tenant, viewer/editor/admin/reviewer, self-review, sensitive node | Server enforces current policy; UI disabled state alone is not evidence. |
| Mid-apply failure, object-store failure, populated upgrade | No partial active file/value/pin/audit state; previous history remains readable and valid. |

Performance fixtures: approximately 100 KiB, 1 MiB and just below 2 MiB; many short lines plus a separate long-line array case. At 1440×900 record load/render time, keyboard-to-paint, scrolling/search and DOM size on the same development machine. Proposed targets after source download: interactive within 2 seconds and normal typing p95 at most 100 ms. These are acceptance targets to measure, not current claims. Parsing/diff work must not run synchronously on every keystroke; DOM line count must track the viewport. Reject over-limit submissions before base64 upload while retaining/download-enabling the buffer.

Preserve `PROJ-CONFIG-EDIT-001`, `PROJ-CONFIG-DRAFT-001` and `PROJ-CONFIG-INSPECT-001` coverage in `e2e/acceptance/project-configuration-workbench.acceptance.spec.ts`; replace this workbench's typed interaction expectations with source editing and retain shared typed-editor coverage elsewhere. Add operation coverage for zero-target source review and structural application where existing IDs do not describe them. Do not weaken unrelated screenshot baselines or fallback selections.

During implementation run focused changed behavior tests first, then `npm run test:impact -- --base 56fdcccfb09302061f713aad15244f03c53ca84e` (or the verified updated integration base). Inspect both Vitest/browser fallback flags and run their required commands in the applicable verification tier. Retain changed-file lint/type checks, build, UI/docs/contracts checks and real-role PostgreSQL acceptance. Browser checks use an isolated API runtime lane at 1440×900 plus this layout's 1280×800 check. Complete one independent review of the changed sensitive seams. No mobile sweep or deployment is implied.

## Documentation Impact Matrix

| Document | Update when implemented |
| --- | --- |
| This plan and Chinese companion | Package status, concrete contract decisions and actual evidence gaps. |
| Previous value-editor plan and companion | Link the replacement direction while preserving historical scope/results. |
| Frontend guide and parameter-management user guide, both languages | Source editor, mode/dirty/recovery meanings and source-review flow. |
| API contract, generated OpenAPI and schema documentation | Candidate base pins, source_revision request variant, diagnostics and receipts after the actual contract lands. |
| Relevant design decision document and bilingual companion | Explicit whole-source revision and identity/absence-proof invariants without weakening prior single/batch contracts. |

## Documentation Update Gate

Maintain both languages and regenerate contract/schema documentation with the implementation. Report actual command outcomes, independent review and unrun acceptance separately. Prior typed-editor results do not establish source-editor acceptance.

## Implementation record

Packages 1–5 are implemented. Package 6 completed the initial documentation, selected checks and independent review, with the broader gaps below. Those results preceded the integration commit and PR; no deployment was performed. Current candidate evidence is recorded in the PR description.

- The editor preserves exact initial mixed-ending text through preview, file switching and undo. Editing mixed endings may normalize to LF, with an explicit notice and reviewed diff. CodeMirror editor unit tests pass 17 cases. Line and property navigation now unfolds a containing region without moving the cursor or opening unrelated folds; two added regression cases first reproduced the failure. A real browser also verified that a hidden parameter becomes visible after navigation and the document remains clean. Current draft/session and editing-pane tests pass 18 cases, including initial recovery, queued discard, concurrent typing, failed persistence and two-tab compare-and-swap conflicts. Discard waits for durable storage before clearing the buffer and blocks repeated confirmation while pending.
- Active, candidate, historical and comparison source decoding retains UTF-8 BOM and CRLF and rejects invalid UTF-8 instead of silently writing replacement characters. The three affected source-loading suites pass 35 cases.
- Native runtime-role PostgreSQL and the configured release DTS toolchain passed 50 focused cases. A separate three-case selected run verified deletion export/reimport and old single JSON/DTS behavior. Genuine archived 0189 code created and approved single/batch changes before upgrading through 0192; old history and HTTP receipts survived unchanged.
- Real API browser checks at 1440×900 and 1280×800 changed a bound `iin_max` from 36 to 37, submitted its fixed diff, approved as the separate assigned reviewer and reloaded clean working v2. PostgreSQL readback verified the same Binding and advanced file/config pins with value 37. The compact view also verified an enabled Save button remains clickable with the inspector open, without page overflow; confirmed discard restored clean v2. Browser output contained the existing CopilotKit licensing warning; no source-editor runtime error was observed after the preview connection fix.
- Native Chromium editor measurements for 102,353 / 1,048,529 / 2,096,081 bytes and a 1,048,539-byte long-array sample: interactive 30.3–86.6 ms; 30-key typing p95 14.5–14.9 ms; end-scroll 24.7–29.1 ms; search 63.2–66.9 ms; at most 68 rendered lines. These are editor-only measurements, separate from API acceptance.
- Editing retains the confirmed, filtered navigation and maps existing source positions through transactions. New draft nodes appear in authoritative navigation after approval; this iteration does not perform live client-side Catalog rematching. Restored drafts use conservative changed spans so ambiguous/deleted targets do not jump to unrelated text.
- Terminal-deleted bound occurrences require explicit identity mapping before restoration and are blocked at preview. Registration validation currently holds a global table shared lock; the per-organization fence remains its scaling path. Independent review closed the raised authorization, tenancy, identity, atomicity and concurrency findings.
- The default-cohort comment-only browser check exposed a byte-value validation mismatch: existing vendor Definitions represent bytes as strings. Full-source validation now uses the existing DTS text projection for byte values with a string schema, while preserving numeric/array validation and rejecting ordinary cells/references as strings. The 29-case schema suite and nine source-revision core cases pass; the native comment-only and bound-value author/reviewer browser flows also pass. A broader nine-file backend run passed 85/87; a bounded two-file recheck passed 10/13, leaving native seed/HTTP timeout and unavailable-toolchain failures recorded separately from schema correctness.
- The production build, changed-file lint/types, OpenAPI, UI standards and documentation/schema checks have passed. Both impact fallback flags are true; all four selected Vitest configurations and the full browser selection were executed. This is not a full green acceptance claim: the following broad-run failures remain distinct from focused repairs and environment-specific rechecks.

| Verification | Observed result and follow-up |
| --- | --- |
| Complete frontend | 5,313 passed / 20 failed across 536 files. All 12 initially failing files subsequently passed 412 cases after correcting old API fixtures and faithful asynchronous interactions. The latest whole-workbench run passed 138/139, with the remaining member-management case exceeding its unchanged 5-second limit; an isolated final recheck passed that case in 2.23 seconds. |
| Complete server | 5,788 passed / 28 failed / 12 skipped across 683 files. Failures include fixed-lane prerequisites, explicit rejection of the selector's mock runtime, timeout/cleanup/timer failures, the old route query fixture and the exact archive trigger inventory. The corrected route passes 31/31; the updated archive inventory and API-mode browser parser pass 17/17. Publication manager, schema migration, catalog transfer and seed rebuild rechecks pass 45/45. API-mode capture unit tests pass 7/7 and its two PostgreSQL integration suites pass 5/5 (the browser collector uses a synthetic observation driver). A short-prefix database harness recheck passes 25/32, with seven unchanged 30-second timeouts during template/lease tests. The repeated-include source-proof suite passes 36/37, with its budget case still timing out. No broader server pass is claimed. |
| Complete scripts | 2,827 passed / 31 failed / 12 skipped across 157 files, including a restore-drill suite setup failure. API-mode/empty-lane rechecks passed 104 cases. Dedicated PostgreSQL/Redis/MinIO native rechecks passed all 250 upgrade cases and 79/81 catalog rehearsal cases; the remaining two exceeded their unchanged 60-second limits. Other failures require absent target/Redis/dedicated-database prerequisites. Those checks are not waived or reported as passed. |
| Complete Bridge | 21 files, 142/142 passed. |
| Browser quality, isolated API lane 73 | 262 passed / 23 failed out of 285. Four editor keyboard-focus and twelve inspector-related cases were repaired and rechecked on independent lane 74: 17/17 passed including the required warmup, with 36 screenshots and zero report errors. The original full report is retained. Six Bridge layout cases and one project-list dark-contrast case failed on other routes and remain unresolved; no unchanged-base reproduction has been claimed. Linux visual goldens are excluded by the official macOS runner, with no baseline updates. |
| Browser acceptance, same isolated lane | 277 selected: 205 passed / 31 failed / 28 skipped / 13 did not run, with zero report errors. The latter 13 were not executed after suite prerequisites failed. Manual local-password author/reviewer approval evidence above is separate from this production-HMAC test-auth run. |

The first focused workbench run passed 12/17 including warmup; a later workbench/structured run passed 9/18. These original reports are retained. Their fixture failures led to real registered-module samples, an organization-only administrator for Catalog registration, and a resolved initial configuration revision for draft recovery. A bounded recheck of the nine failures passed 7/10 including warmup: structured navigation/search, history, Activity, Issues, canonical-review readiness and baselines passed. The remaining navigation fixture omitted the explicit organization scope; recovery completed all business assertions but its cleanup attempted to delete source-review-referenced fixtures; configuration management failed at entry readiness. After fixing scope and retaining all frozen members referenced by immutable source requests, the final fixed-tree run passed 5/5 in 220 seconds: navigation, recovery including cleanup, configuration management, the existing value-request rejection/audit flow with the new source type in its filter, and warmup. Zero failures, skips, flaky results or report errors. Its first startup was blocked by the standard auth probe with zero tests collected; an unchanged retry passed. Recovery advances its server base through an actual candidate and a separate reviewer's approval; it does not bypass raw-upload or immutable-history protections. Assertions and time limits remain unchanged.

The full browser run spans implementation and fixture repairs, including frontend HMR and one API restart. It is not a frozen whole-candidate acceptance result; the separate focused runs establish the repaired behavior. The original full failures remain in its report and receipt.

The 31 acceptance failures are accounted for as follows: seven require the dedicated Catalog PostgreSQL lane at 55438; three cannot verify a disposable API process identity; eight hit readiness/upload/staging request deadlines; two expect a simulator while the runtime uses HDC; three have navigation or role-detail interruptions of unknown cause; two use log-button selectors inconsistent with the unchanged HEAD source; one explicitly reports an unavailable toolchain; one interacts with an inert/loading search field. The other four concern this change: two old fixture expectations and one cleanup dependency are closed by the focused checks above; one whole-source approval case had a real document reload 37 ms after the edited text and dirty indicator appeared. The reload's trigger remains unknown. A final isolated run after full-report generation passed that unchanged source-approval case and warmup, 2/2 in 27.6 seconds, with the original immediate Preview switch and exact approval/source/Binding assertions. Nested frontend diagnostics recorded no reload, and no editor input logic was changed on speculation. This does not erase the full-run failure.

The source-revision implementation also passed 53 native schema/role/upgrade checks and the independent review of authorization, tenancy, identity, atomicity and concurrency seams. Native script checks used a dedicated three-service fixture that was removed afterward; two vendor-document checks used a separate temporary PostgreSQL fixture and are not evidence for the source-editor database. No hardware, Hosted, deployment or production acceptance is claimed. No tests, timeouts, screenshot baselines or frozen-program contracts were weakened to obtain these results.
