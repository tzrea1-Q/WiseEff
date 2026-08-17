# Attribution governance — deferred questions

> Date: 2026-07-31  
> Status: **Locked 2026-08-01** (grilling complete)  
> Implementation plan: [`docs/exec-plans/completed/2026-08-01-attribution-deferred-implementation.md`](../exec-plans/completed/2026-08-01-attribution-deferred-implementation.md)  
> Companion plan (prior decided work): [`docs/exec-plans/completed/2026-07-31-attribution-governance-follow-up.md`](../exec-plans/completed/2026-07-31-attribution-governance-follow-up.md)  
> Chinese: [`docs/zh-CN/design-docs/2026-07-31-attribution-governance-deferred-questions.md`](../zh-CN/design-docs/2026-07-31-attribution-governance-deferred-questions.md)

These items were reviewed in the 2026-07-31 grill-with-docs session and **locked on 2026-08-01**. Do not reopen semantics in implementation PRs without a new grilling note. Ship work only via the implementation plan’s PR split.

## Locked decision table

| ID | Decision |
| --- | --- |
| **D-AG-01** | Org Admin edits **org** registrations; **platform-admin** edits **platform and org** registrations. Org audit/history **must** show platform-admin edits. |
| **D-AG-01** | Change to `singleton-per-project` → **block publish only** (open/refresh singleton tasks; do **not** force topology rewrite). |
| **D-AG-01** | Save = **one transaction**: registration update + audit + re-sync singleton-cardinality tasks. |
| **D-AG-01** | `driverNature` stays orthogonal to taxonomy `node-type` (ADR-0013 already). |
| **D-AG-02** | **No** `pinned-schema-property` claim path; coverage claims remain **`overlay-property` only** (docs/contract honesty; no new runtime kind). |
| **D-AG-03** | **Drop `driverModule` column** (dedicated PR). Migration **fail-closed** if a subject cannot be resolved. Seeds, overlay authoring, and import are **subject-only**. Closes **TD-047** when that PR merges. |
| **D-AG-04** | Auto placement follows the driver registration’s **default business category** (real category C, not a temporary staging category). **Curated** placements stay frozen; **auto** placements are replayed when registration defaults change. Provide an explicit “replay from registration” operator action. Closes **TD-046** when that PR merges. |

## Suggested PR split (owned by implementation plan)

1. **PR1** — editable nature/cardinality + singleton gate same-txn (D-AG-01); D-AG-02 docs/contract-only in the same or a tiny docs commit.
2. **PR2** — drop `driverModule` (D-AG-03) alone.
3. **PR3** — placement from registration + auto replay (D-AG-04).

## D-AG-01 — Editing driver nature and instance cardinality

**Context:** `DriverRegistration` already stores `driverNature` (`physical-device` | `logical-service`) and `instanceCardinality` (`multiple` | `singleton-per-project`). Defaults are physical + multiple; logical + singleton is a curated correction (ADR-0013). Follow-up PR9 only added **read-only** display.

**Locked answers:**

1. **Who may edit:** Org Admin → org-owned registrations only. Platform-admin → platform-tier **and** org registrations. Platform-admin edits on org registrations appear in that org’s audit/history.
2. **Singleton remediation:** Changing to `singleton-per-project` **blocks publish only** via open/refresh of singleton-cardinality tasks. Do not force an automatic topology rewrite.
3. **Transaction:** Registration update, audit write, and singleton-task re-sync run in **one** DB transaction.
4. **Orthogonality:** Nature remains orthogonal to taxonomy `kind` / `node-type` (ADR-0013). UI copy must not imply they are the same concept.

## D-AG-02 — Second coverage claim kind (`pinned-schema-property`)

**Context:** Activate of subject-bound drafts requires a coverage claim. Runtime already accepts only `overlay-property`; schema historically mentioned `pinned-schema-property` and returned 400.

**Locked answer:** Do **not** implement pinned claims. Keep the public contract and docs as overlay-only. Remove or mark `pinned-schema-property` as non-supported wherever residual mentions remain.

## D-AG-03 — `driverModule` string vs attribution subject (TD-047)

**Context:** Spec identity is owner scope + `attribution_subject_id` + `property_key`. Historical `driverModule` strings can disagree with binding evidence. Follow-up PR9 made the **UI primary** label the subject; it did not reconcile storage.

**Locked answers:**

1. **Drop** the `driverModule` column (and equivalent API/UI fields that still treat it as identity).
2. Migration is **fail-closed**: if a row cannot resolve to a subject, abort the migration (no silent keep-both).
3. Overlay authoring, seeds, and legacy imports become **subject-only**; do not reintroduce string driverModule as a write path.

**Track:** Close [TD-047](../exec-plans/tech-debt-tracker.md) when PR2 merges. **Implemented in PR2** (`feat/drop-parameter-spec-driver-module`, migration `0088`): no physical column; subject-only writes; fail-closed backfill.

## D-AG-04 — Business-category placement heuristic (TD-046)

**Context:** Auto node-type units historically landed under business categories via `businessCategoryForNodePath` keyword routing.

**Locked answers:**

1. **Authoritative rule:** place from the driver registration’s **default business category** (product category C).
2. **Migration / replay:** curated placements stay frozen; auto placements replay when the registration default changes; operators get an explicit “replay from registration” action for intentional refresh.

**Track:** Close [TD-046](../exec-plans/tech-debt-tracker.md) when PR3 merges.

## Parking lot (explicitly not deferred-domain)

- Parent agent opening/merging implementation PRs and acceptance e2e evidence — release process, not domain ambiguity.
- Opportunistic splits of large `parameter-specs/service.ts` — engineering debt unless a batch touches the file.
- Parameter-governance deferred D1–D8 (`2026-07-30-parameter-governance-deferred-questions.md`) — separate grilling track.
