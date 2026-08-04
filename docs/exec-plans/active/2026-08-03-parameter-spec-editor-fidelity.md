# Parameter spec editor fidelity

> Status: **Active** — SE-D1 through SE-D6 settled 2026-08-03; implementation not started
> Date: 2026-08-03
> Chinese: [`docs/zh-CN/exec-plans/active/2026-08-03-parameter-spec-editor-fidelity.md`](../../zh-CN/exec-plans/active/2026-08-03-parameter-spec-editor-fidelity.md)
> Governing IA: [ADR-0001](../../adr/0001-parameter-admin-organized-by-governance-scope.md), [ADR-0015](../../adr/0015-governance-queues-live-with-the-object-they-govern.md)
> Related decisions: [ADR-0010](../../adr/0010-attribution-tree-is-taxonomy-not-topology.md) (attribution is taxonomy), TD-047 (`driverModule` is display-only)
> Predecessor: [`2026-08-03-parameter-admin-org-ia-consolidation.md`](./2026-08-03-parameter-admin-org-ia-consolidation.md)

## Context

`ParameterSpecDetailDialog` is the only surface where an Admin edits a parameter definition. A field-by-field review on 2026-08-03 against the API contract found that the dialog and the write path disagree in both directions: it offers edits the server never persists, it hides edits the server would accept, and it renders four fields whose values cannot be anything but placeholder text.

Three of these are silent. The Admin edits the field, the request succeeds, a toast confirms, the dialog closes — and nothing changed. The mock runtime persists two of the three, so component tests are green on behavior the API does not have.

The dialog also sits below the Xiaoze floating action button. `.parameter-spec-library-layout > .modal-backdrop` resolves to the base `z-index: 1000` because the `.param-admin-shell > .modal-backdrop` rule at `styles.css:12347` requires a direct child, while `.xiaoze-chat-toggle-anchor` is `1100`. The same fault was already patched for one sibling dialog with an explanatory comment:

```css
/* src/styles.css:23671 */
.organization-driver-schema-stack-backdrop {
  /* Above Xiaoze FAB (1100) so dialog actions remain clickable. */
  z-index: 1300;
}
```

This plan closes the write-path defects first, then the display defects, then the dialog chrome.

## Goal

Every field the dialog presents as editable is persisted by the API; every field it presents as read-only is a fact the Admin can act on somewhere; nothing on the surface is permanently a placeholder. The dialog's actions are reachable and the dialog is operable from the keyboard.

## Non-goals

- Reopening D1/D2 in [`2026-07-30-parameter-governance-deferred-questions.md`](../../design-docs/2026-07-30-parameter-governance-deferred-questions.md). Whether a semantic edit to an active definition should mint a version or be forbidden stays deferred; this plan only makes the edit that already happens honest.
- Building the policy-target editing surface. This plan removes the broken field; see SE-D1.
- Changing lifecycle semantics. Deprecate/restore/cutover behavior is unchanged.
- Re-attribution from the spec editor. Under ADR-0010 the subject's placement is changed in 模块管理; this plan only makes that discoverable.
- Redesigning the definition library table.

## Git & PR Workflow

| Role | Allowed |
| --- | --- |
| Implementation agent | Commit on `feat/parameter-spec-editor-fidelity`; do not open or merge GitHub PRs |
| Parent agent | Review, run verification, open/merge the PR, then sync local `main` |

Branch: `feat/parameter-spec-editor-fidelity`, cut from `main` after the org IA consolidation branch merges. Batches 1 and 2 change the API contract and could ship separately from Batches 3–4, but the acceptance IDs overlap, so one branch with reviewable commits per batch is preferred.

## Findings this plan must close

Evidence was collected from the running app at `/parameter-admin/specs?spec=pspec:vendor/nodename/middle_cpu:active_perf_limit` plus the server sources named below.

### Writes that silently do nothing

| ID | Finding | Evidence |
| --- | --- | --- |
| SE-1 | **`policyTarget` is never persisted.** `updateParameterSpecBodySchema` accepts it and `handleSaveSpec` sends it, but `updateParameterSpec` only writes `parameter_spec_versions` and `dts_property_specs`. `parameter_policy_targets` is never touched. | `server/modules/parameter-specs/service.ts:1222-1262`; contrast the mock at `src/infrastructure/mock/mockParameterTopologyRepository.ts:632`, which does persist it |
| SE-2 | **A constraint key cannot be removed.** The server shallow-merges: `{ ...spec.constraints, ...input.constraints }`. Deleting a key in the JSON editor and saving leaves the key in place. | `server/modules/parameter-specs/service.ts:1214-1217`; same merge in `activateParameterSpec` at `:936-939` |
| SE-3 | **`units` cannot be cleared.** SQL uses `units = coalesce($7, units)` while the client sends `units: null` for an emptied field, so null reads as "not provided". `exampleValue` behaves differently on the same path because `JSON.stringify(null)` produces a jsonb `null` that survives `coalesce`. | `server/modules/parameter-specs/service.ts:1229-1242`; `buildSpecEditorSavePayload` at `src/components/parameter-topology/ParameterSpecDetail.tsx:149` |
| SE-4 | **The activate path drops three visible fields.** `activateParameterSpecBodySchema` does not accept `units`, `exampleValue`, or `policyTarget`, and the `mode === "activate"` branch does not send them — yet the dialog renders all three as editable on org-owned drafts. | `server/modules/parameter-specs/schemas.ts:159-180`; `src/components/parameter-admin-next/OrganizationSpecGovernancePanel.tsx:406-414` |
| SE-5 | **Opening and saving writes a display name that was never entered.** `createSpecEditorDraft` pre-fills `displayName` with `propertyKey`, and `buildSpecEditorSavePayload` falls back to `propertyKey` again. "No display name" is inexpressible and cannot be restored. | `src/components/parameter-topology/ParameterSpecDetail.tsx:75,147` |

### Validation gap

| ID | Finding | Evidence |
| --- | --- | --- |
| SE-23 | **PATCH never checks value-shape completeness, and live data already fails it.** `assertSpecActivatable` requires `bits` / `groups` / `cellsPerGroup` for `cells`, `phandle-list`, and `u32-array`, but `updateParameterSpec` does not call it. The measured active spec `active_perf_limit` holds `{"kind": "u32-array"}` with none of them — a shape activation would reject. This blocks SE-10 on its own: a `valueShape` editor that fills in the missing keys would silently change the shape on open-then-save, which is SE-5 again. | `server/modules/parameter-specs/specCompleteness.ts:71-100`; `service.ts:1213` (no completeness call); runtime measurement |

### Fields that cannot carry a real value

| ID | Finding | Evidence |
| --- | --- | --- |
| SE-6 | **业务分类 is always `—`.** `reloadSpecs` never passes `businessCategory` into `mapParameterSpecToLibraryRow`, the library table no longer renders the column, and only the URL filter key survives. | `src/components/parameter-admin-next/OrganizationSpecGovernancePanel.tsx:161-177`; `src/components/parameter-topology/ParameterSpecLibrary.tsx:92,262` |
| SE-7 | **驱动模块 is a suffix of 所属模块.** Measured on `active_perf_limit`: 驱动模块 = `middle_cpu`, 所属模块 = `Power / Battery / Battery Protection / hisi_vbat_drop_protect_v2 / middle_cpu`. The library table's column *named* 驱动模块 shows the full path, so one label means two things across two surfaces. | `formatSpecAttributionLabel` / `formatSpecDriverModuleLabel` at `src/components/parameter-topology/ParameterSpecLibrary.tsx:110-152`; TD-047 |
| SE-8 | **使用与历史 is synthetic.** `toSpecDetailView` hard-codes `usage: []`, so 使用情况 can only render the fallback string; `schemaHistory` is one row assembled from `currentVersion`, measured as `v1 · vendor/nodename/middle_cpu`. | `src/components/parameter-admin-next/OrganizationSpecGovernancePanel.tsx:65-68` |
| SE-9 | **引用数 is stated twice.** The header shows `引用数：0` and 使用情况 shows `暂无项目参数` for the same fact. | `src/components/parameter-topology/ParameterSpecDetailDialog.tsx:150-154` |

### Editing affordances

| ID | Finding | Evidence |
| --- | --- | --- |
| SE-10 | **`valueShape.kind` is a closed enum rendered as free JSON.** The server union admits `bool`, `empty`, `string-list`, `u32-array`, `phandle-list`, `bytes`, `mixed`, `unknown`. | `server/modules/parameter-specs/schemas.ts:251-261` |
| SE-11 | **Four visually identical mono editors, two contracts.** `parseJsonField` special-cases 示例值 and 策略目标 to accept plain strings on parse failure, while 值形状 and 约束 must be JSON objects. The measured 示例值 is a DTS fragment, not JSON. | `src/components/parameter-topology/ParameterSpecDetail.tsx:96-98` |
| SE-12 | **值类型 and 值形状 restate one fact and desynchronize.** 值类型 is read-only and derived from `valueShape.kind` at load; editing the JSON does not update it. | `src/components/parameter-topology/ParameterSpecLibrary.tsx:63-70` |
| SE-13 | **修改原因 is required but unmarked.** Validation happens only on save. | `src/components/parameter-topology/ParameterSpecDetail.tsx:136-138,394-402` |
| SE-14 | **Read-only is signalled only by a background tint.** Measured `rgb(240, 243, 255)` versus `rgb(255, 255, 255)`, with identical borders and no icon or text marker. | `src/styles.css:16425-16430` |
| SE-15 | **The header claims 可编辑 on deprecated definitions.** `editable` is `typeof onSave === "function"` and ignores `isDeprecated`, while the body is rendered with `editable && !isDeprecated`. | `src/components/parameter-topology/ParameterSpecDetailDialog.tsx:48,139,225` |
| SE-16 | **The documented pre-save diff does not exist.** D2 records that "the frontend shows a diff plus the reference count before saving". The reference count is present; there is no diff component in the spec editor. | `docs/design-docs/2026-07-30-parameter-governance-deferred-questions.md:41` |

### Dialog chrome

| ID | Finding | Evidence |
| --- | --- | --- |
| SE-17 | **The Xiaoze FAB renders above the modal and overlaps 保存.** Measured backdrop `z-index: 1000` versus FAB `1100`; at 1024×747 the FAB occupies `x 944-1000, y 667-723` and 保存 occupies `x 905-969, y 645-679`. | `src/styles.css:9425-9428,12347,12729-12733`; patched precedent at `:23671-23674` |
| SE-18 | **The scroll boundary cuts a field in half with no affordance.** Body scroll height 1545px against a 640px viewport; the action bar abuts the cut with no separator or shadow. | `.param-admin-editor-dialog-body` at `src/styles.css:16694-16700` |
| SE-19 | **Focus never enters the dialog.** After opening, `document.activeElement` is still the 编辑 button behind the modal; there is no focus trap and Tab reaches background content. | Runtime measurement |
| SE-20 | **`role="dialog" aria-modal="true"` is on the full-screen backdrop, not the dialog card.** `id="parameter-spec-detail-dialog-title"` on the `h2` is referenced by nothing — `aria-labelledby` is unused. | `src/components/parameter-topology/ParameterSpecDetailDialog.tsx:126-140` |
| SE-21 | **Escape closes the editor from inside the deprecate/restore confirmation.** The keydown listener does not check `lifecycleKind`. The confirmation's 取消 button also lacks `disabled={pending}`. Both dialogs are `aria-modal="true"` at once. | `src/components/parameter-topology/ParameterSpecDetailDialog.tsx:71-79,278-317` |
| SE-22 | **Inline styles in the cutover panel.** `style={{ marginBottom: "1rem" }}` and `style={{ marginTop: "0.75rem" }}`, the anti-pattern the predecessor plan removed elsewhere. | `src/components/parameter-topology/ParameterSpecDetailDialog.tsx:169,189` |

## Decisions (settled 2026-08-03)

### SE-D1 — 策略目标 is removed from the dialog

`parameter_policy_targets` has **no writer anywhere in the repository**. `insert into parameter_policy_targets` returns zero matches; `migration.ts:1468` states "Never promote recommended_value into schema_default or policy_target"; `migration.test.ts:796-800` asserts the table stays empty after migration. Three readers (`repository.ts:1227`, `editService.ts:354`, `perceptionTools.ts:121`) read a table nothing writes.

The field therefore displays a value that is always null and accepts an edit that goes nowhere. It is also structurally unable to work as a definition-level field, because the table is keyed by `(organization_id, parameter_spec_id, product_code)` and the detail read picks the most recently updated row across all products.

Remove `policyTarget` from the dialog, from `updateParameterSpecBodySchema`, from `UpdateParameterSpecInput`, and from the mock. Leave the table and its three readers alone. File **TD-055** for the product-scoped policy-target surface.

### SE-D2 — `constraints` replaces instead of merging

Enumerated 2026-08-03: the only production caller of `PATCH /api/v2/parameter-specs/:specId` is `OrganizationSpecGovernancePanel.tsx:417`; `activateParameterSpec` has two, both in the same file (`:407`, `:650`). Every other reference is a test. `assertSpecActivatable` validates `constraints.cells` only when it is a number (`specCompleteness.ts:101-124`), so dropping keys cannot break activation. The existing audit test starts from `previousConstraints: {}` (`specLifecycle.integration.test.ts:310`) and is unaffected.

Apply replace to both `updateParameterSpec` and `activateParameterSpec`. Note that activate's merge currently lets a caller omit constraints and inherit the draft's inferred `{ cells: N }`; under replace the client must send the full object, which the editor already does because `constraintsText` is seeded from the stored value.

### SE-D3 — key presence in the parsed body is the intent signal

Zod already preserves the distinction — `units: null` parses to `null`, an omitted key parses to `undefined` — and the service throws it away with `coalesce`. Replace each `coalesce` with `case when $flag then $value else column end` where `$flag` is `input.field !== undefined`. Apply to `units`, `displayName`, `description`, and `exampleValue` so the four stop behaving differently by accident.

Change `displayName` and `description` to `.nullable().optional()` so null can be sent, and drop the frontend's `propertyKey` fallback in both `createSpecEditorDraft` and `buildSpecEditorSavePayload`. **This closes SE-5 in the same change.**

### SE-D4 — the activate body grows, and the editor reuses the create dialog's shape control

`createParameterSpecBodySchema` already accepts `units` and `exampleValue`, and `SpecCreateDialog.tsx:288-289` sets both. A draft can therefore carry both from birth with no way to correct them until after activation. Hiding the fields would make create → activate lossy.

Grow `activateParameterSpecBodySchema` with `units` and `exampleValue` to match update. Do not add `policyTarget` (SE-D1).

`SpecCreateDialog` already solves SE-10 and SE-11: `valueShapeKind` is a `<select>` over `VALUE_SHAPE_OPTIONS`, with conditional `bits` / `groups` / `cellsPerGroup` / `length` numeric inputs assembled by `buildValueShape`, a `defaultConstraintsForShape` fallback with an example placeholder, and 示例值 labelled "（JSON，可空）" behind `parseOptionalJson`. Extract that control and reuse it in the editor rather than authoring a second one.

Implementation note, not a decision: `assertSpecActivatable`'s `storedValueShape` guard (`specCompleteness.ts:137-149`) forbids changing `kind` / `bits` / `groups` / `cellsPerGroup` / `length` / `cells` on activate once the draft has an inferred shape. The current draft hint 「值形状 valueShape · ⓘ 激活前可修订」 is wrong for those drafts and must change with it.

### SE-D5 — implement the pre-save diff

D2's audit half already landed: `spec-updated` metadata carries `previousValueShape`, `nextValueShape`, `previousConstraints`, and `nextConstraints`, covered by `specLifecycle.integration.test.ts:310`. Only the frontend half is missing, and it is cheap — `detail.valueShape`, `detail.constraints`, and the draft text are all in hand.

Show a before/after for `valueShape` and `constraints` whenever either changed, and require an explicit confirmation step when `referenceCount > 0`. `2026-07-30-parameter-governance-deferred-questions.md:41` then becomes true as written.

### SE-D6 — PATCH validates value shape, but only when it changed

`updateParameterSpec` never calls `assertSpecActivatable`, and existing active data already violates it (SE-23). Validating unconditionally would block unrelated documentation edits on every pre-existing violation; not validating at all would let the new shape editor write shapes activation refuses.

Call `assertSpecActivatable` from `updateParameterSpec` only when the incoming `valueShape` differs from the stored one. Pair this with the SE-23 constraint on the shape editor: it must not auto-populate missing keys on load, so opening and saving an incomplete legacy spec stays a no-op on shape.

## Risks

| ID | Risk | Required handling |
| --- | --- | --- |
| SE-R1 | **Closing SE-2 and SE-3 changes write semantics for existing callers.** | Caller enumeration is done (see SE-D2) and the blast radius is one production caller each. Remaining handling: add server integration coverage for "remove a constraint key", "clear units", and "clear display name" in `specLifecycle.integration.test.ts`, plus an activate-path case for the two new fields. |
| SE-R2 | **Mock and API already disagree on `policyTarget`.** Under SE-D1 the mock's persistence at `:632` becomes dead code that would keep component tests green on a removed field. | Change `mockParameterTopologyRepository.ts` in the same batch as the server, not after. |
| SE-R3 | **Removing SE-5's fallback changes what an empty display name means.** | Confirm no reader assumes `displayName` is non-null. `formatSpecPrimaryLabel` already uses `propertyKey`, so display is safe, but the check must cover the workbench, the review queue candidate labels, and export paths. |
| SE-R4 | **Merging 驱动模块 into 所属模块 touches TD-047's display-only contract and acceptance selectors.** | Keep API `driverModule` unchanged. Rename or remove only in the dialog and, if the table column is renamed, re-point every acceptance selector that reads the column header in one commit. |
| SE-R5 | **Raising the modal above the FAB must not put it above the Xiaoze popup.** | The popup layer is `1200` and two sibling backdrops already claim `1300` / `1400`. Fix the selector so `.param-admin-shell` descendants inherit one deliberate value rather than adding a fourth ad-hoc number. |
| SE-R6 | **A focus trap must follow the top-most dialog.** The deprecate/restore confirmation stacks on the editor. | Trap and restore focus per dialog, and make Escape close only the top-most one (SE-21). |
| SE-R7 | **Deleting the 使用与历史 group removes a surface an operator may rely on.** | Confirm the group is placeholder-only for every spec, not just the sampled one, before deleting rather than backfilling. |

## Delivery batches

### Batch 1 — writes that silently do nothing

1. [x] Settle SE-D1 through SE-D6 and record each in this plan.
2. [x] Close SE-1: remove `policyTarget` from the dialog, `updateParameterSpecBodySchema`, `UpdateParameterSpecInput`, and the mock; file TD-055 for the product-scoped surface.
3. [ ] Close SE-2: constraints replace on both `updateParameterSpec` and `activateParameterSpec`.
4. [ ] Close SE-3 and SE-5 together: `case when $flag` in place of `coalesce` for `units` / `displayName` / `description` / `exampleValue`; `displayName` and `description` become nullable; drop the frontend `propertyKey` fallback.
5. [ ] Close SE-4: `activateParameterSpecBodySchema` gains `units` and `exampleValue`; the activate branch sends them.
6. [ ] Close SE-23 per SE-D6: `updateParameterSpec` runs `assertSpecActivatable` when `valueShape` changed.
7. [ ] Keep the mock in step with every contract change in this batch (SE-R2).
8. [ ] Server integration coverage per SE-R1.

### Batch 2 — fields that cannot carry a real value

9. [ ] Remove 业务分类 (SE-6) and the dead `businessCategories` filter key if nothing else reads it.
10. [ ] Collapse 驱动模块 and 所属模块 into one attribution field (SE-7), respecting SE-R4, and add a discoverable path to 模块管理 for changing placement.
11. [ ] Resolve 使用与历史 (SE-8) — backfill `usage` and real version history, or delete the group per SE-R7.
12. [ ] Remove the duplicate reference-count statement (SE-9).

### Batch 3 — editing affordances

13. [ ] Extract `SpecCreateDialog`'s value-shape control (`VALUE_SHAPE_OPTIONS`, `needsCellFields`, `buildValueShape`, `defaultConstraintsForShape`) into a shared component and use it in the editor (SE-10, SE-12, SE-D4). It must not auto-populate keys the stored shape lacks (SE-23).
14. [ ] Keep 值类型 in sync with the shape control or drop it (SE-12).
15. [ ] Visually and semantically separate the JSON editors from the free-text ones (SE-11), reusing `parseOptionalJson` semantics and adding inline validation feedback.
16. [ ] Mark 修改原因 required (SE-13); mark read-only fields with more than a tint (SE-14).
17. [ ] Correct the 可编辑 / 只读 eyebrow on deprecated definitions (SE-15), and the draft hint 「激活前可修订」 per the SE-D4 implementation note.
18. [ ] Close SE-16 per SE-D5: before/after for `valueShape` and `constraints`, with a confirmation step when `referenceCount > 0`.

### Batch 4 — dialog chrome

19. [ ] Fix the backdrop stacking so dialog actions are never covered (SE-17, SE-R5).
20. [ ] Give the scroll boundary a separator or shadow and stop cutting mid-field (SE-18).
21. [ ] Add focus trap, initial focus, and focus restore (SE-19, SE-R6).
22. [ ] Move `role="dialog"` onto the dialog card and use `aria-labelledby` (SE-20).
23. [ ] Scope Escape to the top-most dialog; disable the confirmation's 取消 while pending (SE-21).
24. [ ] Replace the cutover panel's inline styles with classes (SE-22).

### Batch 5 — tests, acceptance, docs

25. [ ] Unit coverage for `buildSpecEditorSavePayload` and `createSpecEditorDraft` on every changed rule.
26. [ ] Register and cover the new acceptance IDs below.
27. [ ] Work the Documentation Impact Matrix, including TD-055.
28. [ ] playwright-cli evidence at 1440×900 / 768×1024 / 390×844 with 0 console errors, covering an active spec, an org-owned draft, and a deprecated spec.

## Key seams (starting points)

- Dialog shell, lifecycle sub-dialog, cutover panel: `src/components/parameter-topology/ParameterSpecDetailDialog.tsx`.
- Field layout, draft construction, payload building, JSON parsing: `src/components/parameter-topology/ParameterSpecDetail.tsx`.
- Row mapping and attribution label helpers: `src/components/parameter-topology/ParameterSpecLibrary.tsx:40-152`.
- Detail view assembly and save dispatch: `src/components/parameter-admin-next/OrganizationSpecGovernancePanel.tsx:31-70,389-445`.
- Write contract: `server/modules/parameter-specs/schemas.ts:159-207`; service at `service.ts:905-1294`.
- Detail read (including the policy-target lateral join): `server/modules/parameter-specs/repository.ts:1195-1270`.
- Mock parity: `src/infrastructure/mock/mockParameterTopologyRepository.ts:587-640`.
- Stacking: `src/styles.css:9425,12347,12729,23671`.

## Documentation Impact Matrix

| Area | Action | Paths |
| --- | --- | --- |
| Repository maps | Review | `AGENTS.md`, `ARCHITECTURE.md` — confirm neither describes the spec editor's fields |
| Planning | Update | this plan; `docs/PLANS.md`; `docs/zh-CN/PLANS.md`; ZH companion plan; `docs/exec-plans/tech-debt-tracker.md` for TD-055 and anything else deferred |
| Architecture / ADR | Review | SE-D2 is settled as a defect fix, not a new governance rule, so no ADR is expected; record that conclusion rather than leaving the row blank |
| Domain glossary | Update | `CONTEXT.md` — 「Policy target」 must state that the concept has no writer today (SE-D1) so the next reader does not rebuild the same dead field |
| Product specs | Review | `docs/product-specs/prototype-functional-spec.md` for the definition-editing description |
| API contract | Update | `docs/design-docs/api-contract.md` and `docs/references/productization-api-contract-draft.md` for the changed PATCH/activate bodies |
| Design docs | Update | `docs/design-docs/2026-07-30-parameter-governance-deferred-questions.md:41` must become true under SE-D5; note D2's relationship to SE-2 |
| Frontend / design | Update | `docs/FRONTEND.md` and `docs/zh-CN/frontend.md` where they describe the spec editor |
| Quality / testing | Update | `docs/developer/browser-acceptance-coverage-map.md` (+ ZH) and `docs/developer/user-operation-coverage-matrix.md` (+ ZH) for the new IDs |
| Security / governance | Review | `docs/SECURITY.md` — the audit metadata for `spec-updated` should reflect any newly persisted field |
| Reliability / runbooks | Review | `docs/runbooks/parameter-identity-cutover.md` if it references the editor |
| Generated artifacts | Review | `docs/generated/acceptance-operation-evidence.md`; `docs/generated/db-schema.md` if any migration lands |
| References | Review | `docs/references/*` for quoted editor copy or field lists |

## Documentation Update Gate

Before moving this plan to `completed/`:

1. Every Impact Matrix `Update` / `Review` row is updated or recorded unchanged with evidence.
2. SE-D1 through SE-D6 are recorded with their reasoning — done 2026-08-03; revisit only if implementation contradicts one.
3. All twenty-three SE findings are closed or explicitly deferred into `exec-plans/tech-debt-tracker.md`.
4. All seven SE-R risks are closed with evidence.
5. TD-055 is filed for the product-scoped policy-target surface (SE-D1).
5. `npm run docs:check`, `npm run acceptance:coverage`, and `npm run acceptance:operations` are green.

## UI interaction coverage

This plan changes form behavior, modal behavior, and backend responses that drive visible UI state, so the UI Interaction Automation Rule applies.

Existing IDs and their exposure:

- `PARAM-SPEC-GOVERN-001` (blocking) exercises spec review, not the editor, and should keep passing unchanged.
- `PARAM-ADMIN-IA-001` (from the predecessor plan) covers the organization sub-navigation and must keep passing.
- No existing ID asserts that an edit made in the spec editor is still present after reopening the dialog. That absence is why SE-1 through SE-5 survived.

New IDs to register in `docs/developer/browser-acceptance-coverage-map.md` **before** implementation is claimed complete:

- `PARAM-SPEC-EDIT-001` — an Admin edits units, constraints, example value, and documentation on an active definition, saves, reopens, and every value round-trips; removing a constraint key removes it; clearing units clears it.
- `PARAM-SPEC-EDIT-002` — the editor's actions are reachable and operable at 1440×900 / 768×1024 / 390×844 with the Xiaoze FAB present; focus enters the dialog on open and returns to the trigger on close.

## Verification

```bash
npm test -- src/components/parameter-topology
npm test -- src/ParameterAdminNextPage.test.tsx src/ParameterAdminNextPage.a11y.test.tsx
npm run test:server -- parameter-specs
npm run build
npm run docs:check
npm run acceptance:coverage
npm run acceptance:operations
# Browser evidence under work/ui-checks/param-spec-editor/
```
