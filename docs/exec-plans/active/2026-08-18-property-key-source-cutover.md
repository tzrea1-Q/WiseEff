# Referenced property-key rename is a source-file rewrite cutover

> Status: **Active** — first slice only (plan + read-only dry-run). TD-117 stays **Open**.  
> Date: 2026-08-18  
> Branch: `feat/td-117-property-key-source-cutover`  
> Chinese: [`docs/zh-CN/exec-plans/active/2026-08-18-property-key-source-cutover.md`](../../zh-CN/exec-plans/active/2026-08-18-property-key-source-cutover.md)  
> Governing decision: [ADR-0034](../../adr/0034-referenced-property-key-rename-is-a-source-cutover.md)  
> Tracker: [TD-117](../tech-debt-tracker.md) (read-only in this PR; session 0 owns the index)

## Goal

Operators who bound a mistyped `property_key` get a **dedicated staged cutover**: rewrite the key in each binding's **source file** first (draft / change request, existing review path), then **finalize** by updating the catalog triple (`property_key` + derived `specification_key` / `schema_namespace`) so ingest matches the already-rewritten sources.

This plan does **not** claim the product job is finished. The first shippable slice is the locked architecture plus a read-only preview that lists source locations and the target key **without writing catalog**.

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
         via structured-edit / binding-draft + CR
         catalog triple UNCHANGED
        │
        ▼
Humans merge through existing change-request path
        │
        ▼
Finalize (one transaction): rewrite catalog triple
         so it matches already-rewritten sources
         audit: spec-property-key-cutover-finalized
```

1. **Start** (later). Admin (`platform-admin` for platform-global rows, otherwise org Admin) starts a property-key cutover on a spec with `referenceCount > 0`: proposed `propertyKey` + `reason`. Refuse on triple collision (including deprecated blockers), an open **version** cutover on the same spec, or an already-open property-key cutover. Persist `from_key` / `to_key` on the run.
2. **Prepare — source first** (later). For each binding tip, create a cutover item that stages a property rename in source through existing draft/CR machinery (candidate config revision, write lock, exact occurrence). Do **not** rewrite `dts_property_specs.property_key` yet.
3. **Incompatible until cleared** (later). Open drafts, submission items, change requests, or file conflicts on that binding; node-path drift vs the current occurrence; property already absent from source. No "skip and leave the old key in source".
4. **Skip only when honest** (later). Binding gone, or source already has the new key and not the old one.
5. **Per-project review** (later). Items become `ready` when the source rewrite is a mergeable candidate. The run does not auto-merge, write debug values, or bypass review.
6. **Finalize** (later). Allowed only when every item is `ready` (merged) or honestly skipped. One transaction: rewrite `property_key` + derived `specification_key` / `schema_namespace`. After finalize, ingest matches the new key only. No standing alias.

New tables (names illustrative; **claim the migration number at merge time** per fleet-coordination): a run table and an item table parallel to `parameter_spec_version_cutover_*`, not a status column on those tables.

### First-slice seam

`POST /api/v2/parameter-specs/:specId/property-key-cutover/preview` is read-only. It lists binding-tip locations, classifies each (`would-rewrite` / `already-new-key` / `missing-from-source` / `no-occurrence` / `conflict`), and reports start blockers (`triple-collision`, `open-version-cutover`). `writesCatalog` and `writesSource` are always `false`. No run row, no draft, no audit write.

## Non-goals (this plan and this PR)

- Enabling the editor's inline 「修正属性键」 while `referenceCount > 0`.
- Catalog alias, deprecate+recreate, or folding this job into version cutover.
- Start / prepare / finalize product routes, draft/CR staging, or catalog rewrite.
- New ADR number (ADR-0034 is already on `main`).
- TD-049 ranking SQL, TD-052 tree counts, TD-063 promote-to-drafts.
- Editing `docs/PLANS.md`, `docs/exec-plans/tech-debt-tracker.md` (either language), or `.github/workflows/ci.yml`. Session 0 owns the PLANS index and tracker note.

## Git & PR Workflow

| Role | Allowed |
| --- | --- |
| Implementation agent | Isolated worktree from latest `origin/main`; commit on `feat/td-117-property-key-source-cutover`; `git push -u origin HEAD`; do not merge |
| Parent / session owner | Review, open the GitHub PR if the subagent did not, merge only after review, then sync local `main` |

Branch: `feat/td-117-property-key-source-cutover`. One plan → one branch. Do not push `main`, do not `--no-verify`, do not amend published history.

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

### Batch 2 — Start / prepare source drafts (later)

Run + item tables; start refuses collisions and open version cutover; prepare stages source rewrites through existing draft/CR machinery. Catalog still unchanged.

### Batch 3 — Finalize catalog triple (later)

Atomic catalog rewrite only after every item is ready or honestly skipped. Audit `spec-property-key-cutover-finalized`. Then, and only then, consider a UI entry that **starts the job** — still not an inline key field.

## Success criteria (first slice)

- Active plan exists EN+ZH with the required governance sections.
- Preview lists locations + target key and leaves `parameter_specs.property_key` / `dts_property_specs.property_key` unchanged.
- Inline rename remains refused/disabled while referenced.
- `npm run docs:check`, targeted tests, and `npm run build` are green.
- PR body states TD-117 stays Open; this slice is not finalize.

## Verification

```bash
npx vitest run \
  server/modules/parameter-specs/propertyKeyCutover.test.ts \
  server/modules/parameter-specs/propertyKeyCutover.integration.test.ts \
  server/modules/parameter-specs/specIdentityCorrection.integration.test.ts \
  server/modules/contracts/routeParity.test.ts \
  src/components/parameter-topology/ParameterSpecDetailDialog.test.tsx \
  src/infrastructure/mock/mockParameterTopologyRepository.test.ts
npm run contract:check
npm run docs:check
npx tsc -b
npm run build
```

Do not run full browser acceptance. This slice does not change a user-facing interaction path.

## UI Interaction Automation Review

No user-facing interaction change. The editor already disables 「修正属性键」 when `usageCount > 0`; this PR only adds a regression that the disabled control does not open a dialog. No new acceptance requirement ID or operation ID. Do not add Playwright to the shared CI suite.

## Documentation Impact Matrix

| Area | Action | Paths |
| --- | --- | --- |
| Repository maps | Review | `AGENTS.md`, `ARCHITECTURE.md` — no runtime-mode or map change. Unchanged. |
| Planning | Update | This plan + ZH twin. **`docs/PLANS.md` / `docs/zh-CN/PLANS.md` left to session 0.** Tracker twins not edited. |
| Product specs | Review | `docs/product-specs/product-spec.md` (+ ZH) — identity correction remains zero-ref for inline rename. No product-spec rewrite this slice. |
| Domain / glossary | Review | `CONTEXT.md`, `docs/design-docs/domain-model.md` (+ ZH) — "property-key rename only while `referenceCount = 0`" stays true for the inline path. Cutover job glossary waits for Batch 2/3. |
| Design docs / ADR | Review | [ADR-0034](../../adr/0034-referenced-property-key-rename-is-a-source-cutover.md) Locked text unchanged. `docs/design-docs/2026-07-30-parameter-governance-deferred-questions.md` already points here. |
| API | Update | `docs/design-docs/api-contract.md` (+ ZH): preview route; rename-property-key sentence now cites ADR-0034 instead of "ADR-0017 follow-up" only. |
| Frontend / design system | Review | `docs/FRONTEND.md`, `docs/design-docs/ui-design-system.md` — no visual or interaction change. |
| Security | Review | Preview is an Admin-gated read; no new secret, no audit write this slice. Finalize audit name is specified for later. |
| Reliability / runbooks | No change | No target-environment or ops procedure. |
| Developer env | No change | No new env keys. |
| Quality / acceptance | Review | Existing identity-editor unit coverage plus the new disable regression. No browser-acceptance map change. |
| Generated artifacts | Update | `docs/generated/openapi.json` via `npm run contract:openapi`. No migration / no `db-schema.md` this slice. |
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
