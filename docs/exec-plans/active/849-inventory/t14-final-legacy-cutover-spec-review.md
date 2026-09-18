# T1.4 design Spec review

> Chinese: [中文](../../../zh-CN/exec-plans/active/849-inventory/t14-final-legacy-cutover-spec-review.md)

Model: grok-4.6 (requested gpt-5.6-luna unavailable)
Verdict: **PASS with P2**

Independent Spec re-review of [t14-final-legacy-cutover-design.md](t14-final-legacy-cutover-design.md) and [t14-final-legacy-cutover-threat-matrix.md](t14-final-legacy-cutover-threat-matrix.md), with ZH companions and the T1.4 paragraph in [2026-09-16-849-853-closure-todolist.md](../2026-09-16-849-853-closure-todolist.md). Reviewer did not write the design. No production edits, commit, T2.3 deletion, PR, or T1.4 completion in this review.

Prior FAIL `01a0b09b-727a-7128-9ec2-9e13c8668c97`. This re-review `01a0b0a8-0492-434d-6fbb-ac1520d36674` **PASS with P2**. Prior P1-1 and P1-2 are **closed**. They are not re-listed as open P1. Production implementation of Repair A may start. Fold the P2 wording below in the same design pass or with the first implementation commits. This review does not mark T1.4 complete.

HEAD `f9c710f6a90d67462965a06abd47e33aa200e75e`. Dest drift independently re-measured against working-tree `git hash-object`. Checker apply order remains exact → post-cutover → debugging-transfer → source-workflow (historical proof, then current scan) → consumer. Shared `requireMatch` prefix `Runtime topology relocation rejected` is the runner, not proof that historical runtime-topology is the failing current scan.

## P1

None open.

## P2

1. **Key Decision 5 vs Repair B / T14-03.** Repair B and T14-03 are the gate: leftover shard rows after B are remaining current; naming an owner is not zero; T1.4 is incomplete while scanner hits remain; exact-canonical-history is a receipt classification, not a paper zero. KD5 still says “honest leftover history must be named.” Read alone, that recreates prior P1-2. Fold KD5 to the B sentence: naming is receipt-only.

2. **`recordSha256` sequencing.** A must change the two current JSON files and the hardcoded `recordSha256` values in `sourceWorkflowRelocation.ts` together, or integrity fails. This design PASS authorizes producing those bytes from the current scan. “Spec re-review PASS of the new bytes” is the **implementation** Spec of A, not a second design gate that blocks starting A.

These do not reopen current-vs-historical split, pair-`new` rebind, or the zero-current honesty gate.

## Closed prior P1s (do not re-open)

- **P1-1 Destination successor scope vs historical proof (T14-01 / T14-02 / T14-04).** Repair A / T14-02 now name only `source-workflow-relocation.json` and `source-workflow-consumer-relocation.json` (and those two `recordSha256` pins). Allowed: recompute current dest OID; rebind every pair `new` to the scanner’s exact destination occurrence (`requireStableStructuralAnchor` = first three id parts; 4th-part fingerprint, `trustedBlobOid`, line/column, byte offsets = current scan). Forbidden: isolated dest-OID edit; pair deletion; allowance growth; skip; source-inventory rewrite; rewriting historical JSON dest OIDs or provenance. Historical stays `runtime-topology-relocation.json` / `edit-service-version-index-relocation.json` at commits `e31226b6…` / `8ef8f251…` / tree `38f9040e…`. Span not found → fail closed. Next dest-blob error on a historical record → stop.

  Independent dest hashes: current drift is exactly the named files — source-workflow `editService.ts` 26 (`0d87d79a…` → `0052e18d…`) and `editService.test.ts` 28 (`22cd4709…` → `edcd0ff5…`); consumer import-wizard 2, topology e2e 83, `writebackService.ts` 21, `parameterTopologyClient.test.ts` 22, `parameterTopologyClient.ts` 33. `overlayWriteback.ts` already MATCHES `2c568b87…`. Other current-scan records MATCH and stay pinned: `post-cutover-test-relocation.json`, `debugging-transfer-relocation.json`, `property-key-cutover-relocation.json`, plus MATCH files inside the two successor records. Historical dest OIDs still differ from working-tree hashes (expected) and must not be retargeted.

- **P1-2 ZH Repair B vs leftover history tokens.** ZH Repair B now matches EN: remaining scanner hits must be 0; the checker does not distinguish history/test; leftover shard rows are remaining current; naming an owner is not zero; T1.4 is not complete while shard rows remain; exact-canonical-history is receipt classification, not a paper zero. T14-03 EN/ZH say the same.

## Closed prior P2s (folded)

- Pair **old** ids stay in full. Pair **new** keeps only the stable structural anchor (first three parts). The 4th component, `trustedBlobOid`, line/column, and byte offsets must equal the current scan (`exact destination occurrence`). Literal whole `new.id` stay is forbidden in EN Repair A / T14-02 and ZH Repair A.
- ZH Repair C keeps overlay 2xx while the module picker is a DTS adapter; governance **list** 410 only after live-caller proof; **detail** stays 2xx (CGH P1, T2.1 `semanticBindingFixture`); do not churn that fixture; dual-write/TD-125 only with a named successor; T2.3 delete / PR / target remain non-goals.

## Checked and accepted (do not reopen as P1)

- **Governance detail 2xx (CGH P1).** Winning `GET /api/v2/parameter-specs/:specId` is a different route from list `GET /api/v2/parameter-specs`. T2.1 `semanticBindingFixture.ts` uses detail `?view=governance`. API mode mounts `CatalogOrganizationSurface`; `OrganizationSpecGovernancePanel` is mock/no-catalog. Keep **detail** 2xx; list 410 only after live-caller proof. Do not 410 detail.
- Isolated dest-OID edit is forbidden. Pair `new` rebind to the current scan is required. Historical dest OIDs stay. That is not checker weakening.
- Overlay keep until no live product caller (MOD picker remains a DTS adapter) is correct.
- No T2.3 archive-table drop, no PR, helper PG 55438 only.
- Fence/stale-replay may be a T2.3/T3.1 contract if this todo is not the epoch writer; restart refusal reuses T1.3 + OPS CLI 410.

Start Repair A against the two named current successor files only. Do not retarget historical dest OIDs. Do not claim T1.4 zero while leftover shard rows still scan.
