# Configuration value editor refinement

> Chinese: [配置参数编辑整改](../../zh-CN/exec-plans/active/2026-10-19-configuration-value-editor.md)

Direction update: the user requested whole-file DTS editing with Preview/Edit switching. The proposed replacement is [DTS source editor implementation plan](2026-10-19-dts-source-editor.md). The implementation and verification below remain historical evidence for the typed editor; no source-editor replacement has been implemented by this planning update.

Status: implemented locally in `codex/frontend-ui-refinement`; broader regression acceptance remains incomplete. The existing uncommitted navigation filtering changes remain in the same worktree. Local API runtime only; delivery, deployment and device writes are outside this implementation request.

The accepted scope is the user's detailed configuration-workbench editor plan: bounded inspector previews, a wide editor sharing the same local draft, ordered string lists and arrays, explicit bulk-input formats, lossless incomplete input, pinned Definition schema validation, truthful local persistence and pending-review feedback. Reuse the current AST, sessions, dialogs and UI primitives; no new dependency or database migration.

## Execution

1. Correct shared parsing, complete-token validation, string escaping, bytes and exact integer boundaries. Preserve raw layout and mixed segments. Check sibling parser callers.
2. Implement compact typed editing, six-item previews, fifty-item expanded pages, bulk preview, ordered add/remove/move and accessible field errors.
3. Persist incomplete cells with their group positions in the existing scoped draft store, retaining old drafts. Report storage failures and protect new input from in-flight save receipts.
4. Integrate pinned Definition metadata, wide editing, errors, original-value disclosure and task-dock summaries. Input updates the count without automatically opening the task dock.
5. Verify the current combined candidate and update the existing English/Chinese frontend/user guides. Report scoped tests, selected regression, browser evidence and unavailable checks separately.

## Acceptance

Check 1/20/200-item strings and arrays, a 2,000-item stress sample, empty/duplicate/escaped strings, cleared intermediate cells, incomplete tokens, 32/64-bit limits, groups, bytes, repeated/parameterized references, mixed values and boolean deletion. Check mode changes, selection, refresh, permission locks, stale bases, failed/partial saves and new input while saving. Real API browser observations use 1440×900 and one compact PC viewport; inspect appearance, keyboard focus and errors.

Run focused behavior tests, `test:impact` with both fallback flags inspected, changed-file static coverage, build and selected UI/docs/contract gates. Required selected checks remain required; a focused pass is not full-regression or CI acceptance. Independent review covers the changed recovery/concurrency seams.

The affected acceptance and operation IDs are `PROJ-CONFIG-EDIT-001`, `PROJ-CONFIG-DRAFT-001` and `PROJ-CONFIG-INSPECT-001`, owned by `e2e/acceptance/project-configuration-workbench.acceptance.spec.ts`. Keep the existing typed save, recovery and inspector coverage; update it to explicitly open local changes after input, which now leaves the dock collapsed. Expanded editing, bulk formats, incomplete-cell recovery and save races also have focused component/session tests and real API browser observations.

## Local verification

The full frontend suite passed: 531 files and 5,301 tests, with no failures or skips. The full Bridge suite passed 21 files and 142 tests. Build, changed-file static coverage, UI standards, documentation and contract checks passed. Independent recovery/concurrency review findings were fixed and rechecked.

Real API browser observations at 1440×900 and 1280×800 covered escaped/empty/duplicate strings, unconfirmed-text refresh recovery, empty grouped cells, spreadsheet paste, 2,000-item pagination, exact 64-bit overflow, bytes, repeated references, mixed values, boolean deletion, undo and keyboard focus. The synthetic project intentionally has no canonical save binding; these observations do not claim a successful reviewed save for that project.

Both impact-selector fallback flags are true for the combined navigation/editor candidate. Expanded backend, scripts and browser runs were interrupted after failures were observed: the Agent suite requires a different PostgreSQL lane, database-lease tests timed out during concurrent cluster use, the live three-store fixture failed, and `/dts-reload` Bridge geometry assertions failed. The remaining full browser selection and selected acceptance specs were not completed. These attempts are not full-regression acceptance; their logs remain under ignored `test-results/local-dev/`. Full backend/scripts/browser checks and current-head CI remain required before merge. Linux visual baselines, deployment and real hardware acceptance remain unverified.

The database-lease file was rerun alone on a separate PostgreSQL instance: all 32 tests passed. The operation-evidence helper passed all 37 tests in API mode; its API-only expectation fails under the selector's mock-mode scripts command. Neither focused recheck replaces the incomplete full runs.

## Documentation Impact Matrix

| Document | Change |
| --- | --- |
| This plan and Chinese companion | Scope, implementation status and acceptance boundaries. |
| `docs/FRONTEND.md` and Chinese companion | Typed editing, pending input, pinned schema and persistence behavior. |
| Parameter-management user guide in both languages | Compact/wide editing, bulk formats and pending-review workflow. |

## Documentation Update Gate

Keep both language companions consistent with the final source and run documentation governance. Existing write/review APIs retain their authority; API documentation changes only if an actual public contract changes. Do not claim unrun regression or browser checks passed.
