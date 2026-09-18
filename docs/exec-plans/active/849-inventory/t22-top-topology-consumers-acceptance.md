# T2.2-TOP topology consumers — local implementation receipt

> Chinese: [中文](../../../zh-CN/exec-plans/active/849-inventory/t22-top-topology-consumers-acceptance.md)

Status: **T2.2-TOP local candidate complete.** Design Spec PASS with P2; implementation Standards PASS with P2; implementation Spec PASS with P2 (grok-4.6; requested gpt-5.6-luna unavailable). No SEALED, commit, PR, merge, Hosted, target, or Issue update.

Contract: [threat matrix](t22-top-topology-consumers-threat-matrix.md), [design](t22-top-topology-consumers-design.md), [design Spec review](t22-top-topology-consumers-spec-review.md), [implementation review](t22-top-topology-consumers-impl-review.md).

## Candidate

- Worktree: `/Users/tzrea1/Develop/WiseEff-worktrees/849-853-t11-source-identity`
- Branch: `codex/849-853-t11-source-identity`
- HEAD (unchanged): `f9c710f6a90d67462965a06abd47e33aa200e75e`
- Accepted main: `46b6068693942b95f7cba28ee5de6748a97170fa`
- T1.1–T2.2-CGH remain uncommitted dirty work. No commit.

## Behaviour delivered

1. `createBindingDraft` refuses `isStructuralPropertyKey`: `status` → 409 `structural-status-use-node-enablement` with successor node-enablement route; other structural keys → 409 `structural-property-not-value-draft`. No draft row.
2. `createHttpParameterTopologyRepository.createParameterSpec` throws typed GONE (`legacy-surface-retired`, successor `/api/v2/catalog`) without fetching or parsing a 201 body.
3. Mock `createParameterSpec` throws the same GONE and does not insert a spec. Activate successor test seeds `spec-draft-mystery`.
4. Topology HTTP bindings/history/compare/validate/value-draft/node-enablement stay 2xx. Spec-review/activate/list/get stay. CGH PATCH routes untouched. Binding identity tuple not rekeyed.

## Classification (T22T-01)

S12-TOP still **783** entries in **80** file×rule groups. **0 unexplained.** Four labels:

| Class | Count | Notes |
| --- | --- | --- |
| canonical-current-topology | 167 | editService, bindingService, ingest, routes, writeLock, overlay |
| canonical-current-dts-spec | 34 | topology client + port spec methods (`parameterSpecId` on the port) |
| exact-canonical-history | 582 | tests, e2e, `migration.ts` cutover |
| archived-notice | 0 | mint method remains on the port (throws); tokens remain |

Full file×rule groups: [t22-top-topology-consumers-classification.md](t22-top-topology-consumers-classification.md) (80 rows / 783).

## Ratchet (T22T-11)

| Measure | Before | After | Delta |
| --- | --- | --- | --- |
| S12-TOP | 783 | 783 | 0 |
| All shards | 3513 | 3513 | 0 |

Honest zero delta: repairs landed; `createParameterSpec` identifier still exists on the port/client. Shard not edited.

`parameter-catalog-boundaries:check --trusted-base-sha 9b3ba7df7e21f5589684bc92c872da593ad4c246` **did not complete**: `Runtime topology relocation rejected: destination whole-file blob for server/modules/parameter-topology/editService.ts`. Relocation fixtures were not rewritten.

## Verification (do not sum)

Helper PG: `postgres://wiseeff:wiseeff@127.0.0.1:55438/wiseeff_t22_cgh`. Not `wiseeff_lane_849`, not `5432/wiseeff`. No UI sweep.

| Command | Result |
| --- | --- |
| `test:server -- editService.test.ts` | **32 passed** (structural-key 409 and `parameter_drafts` count 0) |
| `test:server -- parameter-topology/routes.test.ts` | **22 passed** |
| `npm test -- parameterTopologyClient.test.ts mockParameterTopologyRepository.test.ts` | **54 passed** (25+29) |
| `npx tsc -b` | **passed** |
| `git diff --check` on TOP code files | **passed** |
| boundary checker | **did not complete** (editService relocation blob) |

## Remaining limits

- Binding identity still `project × node × parameterSpecId × module` until T1.4.
- Workbench `parameterSpecId` removal is T2.2-PRJ.
- Topology-client PATCH/lifecycle stay until T1.4.
- List `view=governance` still 2xx until T2.2-MOD.
- Checker blocked by relocation blob of this todo’s `editService.ts` edit; fixtures not rewritten.
- Client GONE payload is hand-rolled in `parameterTopologyClient.ts` (`requestId: ""`) rather than a shared src helper; payload still matches catalog gone.
- Status 409 English `message` does not include the POST path; path is in `details.successor`.
- No T2.2-PRJ, no commit.
