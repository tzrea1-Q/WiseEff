# T1.4 final legacy cutover — implementable design

> Chinese: [中文](../../../zh-CN/exec-plans/active/849-inventory/t14-final-legacy-cutover-design.md)

Companion to the [threat matrix](t14-final-legacy-cutover-threat-matrix.md).

Status: **Spec re-review PASS with P2 folded.** Independent review `01a0b0a8-0492-434d-6fbb-ac1520d36674`. Repair A may start.

## 1. What T1.4 is

Aggregate gate after eleven T2.2 families. First make the checker runnable. Then measure remaining allowances. Delete only vanished tokens. 410 leftover current surfaces only when they have no live caller. Do not weaken the checker. Do not drop archive tables.

## 2. Repair A — current successor rebind (blocker)

Checker path: `verifyHistoricalRuntimeTopologyRelocation` + `verifyHistoricalEditServiceVersionIndexRelocation` (historical proof) then `runReviewedRelocationRecord` on **current** `source-workflow-relocation.json` (82 pairs) and `source-workflow-consumer-relocation.json` (210 pairs).

**Historical (must not change):** `runtime-topology-relocation.json`, `edit-service-version-index-relocation.json` destination OIDs, pair `old`/`new` as of provenance commits `e31226b6…` / `8ef8f251…` / tree `38f9040e…`, pair counts 59 / 16 / 82 historical inventory, `rejectAllowanceGrowth`. Do **not** point those dest OIDs at working-tree `git hash-object`. That is checker weakening.

**Current successors (this repair):** only

- `scripts/fixtures/parameter-catalog-allowlist/source-workflow-relocation.json`
- `scripts/fixtures/parameter-catalog-allowlist/source-workflow-consumer-relocation.json`
- hardcoded `recordSha256` in `scripts/parameter-catalog-allowlist/sourceWorkflowRelocation.ts` for those two records

Measured dest drift (current `git hash-object` ≠ frozen dest):

- source-workflow: `editService.ts` (26), `editService.test.ts` (28). `overlayWriteback.ts` already matches.
- source-workflow-consumer: `parameter-import-wizard.acceptance.spec.ts` (2), `parameter-topology.acceptance.spec.ts` (83), `writebackService.ts` (21), `parameterTopologyClient.test.ts` (22), `parameterTopologyClient.ts` (33).

**Allowed on those current records only:**

- Keep `trustedBaseSha`, source `sourceBlobOid`, every pair `old` (full id).
- Recompute `destinationBlobOid` with `git hash-object` of the **current** file.
- Re-bind each pair `new` to the scanner's **exact destination occurrence** in the current file: `requireStableStructuralAnchor` keeps the first three id parts; the occurrence fingerprint (4th part), `trustedBlobOid`, line/column, and byte offsets **must equal the current scan**. Literal whole `new.id` stay is forbidden.
- Update those two `recordSha256` values only after Spec re-review PASS of the new bytes.
- Tests: successor **accepts** current bytes; still rejects a tampered destination; historical records still reject current working-tree dest hashes.

**Forbidden:** delete pairs; allowance growth; skip relocation; rewrite historical JSON dest OIDs or provenance SHAs; isolated dest-OID edit without rebinding `new`; invent checker flags.

If a current destination span cannot be found, **do not invent a mapping**. Measured T2.2 repairs removed 8 current-successor pairs whose identical raw slice or same-anchor scanner hit is gone from dest (7 `writebackService.ts` FIL, 1 `parameterTopologyClient.ts` TOP route). Those pairs are **retired from the current successor only** (counts 210→202 / writeback 21→14 / client 33→32). Historical records are unchanged. After A, if the next dest-blob error is on a **historical** record, stop — do not “fix” history.

## 3. Repair B — measure and ratchet

Once A lands, run `npm run parameter-catalog-boundaries:check -- --trusted-base-sha 9b3ba7df7e21f5589684bc92c872da593ad4c246`.

- Record total before **3513**, after, per-family deltas.
- Delete only vanished shard entries. No growth.
- Remaining **current** production tokens must be 0. The checker is a static scanner and **does not** distinguish history/test. Leftover shard rows after B are remaining current. Naming an owner does **not** make T1.4 zero. T1.4 is **not** complete until those rows are gone (token vanished) or the scanner no longer reports them. Exact-canonical-history is a **receipt classification** of vanished-or-still-scanned rows, not a paper zero.

## 4. Repair C — leftover current surfaces

Only after B's measurement:

| Surface | Condition to 410 in T1.4 | Else |
| --- | --- | --- |
| Overlay HTTP | No live product caller (module picker still uses it as DTS adapter → **keep 2xx**, name caller) | keep |
| `GET /api/v2/parameter-specs?view=governance` **list** | MOD picker gone; remaining caller is spec-governance mock/no-catalog only → 410 **list** gone-first **if** T2.1 detail `view=governance` is a **different** route (keep **detail** 2xx; CGH P1) | keep list if any live caller remains |
| `/api/v2/parameter-modules` writes | Transition final; 410 structural writes if T2.1/MOD UI no longer depends | keep reads |
| `seedInitialization` completed replay | already no-op (T1.3); prove installer/restart does not reseed | no new writer |

Do not 410 T2.1 `semanticBindingFixture` governance **detail**.

## 5. Dual-write / TD-125 / fence

Remove mixed read/dual-write/TD-125 only with a named successor. Stale-draft fencing at rebuild epoch may be recorded as a contract for T2.3/T3.1 if the epoch is not this todo's writer. Restart stale-replay refusal: reuse T1.3 + OPS CLI 410.

## 6. Evidence

- Checker completes (A).
- Exact counts (B).
- Focused route tests for any 410 (C).
- `git diff --check`, `tsc -b` if types change.
- Independent Standards + Spec implementation review.
- No UI sweep unless a 410 is user-visible; then 1440x900 once.

Helper PG 55438.

## Key Decisions

1. Unblocking the checker is T1.4, not a T2.2 cheat, **if** historical records stay pinned and only **current** successor dest+`new` spans are rebound.
2. Isolated dest-OID edit is weakening. Pair `new` must match the current scan (anchor + fingerprint).
3. Historical version-index / runtime-topology dest OIDs stay.
4. Governance **detail** stays 2xx (CGH P1).
5. Overlay stays until no live caller.
6. Zero scanner hits is the gate. Naming leftover owners is receipt-only and is **not** zero.
7. No commit.
8. Change the two current JSON files and their hardcoded `recordSha256` in the same implementation; implementation Spec of A reviews the new bytes.

## Open Questions

None that block A. Overlay 410 vs keep is decided by live-caller proof in C after B.

## PR Plan

No PR this todo.

| Step | Title | Depends |
| --- | --- | --- |
| A | Destination-blob successor | Spec PASS |
| B | Checker + ratchet | A |
| C | Leftover 410s | B |
| D | Receipt | C |
