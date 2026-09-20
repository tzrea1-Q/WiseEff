# T1.4 Repair B2 — rewritten-slice current successor

> Chinese: [中文](../../../zh-CN/exec-plans/active/849-inventory/t14-rewritten-slice-successor.md)

Amendment to [t14-final-legacy-cutover-design.md](t14-final-legacy-cutover-design.md). Independent Spec required before production edits. No commit.

Status: **Spec re-review PASS with P2 folded.** Independent review `9e09e874-cae5-4e98-af76-c5f6cd638731`. B2 production may start. T1.4 still not zero.

## Why A/B1 is not enough

After Repair A (dest-blob rebind) and B1 (136 identical-slice family pairs + 10 vanished ratchet):

- unallowlisted **100**, stale **51**, growth **0**, shards **3503**.
- 51 remaining stale all share `family:rule:base` with some unallowlisted hit on the same file.
- Dry pairing those 51: **15** also match token/evidence/column; **36** differ **only** in `evidence` (T2.2 rewrote the SQL snippet the detector stores). Token/rule/file/family/reason stay.
- **49** unallowlisted have **new** first-three-part ids (evidence fingerprint changed). Those are **not** this record.

Identical-raw-slice relocation cannot map the 36: dest bytes ≠ source bytes. Allowlist growth is forbidden. Deleting the T2.2 pins (inner join `dts_property_specs`, `attribution_subjects`) would undo T2.2. Scanner change is a separate policy and is **not** this amendment.

## What B2 is

One **current** successor record, after the 136-pair family record:

`scripts/fixtures/parameter-catalog-allowlist/t14-rewritten-slice-successor-relocation.json`

It aliases a **stale** allowance id to a **currently unallowlisted** dest occurrence when:

1. First three id parts match (`requireStableStructuralAnchor`).
2. Same `file`, `family`, `rule`, `token`, `reason`.
3. Old id is in the allowlist and **not** in the post-B1 discovered set (stale).
4. New id is in the post-B1 discovered set and **not** in the allowlist (unallowlisted).
5. No cross-record old/new ids.
6. Dest whole-file blob is the working tree; source blob is trusted-base `git show`.
7. **`evidence` may change. Column may change. Raw slice bytes may change.**
8. **`requireStableByteOrder: true`.** The coarser order key and dest-`byteStart` tie exception apply **only when `requireUnchangedEvidence === false`** (must not coarsen B1). Then the order key is first three id parts + `token` only. Dest `byteStart` must be strictly greater than the previous dest for that key, except dest `byteStart` may equal the previous dest when `old.byteStart` also ties. B1 records keep the existing evidence-inclusive order key and strict dest increase. Tests must reject a different-position dest swap under the B2 key.

Expected **50 or 51** pairs depending on whether the tied dest pair is included: greedy pairing maps **50** if equal dest `byteStart` is forbidden, **51** if the tie exception is on. This amendment **uses the tie exception** so all **51** stale map. Unallowlisted leftover is **48 new-base-id + 1 extra same-anchor dest** (`writebackService.ts` `read:project_parameter_bindings`) = **49**. Stale **0**. Do not invent a dest span for that extra writeback hit.

`RelocationConfig` gains two flags, **default true** so historical records stay identical-slice. Unset means `!== false` (identical-slice stays on). Do not port the flags to `exactRelocation.ts`.

- `requireIdenticalSlice` (default `true`). B2 sets `false`.
- `requireUnchangedEvidence` (default `true`). B2 sets `false`. When false, skip `evidence` and `column` in the unchanged-key loop.

Pair stores **two** digests: `sourceSliceSha256` (old bytes) and `sliceSha256` (dest bytes). Validator proves both against the files; it does **not** require `oldBytes.equals(nextBytes)` when `requireIdenticalSlice` is false. `sourceSliceSha256` is optional on the shared `.strict()` pair schema (absent on identical-slice records).

T1.4 **still not zero** after B2. T14-01 “inventing checker flags” does not apply to these **named, default-true** B2 flags.

## Forbidden

- Setting those flags on historical / source-workflow / consumer / 136-pair family records.
- Pairing different first-three-part ids (the 49 un-only).
- Allowlist growth.
- Scanner rule deletion.
- Inventing dest spans.

## Evidence

Checker after B2: stale **0**; unallowlisted **49**; growth **0**. Focused tests for the new flags: historical records still reject slice mismatch; B2 record accepts evidence/slice rewrite and still rejects cross-record / growth / missing dest; tests reject a different-position dest swap under the B2 key.

Independent Spec of this amendment before edits. Implementation Spec of the new JSON bytes after.

## Non-goals

The remaining ~49 un-only hits (mostly tests + a few production identifier sites) stay T1.4-open. Repair C 410s still wait. No commit.
