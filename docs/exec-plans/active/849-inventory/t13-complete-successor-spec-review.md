# T1.3 design Spec review

Model: grok-4.6 (requested gpt-5.6-luna unavailable)
Verdict: PASS with P2

Independent re-review of [t13-complete-successor-design.md](t13-complete-successor-design.md) and [t13-complete-successor-threat-matrix.md](t13-complete-successor-threat-matrix.md) after the writer revised the prior FAIL (P1-1/P1-2/P1-3). Chinese twins were spot-checked for decision parity. Cited production code was re-checked where the revision depends on it. This review does not edit production code and does not mark T1.3 complete.

Prior P1-1, P1-2, and P1-3 are **closed**. They are not re-listed as open P1. Production implementation may start; fold the P2 wording below in the same design pass or with the first implementation commits.

## P1

None open.

## P2

1. **Leftover “split DTS/JSON” / dual composer wording.** Design §5.1 and PR Plan D correctly require mixed `misc` membership and a composer next to `importVendorCatalog`. Implementation order step 7 still says “Split materialize DTS/JSON”, and PR Plan B still lists “seed/publication composer”. An implementer reading only those lists could recreate P1-1. Point both at §5.1 / `catalog-publication/import/`. Chinese twins have the same leftovers (§11 step 7「拆分 materialize 的 DTS／JSON」; PR 步骤 B「种子／发布编排」).

2. **B2-19 should state preflight-before-DTS-sync.** Design §5.2 order is: stage → placement barrier → JSON preflight (no writes) → DTS sync → JSON register. A mapping/parse failure at step 3 therefore yields **zero bindings total**, not merely zero JSON bindings. Matrix B2-19 currently says only “zero JSON bindings” and does not say preflight precedes DTS sync. Align the row with §5.2 so implementers do not sync DTS first and then preflight.

3. **`seed_digest` payload.** §5.2 / B2-16 correctly require SHA-256 over all three per-project files so a DTS-only digest cannot `already-complete` skip JSON. “Plus the existing reviewed plan identity” is still unnamed. Pin the exact concatenation (file bytes in a stated order, plus which plan fields) in the digest owner so replay tests are not guessed.

These do not reopen a gate, identity, B6, or 124/372 hole. They are wording honesty for the implementer.

## Closed prior P1s (do not re-open)

- **P1-1 mixed membership.** JSON is config-set `misc` (sort 2), never overlay. Ingest manifest is `entryFile: vendor-drivers.dts`, `overlayOrder: [charging-thermal.dts]`, `members` = all three. JSON is a revision **member** and not a DTS parse/overlay input. Bindings still go only through `registerCanonicalJsonSource` after reuse of that mixed revision. B2-09/B2-10 now say the distinction. Matches `ingestService.ts:850-883` and `canonicalJsonSource.ts:75-88`.
- **P1-2 JSON writes after the barrier.** Stage loop is explicit “no binding writes”. Placement barrier: `failed` + `SeedInitializationBlockedError` + **zero** bindings, no DTS sync, no JSON register (B2-13). JSON preflight for all three projects before the first `registerCanonicalJsonSource` (B2-19). Replay skips JSON register. Unexpected post-preflight register failure is classed with later-project DTS sync failure: not `completed`, not a B6 bypass.
- **P1-3 ConfigurationSchema on the B6 list.** Stage registration input is `observedSubjectsWithDefinitions ∪ [{ subjectId: published wiseeff.power-config, subjectKind: "configuration-schema" }]`, after a free `business` module exists and before the barrier. Missing snapshot subject is a publication failure, not a silent skip. Matches `registration.ts:49-69` (DTS-only observation) and `canonicalJsonSource.ts:133-134` (registration required).

## Closed prior P2s (folded)

`productPath: "m2-core"`; required `documentation` copied from reviewed `power-management.json`; override only `CATALOG_CAPABILITY_ALLOW_LIST.maxChangeSetOps` (do not mutate `SHARED_BUDGETS`); extra capacity via `createParameterModule` with **no** compatible mapping, not `registerOrClaimDriver`; B2-11 oracle key matches §8; seed YAML/TOML/ENV evidence is `materialize.test.ts`; dangling **29** `&label` / **37** missing `&name`, mint no bindings; digest covers three files; `createUserInvocation(auth)`; composer next to `importVendorCatalog`. Chinese decision parity holds (inventory 127/119/124, mixed `misc`, barrier, explicit ConfigurationSchema, 55438 vs `wiseeff_lane_849`).

## Checked and accepted

- Inventory honesty 127 / 119 / 124 / 372; T1.2 `charging_core` properties merge onto DTS locators; no extra bindings.
- Two successors; vendor YAML-only; ConfigurationSchema through `buildCompleteSuccessor` from the installed vendor predecessor.
- One model `wiseeff.power-config`; keys 18 and 27 chars under the 31-char cap; JSON Pointer `/charger.cv.limitMv` and `/battery.thermal.targetTempC`.
- TD-124 YAML/TOML/ENV; bogus `TD-124-json-project-source-semantics` removed.
- Original approver; no invented SQL; curator outside `materializeSeedSources`; idempotent claim-or-skip on procedure replay.
- B6 still fail-closed without extra `driver-group` (and without free `business` if required), including when ConfigurationSchema is omitted from the registration list.
- Helper PG 55438; not `wiseeff_lane_849`; local ≠ target; no new migration.
- Frozen v3 stays 32; v4 budget 128 is a second successor’s margin, not a vendor-import concatenation.

Start implementation against §5.1, §5.2, and §6.2 as the binding procedure. Clean the P2 leftovers in the same docs pass so the implementation-order list cannot regress P1-1.
