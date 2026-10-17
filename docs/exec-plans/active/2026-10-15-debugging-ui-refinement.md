# Debugging UI refinement

> Chinese: [调试界面整改](../../zh-CN/exec-plans/active/2026-10-15-debugging-ui-refinement.md)

Status: Implementation complete; PR CI pending. Owner: coordinating agent. Original base: `38d47f2ff4ed95944b4f42bce30a50c126bd08d1`; branch: `codex/frontend-refinement-20261015`. Integrate current `main` before delivery; the PR owns final base/head and merge receipts.

## Scope and acceptance

The user authorized every finding from the node-debugging/DTS reload UI review. Keep the existing isolated API environment at web port 5180/API port 8890, database port 55441, and checkout-local object storage. Preserve the primary checkout and all unrelated services.

- Bridge: accurate states; accessible connection recovery; current pairing codes; USB guidance; continuous bounded refresh; honest architecture/version choices; release retries; preserved rename drafts; truthful tool-install feedback.
- Node debugging: editor-local changes until explicit staging/writing; dirty-close confirmation; visible target/path/unit/risk; compact editor and table; complete expandable operation output.
- DTS reload: distinct preflight/deployment actions; discoverable batch editor; quiet unchanged values and normal states; focused editor; useful history and error recovery.
- Shared: close restores focus; Escape respects stacked confirmations; unchanged value previews contain no false additions/removals. Verify desktop 1440×900 and the affected compact 1280×800 layout.

Permissions, tenant isolation, snapshots, validation, audits and human device-write approval remain mandatory. The user subsequently authorized a GitHub PR and merge after required CI passes. Real-device writes, production changes and binary publication remain outside scope.

## Work and verification

1. Shared Bridge fixes and focused tests.
2. Node editor, table and history fixes and focused tests.
3. DTS editor, batch/preflight/history fixes and focused tests.
4. Coordinate shared focus/value preview changes, inspect combined diff, run impact selection, affected tests, changed-file lint, UI checks and build. Record selected additional gates honestly.
5. Inspect the real API routes and relevant error/keyboard states in a browser. Hardware, Hosted CI and deployment evidence remain separate.

## Documentation Impact Matrix

| Changed behavior | English / Chinese owners |
| --- | --- |
| Bridge guide and debugging workbench interaction | `docs/design-docs/ui-design-system.md`, `docs/zh-CN/design-docs/ui-design-system.md` |
| User-visible staging, preflight and connection flow | `docs/user-guide/device-debugging.md`, `docs/zh-CN/user-guide/device-debugging.md` |
| Scope, status and verification | This plan and its Chinese companion |

## Documentation Update Gate

Update both language companions to match the final behavior. Run `npm run docs:check` and report unavailable database documentation evidence separately. Do not mark complete before implementation and required local checks finish.

## Evidence

Implementation is present in the isolated worktree. Logs/screenshots: ignored `work/frontend-dev/`. Delivery state and exact-head CI results belong to the PR.

### Finding disposition

| # | Finding | Implemented behavior |
| --- | --- | --- |
| 1 | Closing stages unintended values | Local draft; explicit staging/writing; dirty dismissal confirms. |
| 2 | Misleading Bridge labels | Distinct checking, pairing, unavailable and connection states. |
| 3 | Connection hides recovery | Guide stays open, including connection errors and CLI recovery. |
| 4 | Expired pairing codes | Expiry check before launch; timed/manual renewal; separate errors. |
| 5 | No USB guidance after connection | All steps readable; cable, authorization and tool troubleshooting. |
| 6 | Wrong architecture/version recommendation | Manual Mac architecture; Windows installer/portable versions disclosed. |
| 7 | Polling gaps/overlap | Visible polling, focus/visibility refresh, in-flight deduplication and request timeouts. |
| 8 | Focus and stacked Escape | Original trigger survives StrictMode; active modal owns Escape. |
| 9 | Dense layered chrome | Flatter workbench and editors; supporting details collapsed. |
| 10 | Compact table overflow | Bounded navigation/columns, inspected at 1280×800. |
| 11 | Normal-state noise/blank targets | Quiet badges; explicit unset/offline placeholders. |
| 12 | Duplicate fields/oversized scalar input | Scalar input, current/target first, format details on demand. |
| 13 | Missing context/token jargon | Available device/path/unit/risk context; clearer action copy. |
| 14 | Inconsistent DTS dismissal | Shared dirty guard for close, context changes and batch actions. |
| 15 | Preflight/deploy ambiguity | Explicit start-preflight action, separate deployment confirmation. |
| 16 | Hidden batch tray | Before candidates; collapsible, bounded internal scrolling. |
| 17 | False +/- and empty panels | Unchanged values once; quiet normal/empty history summaries. |
| 18 | Retry/history/error gaps | Candidate/history/release/tool retries; expandable full operation output; accurate prerequisites. |
| 19 | Refresh overwrites rename drafts | Preserve edits; refresh untouched server names. |

Manual API browser observations cover both routes at 1440×900 and 1280×800, Bridge architecture/version/USB steps, dirty dismissal, stacked Escape and returned focus. No physical Bridge install/pairing or device writes were performed.

### Verification receipt

- Full frontend: 503 files / 4,537 tests passed (component-test mock mode). Later focus/DTS polish receives a separate final focused run.
- Full server: 641 files passed / 14 failed; 5,416 tests passed / 33 failed / 70 skipped; one unhandled PostgreSQL lock timeout. The impact command's inherited mock runtime caused evidence-capture rejections; other failures include missing pinned DTS tools, dedicated lane905 requirements, cluster-role lock waits and timeouts. This is failed local evidence, not backend acceptance; no before-change reproduction has been claimed.
- Changed TypeScript/TSX lint: exit 0, zero errors and ten warnings.
- Browser: API-backed routes, no application console errors captured in the final tab; unavailable local Bridge and device/toolchain paths do not establish physical-device or deployment acceptance.
- Hosted CI, Linux visual baselines, physical hardware and deployment: not run.

### Final local results

- Focused final run: four unaffected files / 117 tests passed, including StrictMode focus and Escape regression coverage. DTS initially had three stale assertions against the removed duplicate count; after updating only those copy assertions and adding summary guidance assertions, its 58 tests passed in `final-dts-rerun.log`. Functional batch/edit/reset/remove/pagination/download assertions remain.
- `npm run ui:check`: passed without changing baselines. `npm run build`: passed; existing large-chunk warning remains.
- `npm run docs:check`: passed, including PostgreSQL/pgvector schema-document verification.
- Full Bridge: 21 files / 142 tests passed.
- Full scripts: 144 files passed / 9 failed; 2,722 tests passed / 35 failed / 5 skipped. Failures include inherited mock/prefix configuration and Docker rehearsal fixture/database mismatches; they are not accepted as a green gate.
- Corrected API-mode reruns without the conflicting prefix: four server evidence files / 15 tests passed; three script evidence files / 57 tests passed. These do not replace the failed full-run receipt.
- Automated browser command: `npm run test:browser:codex -- --base 38d47f2ff4ed95944b4f42bce30a50c126bd08d1`, isolated lane 6574, localhost-only sandbox. Blocked on the quality production-bearer authentication probe (401). No automated browser acceptance pass; Linux-only baselines are skipped on macOS. Receipt: `test-results/lanes/6574/codex-browser-evidence.json`.
- Live services: both frontend routes and API `/health/live` returned 200. Readiness still lacks configured LLM, pinned DTS tools and an online Catalog publication. Manual API browser evidence is separate from the blocked automated lane.
- The primary checkout's pre-existing topology test edit and untracked `--help` remain untouched. No deployment or real-device writes were performed.

Implementation is complete for the 19 findings. Keep this plan active for the failed/unavailable broader acceptance gates; do not infer release acceptance.

Follow-up refinement also unifies the Bridge guide's typography, numbered connection/USB instructions and fixed drawer actions, presents node paths by directory segment with copy feedback, and uses multiline target editors for every writable node. The latest multiline pass covered 85 tests, including 40-line paste/stage/reopen preservation; build, UI standards and bilingual documentation checks passed locally. These scoped results do not replace the exact-head PR CI gates.
