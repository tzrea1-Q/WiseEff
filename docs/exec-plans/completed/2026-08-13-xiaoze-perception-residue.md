# Xiaoze perception residue: delete the dead compatibility layer, break the import cycles

> Status: **Completed 2026-08-13** (single-PR change; plan recorded at completion)
> Date: 2026-08-13
> Branch: `refactor/xiaoze-perception-residue`
> Chinese: [`docs/zh-CN/exec-plans/completed/2026-08-13-xiaoze-perception-residue.md`](../../zh-CN/exec-plans/completed/2026-08-13-xiaoze-perception-residue.md)
> Source: 2026-08-12 architecture review, candidate 6

## What changed

- **Deleted dead code** (re-verified against post-review main — the #358/#363 hardening did not revive any of it): `createPerceptionAgent` (26-line adapter with no production caller; its wrapper-level tests were parity-covered by `planningGraph.test.ts`, and the one uncovered behavior — the forbidden safe answer — was ported to the graph test), `PerceptionAgentRunInput`'s host re-export of `looksLikeInternalReasoning`, and `threadRepository.ts`'s unused `toAgentContext` / `isOwnedXiaozeSession`.
- **New `modelTypes.ts`**: the pure model/agent shape vocabulary (`Perception*` types plus `XiaozePromptDebugSnapshot`) with no implementation imports. `perceptionAgent.ts` shrinks to the model wrappers (`wrapLangChainChatModel`, `invokeModel*`, `normalizeModelResponse`, `appendStreamText`); the `perceptionAgent ⇄ planningGraph`, `perceptionAgent ⇄ promptDebug`, and `toolCatalog → perceptionAgent` cycles are gone — type consumers (`planningGraph`, `toolCatalog`, `promptDebug`, `agUiEndpoint`, `xiaozeTurnStream`, eval) import `modelTypes` directly.
- **Test/demo helpers left production files**: `fakeModelSequence` / `toolCall` moved from `planningGraph.ts` to `xiaoze/testing/fakeModel.ts` (four test files plus `eval/scenarios.ts` repointed); `createDeterministicPerceptionModel` moved from `agUiEndpoint.ts` to `deterministicModel.ts` (still production-reachable behind `XIAOZE_DETERMINISTIC`, but no longer resident in the endpoint).

## Verification

- `npx tsc -b --force` green; `server/modules/agent` suite green (32 files, 179 tests, including the newly ported forbidden-safe-answer graph test).
- Deletion test holds: no caller re-implements the removed adapter; the graph is invoked directly by the endpoint factory as before.

## Documentation Impact Matrix

| Area | Action | Paths |
| --- | --- | --- |
| Planning | Update | This plan + zh; `docs/PLANS.md` + zh |
| Others | No change | No wire, behavior, security, or ops surface touched |

## Documentation Update Gate

- [x] `docs/PLANS.md` EN + zh list this plan
- [x] `npm run docs:check` green
