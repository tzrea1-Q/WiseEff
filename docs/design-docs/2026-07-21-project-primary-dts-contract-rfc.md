# RFC: Project-Primary DTS Contract (Retire Platform Base DTS)

> Chinese: [Chinese](../zh-CN/design-docs/2026-07-21-project-primary-dts-contract-rfc.md)

- Date: 2026-07-21
- Status: **Accepted for planning**
- Depends on: [`2026-07-21-dts-parameter-surface-boundary-rfc.md`](2026-07-21-dts-parameter-surface-boundary-rfc.md) (surface, module UX, L0/L2)
- Revises: Seeds & demo row in [`2026-07-21-dts-capability-cut-matrix.md`](2026-07-21-dts-capability-cut-matrix.md) §6 (`wiseeff-power-base.dts` **Keep-internal** → **Retire**)
- Implementation plan: [`../exec-plans/active/2026-07-21-retire-synthetic-base-dts.md`](../exec-plans/active/2026-07-21-retire-synthetic-base-dts.md)

## 1. Problem statement

WiseEff’s intended user journey is:

1. Create a project and **upload one project DTS**.
2. Thereafter edit and submit parameters **only in the WiseEff UI**.
3. Every approved change must land on **that project’s final DTS text**.
4. Admins maintain **module ↔ driver / compatible / instance** relationships in the admin console — **not** DTS files.

Today’s M1 seed still depends on a **platform-owned synthetic base** (`src/config/dts-seed/wiseeff-power-base.dts`) plus project overlays. That file exists so `&label` / phandle targets resolve for `dtc` / ingest. It is not the product object users upload, yet it creates ongoing maintenance cost and teaches the wrong mental model (platform base + overlay).

Module/driver mappings in admin already own **business grouping**. They cannot replace base DTS for Device Tree reference resolution — so the fix is **not** “map harder in admin”, it is **stop requiring a platform base DTS at all**.

## 2. Decision summary

| # | Decision | Choice |
| --- | --- | --- |
| P1 | User-visible DTS model | **One project-primary DTS** per project (the uploaded / evolved final text) |
| P2 | Writeback target | Always the **project-primary DTS** (or its sole project-owned successor after first ingest) |
| P3 | Admin DTS duty | **None** — admins do not maintain base trees, overlays, or seed DTS |
| P4 | Admin relationship duty | **Module ↔ driver / compatible / instance** (and related registry) only |
| P5 | Platform `wiseeff-power-base.dts` | **Retire** from seed, demo, and product paths |
| P6 | Demo / seed shape | Each demo project = **one self-contained primary DTS** (scaffolding may be inlined; not a shared platform asset) |
| P7 | Config Set / multi-file internals | Allowed as **implementation detail** only if writeback still converges to the project-primary text and UI never requires file maintenance |

## 3. Product contract

### 3.1 Project-primary DTS

After project creation + first successful upload/ingest:

- There is exactly one **authoritative project DTS text** for parameter writeback.
- Parameter drafts/submissions/merge **must** update that text (occurrence-precise CST writeback unchanged in spirit).
- Export / download for Git hands humans that same text (or a release snapshot derived from it).

Users never need a second “platform base” file. If the engine temporarily stores overlays or includes for resolve, those are not admin-editable product surfaces and must not be required to keep the project healthy.

### 3.2 Upload once, edit forever (in UI)

| Actor | Does | Does not |
| --- | --- | --- |
| Hardware / software user | Upload initial DTS; edit parameters; submit / review | Edit raw multi-file Config Sets as a routine job |
| Admin | Maintain modules and mappings; triage unmatched reviews | Maintain `wiseeff-power-base.dts` or any shared scaffold DTS |
| WiseEff | Parse, surface-filter, bind, write back, workflow | Ask anyone to keep a synthetic base in sync with overlays |

### 3.3 Module ↔ driver in admin (not in base DTS)

Business membership (“this property belongs to 充电策略”) is expressed by:

- `parameter_modules` + mappings (`driver` / `compatible` / `instance` → module), and
- persisted `module_id` on bindings.

It is **not** expressed by co-maintaining a shared Device Tree base. Cross-project compare uses binding / spec / module identity, not a shared base tree.

## 4. What retires

| Artifact / practice | Action |
| --- | --- |
| `src/config/dts-seed/wiseeff-power-base.dts` as seed `entryFile` | Remove from `db:seed:m1` and demo projects |
| Shared platform base + per-project overlay seed story | Replace with **one primary DTS per demo project** |
| Docs / cut matrix “Keep-internal synthetic base” | Mark **Retire**; point here |
| Expectation that Admin “fixes seed by editing base DTS” | Forbidden |

Transitional: the file may remain briefly as a **migration fixture** while golden counts / vendor regen are rebased — not as a long-term platform asset.

## 5. Seed / demo target shape

For `aurora` / `nebula` / `atlas` (and any future demo):

1. **One** committed primary DTS per project (name TBD, e.g. `aurora-board.dts`), containing whatever scaffolding is needed for that board’s business nodes to be self-contained.
2. Project-to-project parameter differences live as **different values inside each primary file** (or project-owned diffs), not as overlays against a shared WiseEff base.
3. Vendor schema / golden fixture regen inputs switch to the new primary files (or a single **non-product** compile fixture under `test/` if still needed for L2 — never promoted as “the base users depend on”).
4. Locked counts (176 / 528 today) **update only when seed intentionally changes**; document the new locks in the same PR.

## 6. Relationship to parameter-surface MVP

This RFC does **not** reopen surface filter, module→parameters UX, or L0/L2 toolchain decisions. It completes the seed/product gap called out in the cut matrix §6 and boundary RFC D3/D5:

- Surface MVP: hide scaffolding; write back project DTS; L2 off edit path.
- This RFC: ensure there is **no platform base DTS to maintain**, and seed teaches the real upload-one-file story.

Implementation may ship after or in parallel with surface MVP Tasks A–G, but **must not** reintroduce platform-base maintenance into the hot path.

## 7. Non-goals

- Deleting Config Set / logical-node tables in the first retire PR
- Forcing every production customer onto a single physical file if their existing repo uses includes (ingest may still accept multi-member uploads later as advanced import — out of v1 product story)
- Moving module mapping logic into DTS comments or compatible strings
- Requiring Admin to author Device Trees for phandle correctness

## 8. Success criteria

- [ ] `db:seed:m1` creates demo projects without reading `wiseeff-power-base.dts` as a shared entry base
- [ ] `/parameters` empty/onboarding copy remains “upload project DTS”; no “maintain base Config Set” language
- [ ] Admin module mapping UI remains the only place to maintain module↔driver relationships
- [ ] Binding edit → merge updates the project-primary DTS bytes
- [ ] Docs (FRONTEND, cut matrix, seed runbooks) state that synthetic platform base is retired
- [ ] `npm run docs:check` passes; golden / seed tests updated to new locks

## 9. Open implementation notes (for the exec plan)

- Prefer **copy-on-seed**: generate each demo primary from a template once into project storage; do not leave a live shared file in `src/config/dts-seed/` that seed mutates forever.
- If writeback today prefers “overlay member”, either (a) make the project-primary file that member, or (b) flatten writeback into the single primary after retire — choose in the implementation plan with a single default.
- Vendor schema generator must stop hard-coding `wiseeff-power-base.dts` + `base-power-overlay.dts` as the only input pair.
