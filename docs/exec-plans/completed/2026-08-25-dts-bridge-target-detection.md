# DTS parameter target detection through the connected Device Bridge

> Chinese: [Chinese](../../zh-CN/exec-plans/completed/2026-08-25-dts-bridge-target-detection.md)

**Status:** Completed 2026-08-25 for GitHub issue #630. The implementation is committed on the feature branch; unrelated login-page work remains uncommitted and unstaged.

## Goal

Make `/dts-reload` use the same authenticated, organization-scoped Device Bridge target-detection seam as node debugging. A target-detection request may carry a Bridge ID only when local health reports that Bridge connected and the ID is present in the registered Bridge list. HDC and ADB switching, Bridge replacement/disconnection, stale targets, typed errors, and request sequencing must remain safe.

## Scope and decisions

- Extend the page-to-gateway seam and HTTP request body with an optional, trimmed `bridgeId`; keep `POST /api/v1/debugging/targets/detect` canonical.
- Keep server authentication, permission, organization, revocation, connection-pool, and protocol-gateway checks unchanged; no migration, RPC shortcut, synthetic `deviceId`, or 409 reclassification.
- Clear target presentation and invalidate in-flight detection when the Bridge or protocol changes. Ignore responses for an old request, Bridge, or protocol.
- Keep typed `PROTOCOL_UNSUPPORTED` / `DEVICE_UNAVAILABLE` errors visible with the existing localized request-ID presentation; show a separate actionable empty-target message.
- Local browser evidence is limited to the offline Bridge state because this workstation has no connected Device Bridge or HDC device. Real Windows Bridge/HDC and multi-replica affinity remain deployment acceptance work.

## Implementation record

| Area | Files | Result |
| --- | --- | --- |
| Page detection state | `src/features/dts-reload/DtsReloadPage.tsx` | Uses only a health-confirmed registered Bridge, passes the current protocol and ID, clears stale state, sequences requests, and exposes offline/empty/typed failures. |
| Application seam | `src/app/routes.tsx` | Forwards the optional Bridge ID into the existing debugging gateway. |
| HTTP contract | `src/infrastructure/http/debuggingClient.ts` | Serializes a valid trimmed ID and omits an unavailable/blank ID. |
| Bridge selection | `src/application/bridge/bridgeTargetSession.ts` | Prefers the newly health-confirmed registered Bridge. |
| Regression coverage | `src/features/dts-reload/DtsReloadPage.test.tsx`, `src/infrastructure/http/debuggingClient.test.ts`, `src/application/bridge/bridgeTargetSession.test.ts`, `server/modules/debugging/routes.test.ts` | Covers HDC/ADB, offline/readiness, replacement/disconnection, stale responses, request serialization, Bridge selection, canonical routing, and both typed 409 codes. |

## UI interaction automation review

- Existing acceptance ownership remains `DTS-RELOAD-DEPLOY-001` and conditional `DTS-RELOAD-DEPLOY-HW-001` in `e2e/acceptance/dts-reload-deploy.acceptance.spec.ts`; no new operation ID was needed because this repair changes target discovery for the existing `/dts-reload` workflow.
- The existing fake-Bridge acceptance path continues to own deploy RPC evidence. The local browser walkthrough below owns page state, protocol switching, manual retry, offline error, snapshot, screenshot, console, and network checks.
- A real Windows Bridge/HDC run is explicitly not claimed from local evidence and must be performed in the deployment-machine acceptance environment.

## Verification evidence

### Automated checks

- `npm test -- src/features/dts-reload/DtsReloadPage.test.tsx src/infrastructure/http/debuggingClient.test.ts src/application/bridge/bridgeTargetSession.test.ts`: 3 files / 67 tests passed after the final protocol/Bridge sequencing additions.
- `npm run test:server -- --run server/modules/debugging/routes.test.ts -t "connected bridge id|typed target-detection failure"`: 3 passed after both typed route cases were added.
- `npx tsc --noEmit --pretty false` and `git diff --check`: passed after the final sequencing changes.
- Earlier repository gates: `npm run ui:check` passed; `npm run build` passed; `npm run test:scripts` passed with 948 tests and 5 skipped; `npm run bridge:test` passed with 138 tests; `npm run test:server` passed with 2,746 tests and 8 skipped.
- The final `npm test` frontend phase passed 410 test files / 3,058 tests, with only the unrelated inherited `src/App.test.tsx` login-registration expectation failing; that test attempts to find a removed `注册` tab. The existing `src/App.tsx` and `src/App.test.tsx` changes were not staged or modified by this issue.

### Browser walkthrough

- Route: `http://127.0.0.1:5173/dts-reload`, API mode, at `1440x900`, `768x1024`, and `390x844`.
- Snapshots and screenshots were captured for all three viewports under `work/ui-checks/issue-630/`; representative files include `dts-reload-1440.snapshot.txt`, `dts-reload-1440-offline.snapshot.txt`, `dts-reload-768.snapshot.txt`, `dts-reload-390.snapshot.txt`, and matching PNG files. `playwright-cli` screenshots are `playwright-cli-1440.png`, `playwright-cli-768.png`, and `playwright-cli-390.png`.
- Exercised manual `重新检测`; the offline alert was shown and the browser request list contained no `POST /api/v1/debugging/targets/detect` in the offline path. API-backed project/Bridge resources returned successfully where applicable.
- The local Bridge health endpoint repeatedly returned `GET /local-bridge/health` 500 because no local Bridge process is running; these are environment errors, not a target-detection 409. The in-app browser recorded no JavaScript errors; `playwright-cli` surfaced the same failed health resources as console errors. This is reported rather than treated as hardware readiness.
- The 390px screenshots retain an existing horizontal clipping/overflow in the Bridge setup panel; the Issue #630 patch adds no layout styles and does not change that unrelated surface.
- Real deployment acceptance remains pending: Windows Bridge health, matching `bridgeId`, HDC capability, a Bridge-backed 200 target response, no persistent target-detection 409, and negative multi-replica affinity checks were not run here.

## Documentation Impact Matrix

| Area | Status | Evidence |
| --- | --- | --- |
| Repository maps and agent guidance | Review | No new subsystem, route, runtime mode, or security boundary. |
| Planning and technical debt | Update | This completed plan and its Chinese companion record the implementation and bounded target-environment follow-up. No debt row is created because deployment evidence is an existing conditional acceptance boundary. |
| Product specifications | No change | Existing DTS reload and Device Bridge product behavior already define the workflow; this is a defect repair. |
| Architecture and domain model | No change | Existing page/gateway/Bridge seams are reused; no new domain entity or architectural decision. |
| API contracts | Review | Existing canonical detect endpoint gains only the already-supported optional Bridge ID; route tests preserve the contract and typed 409 response. |
| Security and governance | Review | Server authz, organization filtering, revocation, connection pool, and audit behavior are unchanged. |
| Reliability and runbooks | Review | One-replica and real-HDC evidence boundaries remain deployment notes; no runbook behavior changes. |
| Quality and testing | Review | Existing DTS reload acceptance IDs remain owners; focused page, HTTP, Bridge-session, and route tests were extended. |
| Frontend and design | Review | Existing tokens and Bridge panel are reused; visible error states were verified at the required viewports. |
| Generated artifacts and references | No change | No schema, OpenAPI, generated coverage, or external reference changed. |

## Documentation Update Gate

- [x] This plan and its Chinese companion are in `completed/`; no active copy remains.
- [x] Every `Review` row was checked against the implementation scope; no unrelated architecture, security, runtime, or acceptance-map edit is required.
- [x] Local verification evidence and the real-hardware evidence boundary are recorded above.
- [x] Any remaining real-device or multi-replica work is explicitly bounded to deployment acceptance and is not claimed complete here.

## Git & PR Workflow

Implementation stayed on `codex/actual-test-fixes-20260825`, based on the current `main`. Only Issue #630 files were committed; the inherited `src/App.tsx` and `src/App.test.tsx` changes remain unstaged. The parent/session owner retains responsibility for any future PR, merge, and local `main` synchronization.
