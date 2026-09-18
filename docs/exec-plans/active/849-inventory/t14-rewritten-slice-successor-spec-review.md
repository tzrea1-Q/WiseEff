# T1.4 Repair B2 rewritten-slice successor — Spec re-review

> Chinese: [中文](../../../zh-CN/exec-plans/active/849-inventory/t14-rewritten-slice-successor-spec-review.md)

Model: grok-4.6 (requested gpt-5.6-luna unavailable)
Verdict: **PASS with P2**

Independent Spec re-review of revised [t14-rewritten-slice-successor.md](t14-rewritten-slice-successor.md) and ZH twin after FAIL `14b8dc20-270b-43f3-b1fa-5c401da78239`. Reviewer did not write the amendment. No production edits, commit, Repair C, PR, or T1.4 completion in this review.

This re-review `9e09e874-cae5-4e98-af76-c5f6cd638731` **PASS with P2**. Prior FAIL `14b8dc20-270b-43f3-b1fa-5c401da78239` P1 (ordinal vs 51 / stale 0 / leftover 48+1) is **closed**. Prior design re-review `01a0b0a8-0492-434d-6fbb-ac1520d36674` PASS with P2 stays closed and is not re-opened. Production implementation of B2 may start. Fold the P2 wording below in the same design pass or with the first implementation commits. This review does not mark T1.4 complete.

HEAD `f9c710f6a90d67462965a06abd47e33aa200e75e`. Remainder independently re-read from post-B1 checker JSON `/tmp/t14-ratch.json`: unallowlisted **100**, stale **51**, growth **0**, relocations **476**, shard total **3503** (allowlisted 3452 + stale 51). Validator today (`runtimeTopologyRelocation.ts`) still has an unconditional unchanged-key loop and unconditional `identical raw slice`. `requireIdenticalSlice` / `requireUnchangedEvidence` do not exist. `requireStableByteOrder` is optional; its key is first-three + `token` + `evidence` + `column` and dest `byteStart` is strictly greater. Shared pair schema is `.strict()` with `sliceSha256` only. That is current code, not a remaining design P1.

Independent dry-pair of the 51 (same file / family / rule / token / reason / first-three; evidence and column free; order key first-three + `token`; process in `old.byteStart` order):

- **14 groups / 30 of 51** share that key.
- Without the tie exception: **50** pairs, **1** unmatched stale (`parameterReferences.ts` `read:parameter_specs` at 4253), leftover unallowlisted **50** = 48 new-base-id + 2 extra same-anchor dest.
- With dest `byteStart` equal **only when** `old.byteStart` also ties: **51** pairs, unmatched stale **0**, leftover unallowlisted **49** = **48 new-base-id + 1 extra same-anchor dest**.
- Extra dest is `writebackService.ts` `read:project_parameter_bindings` at dest **26362** (stale **8334** maps to dest **7432**). Do not invent a dest span for 26362.
- Different-position dest swap under the same key is rejected (KNW 2737↔4195 fails; DTS `dts_property_specs` 8790↔10936 fails). Same-range swap of the two dests at 2737 is not a position swap: occurrence 4th-part hashes `evidence`, so those siblings are distinct ids of one range.

## P1

None open.

## P2

Fold in the same design pass or first B2 commits. Do not reopen the closed P1.

1. **Bind the coarser byte-order key and the tie exception to `requireUnchangedEvidence === false`.** Historical / B1 records with `requireStableByteOrder: true` must keep the current key (`evidence` + `column`) and current strictly-greater dest check. Do not globally drop `evidence`/`column` whenever byte-order is on, and do not install the equal-dest exception on those records. Independent check of the 136-pair B1 file under first-three + token: **2** dest-order failures in `parameter-modules/service.test.ts` (dest sequence not monotonic; not old/dest ties). Consumer 202-pair file has **5** same-range equal-dest groups that pass only with the B2 exception. EN says “when evidence may change” for the order key and gates the unchanged-key loop on the flag; say the same gate for the order key. ZH still omits the unchanged-key-loop sentence.

2. **ZH T14-01 exception and dest-swap test.** ZH names default-true flags and forbids setting them false off B2, but does not name the T14-01 exception EN states. ZH requires dest strictly increasing with the tie exception and “仍拒绝不同位置 dest 对调”, but omits process-in-`old.byteStart`-order and the test that swapping two dests at different `byteStart` under the same key must throw. State the same exception, processing order, and test in ZH.

3. **15 / 36 and “49 new first-three” in Why A/B1 are explanatory only.** Independent non-greedy split is **18** full token/evidence/column matches and **33** token-same with evidence/column differ, not 15/36. Unallowlisted with a **new** first-three (before pairing) is **48**, not 49. The B2 operational leftover **48+1 extra dest = 49** is the pairing count that matters. Not a second pairing rule.

When `requireIdenticalSlice` is false, B2 pairs still **store and prove** both digests (`sourceSliceSha256` required on those pairs even though the shared `.strict()` field is optional). ZH already stores both; keep the prove-both sentence.

## Closed prior P1 (do not re-open)

- **P1-1 ordinal text** (FAIL `01a0b21c-f9d5-42b3-a08f-3ffa5821c3e5`). `requireStableByteOrder: true`; when evidence may change, order key is first-three + `token` only (not evidence/column); tests reject same-anchor same-token dest swap. Present in both twins.

- **P1-2 ordinal vs 51 / stale 0 / leftover 48+1** (FAIL `14b8dc20-270b-43f3-b1fa-5c401da78239`). Both twins now allow dest `byteStart` to equal the previous dest **only when** `old.byteStart` also ties (shared-range double observation: `parameterReferences.ts` `read:parameter_specs` 2857→2737 twice). They use that exception so all **51** stale map. Leftover is **48 new-base-id + 1 extra same-anchor dest** (writeback). Different-position dest swap is still rejected. Do not invent dest spans. Independent dry-pair confirms those four claims are jointly true.

## P1 decisions (asked; stay closed)

1. **Allowing evidence+slice rewrite on the named B2 current record, flags default true elsewhere, is not checker weakening of historical records.** T14-04 weakening is deleted pairs, `--skip`, fixture rewrite that drops mapping, historical dest retarget, isolated dest-OID edit. Default-true flags used only on the named B2 file, with dual slice digests proven against source `git show` and working-tree dest, is the authorized rewritten-slice successor — not a global skip. Historical / source-workflow / consumer / 136-pair family records keep identical-slice.

2. **The remaining un-only hits must still block T1.4 zero.** Spec agrees. After B2 leftover **≈49**, T1.4 stays open. Repair C still waits.

3. **Historical records must keep identical-slice.** Spec agrees. Unset means `!== false`. Do not port the flags to `exactRelocation.ts`.

## Closed prior P2 (folded in the P1 repair)

- `sourceSliceSha256` optional on the shared `.strict()` pair schema (EN). ZH stores optional `sourceSliceSha256`; keep `.strict()` in the ZH flag sentence if it is edited for P2-2.
- Leftover is **48+1 extra dest**, not 49 new first-three (both B2 bodies).
- T14-01 “inventing checker flags” does not apply to these named default-true B2 flags (EN; ZH is P2-2).
- ZH dest-order check now includes the tie exception and different-position dest-swap rejection (remaining ZH test/order sentences are P2-2).

## Checked and accepted (do not reopen as P1)

- No allowlist growth. No scanner-rule deletion. No T2.2 pin deletion. Dest `new` is the current scan; missing dest span fails closed. Do not invent dest spans for the writeback extra dest at 26362.
- Apply **after** the 136-pair family record.
- Dual slice digests when identical-slice is off; historical records still reject slice mismatch.
- Repair C overlay keep / governance **detail** 2xx unchanged. No commit.
- First-three + token is not unique (14 / 30). The only same-key dest-swap vector that is not a position swap is the KNW equal-`byteStart` pair; occurrence-id construction (4th-part hash of `evidence`) distinguishes those siblings. Byte order must still reject a different-position dest swap.
- Writeback `read:project_parameter_bindings` really is an extra same-anchor dest (stale 8334 → dest 7432; leftover dest 26362).

Start B2 production against the named current successor file only. Fold the P2 wording so the validator does not coarsen historical / B1 byte-order keys. Do not claim T1.4 zero.
