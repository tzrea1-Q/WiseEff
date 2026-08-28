# Node write execution and observation outcomes

Chinese companion: [中文](../../zh-CN/exec-plans/active/2026-08-28-node-write-observation-outcomes.md)

## Goal

Separate ordinary node-write command execution from the optional post-write observation. A successful write command remains successful when a later read returns a different representation such as `0x1` for requested value `1`. WiseEff displays the observed value but does not judge equality.

Branch: `codex/node-write-observation-outcomes-20260828`, based on `main@246730efe`.

## Boundaries

- Applies to ordinary single, bulk, and Agent-approved node writes through HDC, ADB, Device Bridge, simulator, and mock runtimes.
- Retains pre-write snapshots and rollback preparation whenever a write may have executed.
- Does not change strict rollback verification or DTS reload behavioural verification.
- Rejects true write-only nodes because a safe pre-write snapshot cannot be obtained.
- Preserves historical `status`, `verified`, and `readback_mismatch` data as legacy-policy evidence. New writes use explicit outcomes.
- Real HDC/ADB readiness remains conditional on target-device evidence and is not inferred from local tests.

## Confirmed public test seams

1. `createDebuggingService().writeNode/readNode/listSessionEvents`.
2. `createRpcHandlers().handle("debug.writeNode")` and `writeNodeViaBridge`.
3. Public debugging write/read/session-event HTTP contracts.
4. Node-debugging application session public state and actions.
5. `NodeDebuggingPage` user interactions.
6. API-mode `/node-debugging` browser acceptance at 1440x900, 768x1024, and 390x844.

Schema changes are verified through formal migrations and public service/API reads, not private migration helpers.

## Outcome model

- `writeOutcome`: `executed | failed | unknown`.
- `readbackOutcome`: `observed | failed | unsupported | not_requested | unknown`.
- `targetValue` remains the requested value; `currentValue` becomes the latest successful observation.
- A readback failure preserves the previous current value and marks it stale in the session UI.
- Write failure is an error. Executed write plus readback failure is a warning. Any successfully observed value is informational and never a mismatch warning.
- A read-only retry creates a separate read operation linked to the original write and never rewrites the original operation.

## Acceptance and feedback loops

- Update `DEBUG-SIM-001` from equality verification to independent execution/observation outcomes.
- Cover requested `1` with observed `0x1`, write failure, readback failure, unsupported readback, mixed bulk outcomes, stale-value preservation, and read-only retry.
- Keep `HDC-LAB-001` and `ADB-LAB-001` as conditional target-environment evidence for the same cases.
- Run the narrow test after each Red/Green slice, then the affected server/frontend suites, build, docs checks, and browser quality gate.

## Implementation tasks

- [x] Add an additive migration and outcome-aware operation contract.
- [x] Make HDC, ADB, Bridge, simulator, and mock gateways report command and readback outcomes independently.
- [x] Persist both outcomes, values, technical failures, snapshot validity, and read-retry linkage in the service/API.
- [x] Update application session and page UI for independent write/readback states, mixed bulk summaries, stale current values, and read-only retry.
- [x] Update audit/history presentation and notifications without rewriting historical rows.
- [x] Update current bilingual product, API, security, operations, and acceptance documentation.
- [x] Record exact automated and browser evidence; keep real-device readiness explicitly pending when unavailable.

## Documentation Impact Matrix

| Surface | Impact | Planned update |
| --- | --- | --- |
| Product/debugging behaviour | Write success no longer depends on equality | Update English and Chinese product/prototype docs |
| API and DTO contract | Add explicit write/readback outcomes and retry linkage | Update API/design references and schemas |
| Security/audit | Persist command and observation evidence separately | Update security/audit documentation |
| Device Bridge | Add outcome-aware capability/version and legacy inference | Update Bridge/runbook documentation |
| Acceptance | Replace mismatch expectation for new ordinary writes | Update simulator and conditional device-lab matrices |
| Historical design | Existing mismatch decisions remain historical | Add supersession notes instead of rewriting history |

## Documentation Update Gate

- English and Chinese current-behaviour documents describe the same outcome model.
- Public DTO examples and generated/hand-maintained references match the implemented fields.
- Acceptance IDs and expected evidence are updated before completion.
- `npm run docs:check` passes.

## Git and PR workflow

Implementation stays on the feature branch until the explicit delivery request is completed. Commit, PR creation, merge, and local `main` synchronization are the current delivery follow-up.

## Verification evidence

Evidence was captured from branch `codex/node-write-observation-outcomes-20260828` before the delivery commit, based on exact SHA `246730efefb97336428618a20bbc809334bc6fce`; the commit/PR delivery is now being completed as the requested follow-up.

- Migration/schema: all 114 migrations, including `0116_node_write_observation_outcomes.sql`, were applied to a fresh temporary `pgvector/pgvector:pg16` database; `npm run db:schema-doc:check` passed against that canonical schema. The temporary container was then removed.
- Server: `npm run test:server -- --run server/modules/debugging server/modules/notifications/producers.test.ts server/modules/contracts/openapi.test.ts` — 17 files, 261 tests passed.
- Frontend: `npm test -- --run src/NodeDebuggingPage.test.tsx src/application/debugging src/infrastructure/http/debuggingDtos.test.ts src/infrastructure/http/debuggingClient.test.ts src/infrastructure/mock/mockDebuggingGateway.test.ts src/components/admin/AuditEventDetail.test.tsx` — 7 files, 138 tests passed.
- Device Bridge: `npm run bridge:test` — 21 files, 138 tests passed.
- Static/build/contracts/docs: `npx tsc -b --pretty false`, `npm run build`, `npm run contract:check`, `npm run docs:check`, `npm run acceptance:coverage`, and `npm run acceptance:operations` passed. `docs:check` passed governance and skipped only its local pgvector comparison because the current server lacks pgvector; the separate canonical-container check above passed.
- Browser route/runtime: `http://127.0.0.1:5173/node-debugging` in API mode with simulator-backed API `http://127.0.0.1:8787`; both listener processes had cwd `/Users/tzrea1/Develop/WiseEff-worktrees/node-write-observation-outcomes-20260828`.
- Browser interaction: wrote target `2` to the simulator representation probe and received HTTP 200 with `requestedValue=2`, `readbackValue=1`, `verified=null`, `writeOutcome=executed`, and `readbackOutcome=observed`. The dialog displayed “写入已执行” and “回读值：1” without mismatch judgement.
- Browser viewports: snapshots and screenshots were captured at 1440x900, 768x1024, and 390x844. Mobile measured `innerWidth=390`, `scrollWidth=390`; the dialog stayed within the viewport (`left=28`, `right=370`, `width=342`, `bottom=832`). No overlap, clipping, or horizontal overflow was found.
- Screenshots: `work/ui-checks/node-write-observation-outcomes-20260828/desktop-1440x900-final.png`, `tablet-768x1024-final.png`, and `mobile-390x844-final.png`.
- Console/network: WiseEff API reads and the write request succeeded. Repeated console 500s were limited to optional `/local-bridge/health` because no local Bridge process was listening on 127.0.0.1:18787; this did not affect API/simulator evidence.
- Conditional evidence not run: no real HDC target, real ADB target, or running local Device Bridge was available. `HDC-LAB-001` and `ADB-LAB-001` therefore remain target-environment pending; their specs now assert independent ordinary-write outcomes while retaining strict rollback checks.
