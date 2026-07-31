# Attribution governance — deferred questions

> Date: 2026-07-31  
> Status: open for later grilling  
> Companion plan (decided work): [`docs/exec-plans/active/2026-07-31-attribution-governance-follow-up.md`](../exec-plans/active/2026-07-31-attribution-governance-follow-up.md)  
> Chinese: [`docs/zh-CN/design-docs/2026-07-31-attribution-governance-deferred-questions.md`](../zh-CN/design-docs/2026-07-31-attribution-governance-deferred-questions.md)

These items were reviewed in the 2026-07-31 grill-with-docs session. They are **not** scheduled in the follow-up implementation batches until a later grilling locks answers.

## D-AG-01 — Editing driver nature and instance cardinality

**Context:** `DriverRegistration` already stores `driverNature` (`physical-device` | `logical-service`) and `instanceCardinality` (`multiple` | `singleton-per-project`). Defaults are physical + multiple; logical + singleton is a curated correction (ADR-0013). Follow-up PR9 only adds **read-only** display.

**Open questions:**

1. Who may edit nature/cardinality (org Admin vs platform-admin vs seed-only)?
2. After a change to `singleton-per-project`, what happens to projects that already have multiple instances — block publish only, force topology fix, or auto-open tasks?
3. Does editing require audit + re-sync of `singleton-cardinality` blocking tasks in one transaction?
4. Is nature orthogonal to taxonomy `kind` forever, or can operators confuse “logical-service driver” with `node-type` modules?

**Non-goals until locked:** Any mutate API or Admin edit control for these fields.

## D-AG-02 — Second coverage claim kind (`pinned-schema-property`)

**Context:** Activate of subject-bound drafts requires a coverage claim. Runtime accepts only `overlay-property`; schema still mentions `pinned-schema-property` and returns 400. Follow-up PR9 makes the public contract overlay-only.

**Open questions:**

1. Should pinned vendor/platform schema properties be a first-class claim path?
2. Who owns the pin (org vs platform), and how does it interact with overlay promotion (ADR-0008/0009)?
3. Is claim required only on first activate, or on every successor activate?

**Non-goals until locked:** Implementing pinned claims.

## D-AG-03 — `driverModule` string vs attribution subject (TD-047)

**Context:** Spec identity is owner scope + `attribution_subject_id` + `property_key`. Historical `driverModule` strings can disagree with binding evidence. Follow-up PR9 makes the **UI primary** label the subject; it does not reconcile storage.

**Open questions:**

1. Backfill or drop `driverModule` as an identity signal?
2. Fail closed on activate when `driverModule` disagrees with the subject’s source key / display?
3. How should overlay authoring and legacy imports present mismatches?

**Track:** Keep [TD-047](../exec-plans/tech-debt-tracker.md) open until this grilling closes.

## D-AG-04 — Business-category placement heuristic (TD-046)

**Context:** Auto node-type units land under business categories via `businessCategoryForNodePath` keyword routing. Not a model hole from PR0–PR6; operators may treat it as designed policy.

**Open questions:**

1. Replace with Admin-declared placement rules or registry-backed mapping?
2. What is the migration story for already-placed modules?

**Track:** Keep [TD-046](../exec-plans/tech-debt-tracker.md) open; do not schedule in the follow-up plan.

## Parking lot (explicitly not deferred-domain)

- Parent agent opening/merging the PR0–PR6 GitHub PR and acceptance e2e evidence — release process, not domain ambiguity.
- Opportunistic splits of large `parameter-specs/service.ts` — engineering debt unless a follow-up batch touches the file.
