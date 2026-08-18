# Referenced property-key rename is a source-file rewrite cutover

> Status: **Active** — start + finalize on `main` (#549). This slice stages file-candidate drafts on prepare and adds a minimal spec-editor panel. TD-117 stays **Open** until operators routinely complete human merge + finalize.  
> Date: 2026-08-18  
> Branch: `feat/td-117-property-key-prepare-ui`  
> Chinese: [`docs/zh-CN/exec-plans/active/2026-08-18-property-key-source-cutover.md`](../../zh-CN/exec-plans/active/2026-08-18-property-key-source-cutover.md)  
> Governing decision: [ADR-0034](../../adr/0034-referenced-property-key-rename-is-a-source-cutover.md)  
> Tracker: [TD-117](../tech-debt-tracker.md) (session 0 owns the index)

## Goal

Operators who bound a mistyped `property_key` get a **dedicated staged cutover**: rewrite the key in each binding's **source file** first (draft / change request, existing review path), then **finalize** by updating the catalog triple (`property_key` + derived `specification_key` / `schema_namespace`) so ingest matches the already-rewritten sources.

This plan does **not** claim the product job is finished. #544 shipped the locked architecture plus a read-only preview. #549 shipped start + finalize. This branch ships **prepare staging**: rewrite old key → new key into an existing parameter-file candidate (no live activate), plus a minimal Admin panel (`preview` → `start` → `prepare` → human merge → `finalize`). Finalize still requires the live source to already show the new key. Parameter-value CR is not minted — that seam cannot rename a property.

## Locked decisions (do not reopen)

From ADR-0034. Do not change that file's Locked conclusions.

| Rejected | Why |
| --- | --- |
| Forbidden forever | Zero-ref rename already covers the cheap case; the expensive case needs a migration, not a dead end |
| Editor inline rename + confirmation | Confirmation does not rewrite DTS; catalog and source would diverge |
| Catalog alias (ingest accepts old and new) | Hides whether a project actually moved; writeback would guess the emitted name |
| Deprecate + recreate | Second identity, split reference counts, typo row still releasable (ADR-0011 / ADR-0017) |
| Fold into version cutover (ADR-0032 / ADR-0014 tables) | Identifier change ≠ semantic-content change; different finalize writes |

Zero-reference rename stays on `POST /api/v2/parameter-specs/:specId/rename-property-key`. While `referenceCount > 0`, that route stays `409` `{ parameterSpecId, referenceCount }` and the editor's 「修正属性键」 stays **disabled** until finalize exists.

## Architecture

Shape mirrors ADR-0014 version cutover (prepare items → ready → atomic finalize) but **not** its tables or blast radius.

```text
Admin starts run (from_key / to_key)
        │
        ▼
Prepare: per binding tip, stage a source rename
         (old key → new key, same raw value)
         via existing parameter-file candidates
         catalog triple UNCHANGED
        │
        ▼
Humans activate the candidate in the configuration workbench
        │
        ▼
Finalize (one transaction): rewrite catalog triple
         so it matches already-rewritten sources
         audit: spec-property-key-cutover-finalized
```

1. **Start** (this slice). Admin (`platform-admin` for platform-global rows, otherwise org Admin) starts a property-key cutover on a spec with `referenceCount > 0`: proposed `propertyKey` + `reason`. Refuse on triple collision (including deprecated blockers), an open **version** cutover on the same spec, or an already-open property-key cutover. Persist `from_key` / `to_key` on the run and one item per preview location (existing binding / occurrence identities).
2. **Prepare — stage file-candidate drafts** (this slice). Re-read live source locations. For `would-rewrite`, create a parameter-file candidate with the renamed property (same raw value) through the existing candidate API. Do **not** activate live source. Catalog triple unchanged. Sensitive-node rules are checked before staging.
3. **Incompatible until cleared**. `conflict`, `missing-from-source`, and `no-occurrence` stay incompatible. No "skip and leave the old key in source".
4. **Skip only when honest**. Binding gone, or source already has the new key and not the old one.
5. **Per-project review**. Humans activate the file candidate in the configuration workbench (existing Admin review). The run does not auto-merge, write debug values, or bypass review. A parameter-value CR is not created; that seam cannot rename a property name.
6. **Finalize** (this slice). Allowed only when every live location is `already-new-key` or honestly skipped. Fail-closed on `triple-collision` / `open-version-cutover` even if items look ready. One transaction: rewrite `property_key` + derived `specification_key` / `schema_namespace`. After finalize, ingest matches the new key only. No standing alias.

New tables (names illustrative; **claim the migration number at merge time** per fleet-coordination): a run table and an item table parallel to `parameter_spec_version_cutover_*`, not a status column on those tables.

### First-slice seam (landed #544)

`POST /api/v2/parameter-specs/:specId/property-key-cutover/preview` is read-only. It lists binding-tip locations, classifies each (`would-rewrite` / `already-new-key` / `missing-from-source` / `no-occurrence` / `conflict`), and reports start blockers (`triple-collision`, `open-version-cutover`, `open-property-key-cutover`). `writesCatalog` and `writesSource` are always `false`.

### This-slice seams

- `POST .../property-key-cutover/start` — persist run + items from preview; refuse blockers; catalog unchanged.
- `GET .../property-key-cutover` — read the open run (UI resume).
- `POST .../property-key-cutover/prepare` — stage file-candidate drafts for `would-rewrite`; fail-closed on `triple-collision` / `open-version-cutover`; **does not** activate live source.
- `POST .../property-key-cutover/finalize` — fail-closed on blockers or unrewritten sources; then rewrite the catalog triple. Audit: `spec-property-key-cutover-finalized`.

## Non-goals (this plan and this PR)

- Enabling the editor's inline 「修正属性键」 while `referenceCount > 0`.
- Catalog alias, deprecate+recreate, or folding this job into version cutover.
- Minting a parameter-value change request for a property **name** rewrite (file-candidate is the existing source-draft seam).
- Auto-activating the candidate or merging live source from prepare.
- New ADR number (ADR-0034 is already on `main`).
- TD-049 ranking SQL, TD-052 tree counts, TD-063 promote-to-drafts.
- Editing `docs/PLANS.md`, `docs/exec-plans/tech-debt-tracker.md` (either language), or `.github/workflows/ci.yml`. Session 0 owns the PLANS index and tracker note.

## Git & PR Workflow

| Role | Allowed |
| --- | --- |
| Implementation agent | Isolated worktree from latest `origin/main`; commit on `feat/td-117-property-key-prepare-ui`; `git push -u origin HEAD`; do not merge |
| Parent / session owner | Review, open the GitHub PR if the subagent did not, merge only after review, then sync local `main` |

Branch: `feat/td-117-property-key-prepare-ui`. One plan → one branch. Do not push `main`, do not `--no-verify`, do not amend published history.

Merge-time (fleet-coordination): re-check ADR / migration / TD numbers against refreshed `origin/main`. This branch must **not** mint a new ADR. If a later batch adds a migration, claim that number at merge time.

## Batches

### Batch 0 — Plan artifact (this PR)

1. Add this plan EN+ZH with Goal, architecture, Git & PR, Impact Matrix, Update Gate, verification, and honest non-goals.
2. Do **not** list it from `docs/PLANS.md` in this PR (session 0).

### Batch 1 — Dry-run preview + inline-rename regression (this PR)

1. Keep `rename-property-key` `409` when `referenceCount > 0` (server + mock already did; add a cutover-suite regression that catalog is unchanged).
2. Keep 「修正属性键」 disabled when `usageCount > 0`; clicking it must not open an inline rename dialog.
3. Add `previewPropertyKeySourceCutover` (new module) and `POST .../property-key-cutover/preview`.
4. Document the preview in api-contract EN+ZH and regenerate `docs/generated/openapi.json`.

### Batch 2 — Start / prepare source drafts (this PR: prepare stages file candidates)

Run + item tables (`0113` on `main`). Start refuses collisions and open version cutover. **This slice:** prepare writes a parameter-file candidate (old key → new key) and marks items `ready` with `stagedRewrite`. Does not activate live source.

### Batch 3 — Finalize catalog triple (landed #549) + Admin panel (this PR)

Atomic catalog rewrite only after every live location is `already-new-key` or honestly skipped. Fail-closed on `triple-collision` / `open-version-cutover`. Audit `spec-property-key-cutover-finalized`. **This slice:** minimal spec-editor panel for preview → start → prepare → finalize. Inline rename stays disabled.

## Success criteria (this slice)

- Prepare stages a file-candidate rewrite without writing live source or catalog.
- After the candidate is merged into live source, finalize rewrites the catalog triple.
- Prepare / finalize fail closed on `triple-collision` and `open-version-cutover`; catalog unchanged.
- Inline rename remains refused/disabled while `referenceCount > 0`.
- `npm run docs:check`, targeted tests, `npm run contract:check`, and `npm run build` are green.
- PR body states TD-117 stays Open if residual follow-up remains; prepare uses file-candidate drafts (not parameter-value CR); UI is a minimal spec-editor panel.

## Verification

```bash
npx vitest run --config vitest.server.config.ts \
  server/modules/parameter-specs/propertyKeyCutover.test.ts \
  server/modules/parameter-specs/propertyKeyCutover.integration.test.ts \
  server/modules/parameter-specs/propertyKeySourceRewrite.test.ts \
  server/modules/contracts/routeParity.test.ts
npx vitest run \
  src/components/parameter-topology/PropertyKeyCutoverPanel.test.tsx \
  src/components/parameter-topology/ParameterSpecDetailDialog.test.tsx \
  src/infrastructure/http/parameterTopologyClient.test.ts
npm run contract:check
npm run docs:check
npx tsc -b
npm run build
```

Do not run full browser acceptance. The new panel is Admin-only on `/parameter-admin/specs`. No new acceptance requirement ID or operation ID. Do not add Playwright to the shared CI suite.

## UI Interaction Automation Review

The spec editor adds a property-key cutover panel when `usageCount > 0`. Inline 「修正属性键」 stays disabled. Existing identity-editor unit coverage plus `PropertyKeyCutoverPanel.test.tsx` cover the new interaction. No new acceptance requirement ID or operation ID.

## Documentation Impact Matrix

| Area | Action | Paths |
| --- | --- | --- |
| Repository maps | Review | `AGENTS.md`, `ARCHITECTURE.md` — no runtime-mode or map change. Unchanged. |
| Planning | Update | This plan + ZH twin. **`docs/PLANS.md` / `docs/zh-CN/PLANS.md` left to session 0.** Tracker twins not edited. |
| Product specs | Review | `docs/product-specs/product-spec.md` (+ ZH) — identity correction remains zero-ref for inline rename. No product-spec rewrite this slice. |
| Domain / glossary | Review | `CONTEXT.md`, `docs/design-docs/domain-model.md` (+ ZH) — "property-key rename only while `referenceCount = 0`" stays true for the inline path. Cutover job glossary waits for Batch 2/3. |
| Design docs / ADR | Review | [ADR-0034](../../adr/0034-referenced-property-key-rename-is-a-source-cutover.md) Locked text unchanged. `docs/design-docs/2026-07-30-parameter-governance-deferred-questions.md` already points here. |
| API | Update | `docs/design-docs/api-contract.md` (+ ZH): preview + start + prepare (file-candidate) + finalize + GET open run. |
| Frontend / design system | Update | `docs/FRONTEND.md` (+ ZH): spec-editor panel; inline rename stays disabled. |
| Security | Update | Prepare stages file candidates after sensitive-node check; audits `spec-property-key-cutover-started` / `-prepared` / `-finalized`. No new secret. |
| Reliability / runbooks | No change | No target-environment or ops procedure. |
| Developer env | No change | No new env keys. |
| Quality / acceptance | Review | Existing identity-editor unit coverage plus the new disable regression. No browser-acceptance map change. |
| Generated artifacts | Update | `docs/generated/openapi.json` via `npm run contract:openapi`. Migration `0113` + `docs/generated/db-schema.md`. |
| References | Review | Productization API draft is not the live contract. |
| Tech debt | No change | TD-117 stays **Open**. This PR must not edit the tracker. |

## Documentation Update Gate

A batch cannot be called complete until:

1. Every Impact Matrix `Update` / `Review` row for that batch is updated or recorded unchanged with evidence.
2. EN+ZH tracker rows are **not** silently closed. TD-117 stays Open until finalize ships.
3. `npm run docs:check` is green. PLANS index listing is session 0's duty; missing index is expected on this branch.
4. UI-interaction coverage is reviewed (Batch 1: no new interaction).
5. Moving this plan to `completed/` does not leave the same filename in `active/` (EN or ZH).

Deferred work stays in `tech-debt-tracker.md`; do not delete that row from this branch.
