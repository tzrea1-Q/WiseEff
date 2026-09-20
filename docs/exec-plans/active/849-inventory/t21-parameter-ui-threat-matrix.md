# T2.1 parameter UI on canonical data — pre-implementation threat matrix

> Chinese: [中文](../../../zh-CN/exec-plans/active/849-inventory/t21-parameter-ui-threat-matrix.md)

Contract: #849, #853 T2.1, closed [#847](https://github.com/tzrea1-Q/WiseEff/issues/847), [ADR-0046](../../../adr/0046-source-occurrence-identity-spans-dts-and-software-configuration.md), T1.3 [acceptance](t13-complete-successor-acceptance.md). Product direction (complete parameter UI on canonical data, integrate #847, B5 canonical pending-draft adapter, PC 1440x900, real services) is already decided. This matrix freezes the remaining implementation and evidence boundary.

Status: **design Spec PASS with P2; implementation local candidate complete.** Companion: [implementable design](t21-parameter-ui-design.md), [acceptance](t21-parameter-ui-acceptance.md). No commit, PR, or seal.

## Lane and boundaries

- Worktree: `/Users/tzrea1/Develop/WiseEff-worktrees/849-853-t11-source-identity`, branch `codex/849-853-t11-source-identity`.
- Inherited HEAD `f9c710f6a90d67462965a06abd47e33aa200e75e`; accepted main `46b6068693942b95f7cba28ee5de6748a97170fa`. T1.1–T2.4 remain uncommitted dirty candidates and are not rewritten.
- Risk **R2** (public UI workflow, authorization, real API). Independent Spec review of this matrix and the design precedes production edits. Independent Standards and Spec review of the resulting candidate follows local green.
- Stop after T2.1 local delivery. No T2.2 consumer families, T1.4 cutover, T3.x S1/S2/Hosted/target, commit, PR, merge, or Issue mutation.
- Browser acceptance is **one PC viewport, 1440x900**. Historical tablet/mobile artifacts stay historical.
- Requested independent-review model `gpt-5.6-luna` / `max` is unavailable; reviewers use `grok-4.6` and must disclose that substitution.

## Invariant under protection

On canonical Catalog data (not mock, not legacy `parameter_drafts` as the current owner), a user can create, edit, remove and reload parameter drafts; select reason and eligible assignees; reject, withdraw and resubmit with actor separation; review and apply; inspect source diff, history, compare, baseline, export and reimport. Definition/module navigation, search, filter, pagination, counts, registration, initialization and honest empty/error states remain truthful. DTS and JSON operations work. Archived-link notice is dismissible and non-editable; authorized gone and scope-hidden 404 do not leak archive payload. Unmatched import preview does not look like a successful new-parameter apply. Evidence is real API + PostgreSQL at 1440x900 with keyboard/focus and console/network notes.

## Intake (2026-09-17)

- #847 is **closed**. CatalogPage (module navigator + definition table + lifecycle/correction dialogs) exists. T2.1 integrates that workspace; it does not build a second one. Remaining #847 decision-6 editor fields (`schemaDefault`, editable constraints, editor examples) are **not** T2.1 unless they block the T2.1 operation list.
- B5 code exists: `createCanonicalDraftTraySource` lists/deletes `GET|DELETE /api/v2/projects/:projectId/parameter-value-drafts`. `ParametersPage` injects it in API mode. Unit tests prove no `/api/v1/parameter-drafts` call. **Live browser proof against a real canonical draft is still missing** (round report / acceptance matrix).
- `docs/FRONTEND.md` still documents tray delete as `DELETE /api/v1/parameter-drafts/:draftId` — stale vs B5.
- Existing Playwright owners already cover much of the operation list on post-cutover disposable runtimes at 1440x900: `parameter-topology.acceptance.spec.ts`, `parameters.acceptance.spec.ts`, `parameter-catalog*.acceptance.spec.ts`, `parameter-files.acceptance.spec.ts`, `parameter-import-wizard.acceptance.spec.ts`, archived-link acceptance from #876. T2.1 reuses them; it does not replace Gate0.
- `matchToLibrary` marks unmatched import rows `status: "pending"` with no `existingParameter` (“pending new candidates”). That is the misleading unmatched-import preview T2.1 names. Canonical Catalog does not mint a new Definition from an unmatched import row.
- T1.3 124/372 is seed/materialize evidence, not the T2.1 UI fixture. T2.1 data plane is **canonical identity mode** (existing disposable post-cutover runtime). Inventing a second Gate0 that runs T1.3 vendor import + 372 bindings is out of scope.
- Mock mode cannot establish T2.1 acceptance.
- Helper PG for any extra server tests: 55438 disposable DB, never `wiseeff_lane_849`, never compose `5432/wiseeff` as acceptance.

## Rows

| ID | Dimension | Expected observation | Evidence owner |
| --- | --- | --- | --- |
| T21-01 | #847 integration | `/parameter-admin/specs` remains the #847 workspace. T2.1 adds no parallel definition table. Catalog list still carries `totalCount`/`hasMore` | existing catalog acceptance + no new page |
| T21-02 | B5 live tray | After a typed canonical draft save, reload shows the draft in the tray with `reason` and `updatedAt`. Tray remove calls canonical DELETE and the draft does not resurrect. No `/api/v1/parameter-drafts` | new/extended topology or parameters acceptance + `canonicalDraftTraySource` tests |
| T21-03 | Create/edit/remove/reload | Binding typed edit → draft → tray; edit; remove; reload. Keyboard: reason field and dialog focus | existing topology spec + T21-02 |
| T21-04 | Reason / assignees | Submit requires a reason; eligible assignees are role-faithful; self-approval remains forbidden | existing parameters/review specs |
| T21-05 | Actor separation | Author cannot approve own request. Reviewer reject/withdraw/resubmit stay distinct actors | `parameters.acceptance.spec.ts` |
| T21-06 | Review / apply | `/parameter-review` applies canonical project-value changes through `CanonicalProjectValueReviewPanel` when the request is canonical | existing review UI + focused case |
| T21-07 | Diff / history / compare / baseline / export / reimport | Binding detail history and compare; file baseline/export; reimport stages drafts not current values | existing topology + files specs |
| T21-08 | Navigation | Module navigator, search, filter, pagination, truthful counts on `/parameters` and `/parameter-admin/specs` | existing specs |
| T21-09 | Registration / init / empty / error | Honest empty and API error states on `/parameters` via existing negative specs. `PARAM-INIT-*` remain `coverage: "future"`; initialization Playwright is **deferred to T2.2-PRJ / T3.2**, not claimed as an existing T2.1 owner | parameters-negative; explicit deferral |
| T21-10 | DTS and JSON | DTS typed edit on a canonical binding; JSON pointer edit on a ConfigurationSchema binding when the fixture has one. YAML/TOML/ENV stay refused | topology + import + unsupported-format |
| T21-11 | Archive / 404 | Archived-link banner dismissible, target not editable; authorized gone; other-org 404 without archive body | #876 + parameters-negative |
| T21-12 | Unmatched import | Unmatched rows are **not** `pending` new candidates. Preview shows they will not apply; apply does not create Definitions. Path is observation/authoring or explicit ineligible | `matchToLibrary` + import wizard |
| T21-13 | Mock ≠ acceptance | API runtime only. Component tests do not prove T21-02/T21-05 | receipt |
| T21-14 | Viewport | 1440x900 only. Compact 1280x800 only if a layout defect is found | checklist |
| T21-15 | Environment | Disposable post-cutover acceptance runtime (existing Gate0 owner). Extra server tests on 55438 disposable DB. Not `wiseeff_lane_849`, not compose `5432/wiseeff` | runtime helpers |
| T21-16 | Doc honesty | FRONTEND.md tray delete documents the canonical v2 route | FRONTEND.md + zh-CN twin |
| T21-17 | Non-goals | T2.2 eleven families, T1.4 zero-legacy-allowance, T3.1 full `test:server`, Hosted, target | receipt |
| T21-18 | Keyboard / console | Changed dialogs keep focus trap/restore. Console/network: distinguish expected 4xx from regressions | ui checklist + diagnostics |

## Non-goals

- Rewriting #847, reopening decision-6 leftover editor fields unless they block T2.1 operations.
- Running T1.3 vendor successor + 372 bindings inside Gate0 as the UI fixture.
- T2.2 consumer-family allowance ratchet, T1.4 cutover, T2.3 disposal.
- Three-viewport sweeps.
- Commit, PR, merge, Hosted, target, Issue mutation.

## Self-review limit

This matrix was written by the coordinating implementer. Independent Spec review is required before production edits; this file is not that review.
