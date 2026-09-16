# Local Device Bridge multi-account rebind

> Chinese: [Chinese](../../zh-CN/exec-plans/active/2026-09-16-bridge-multi-account-repair.md)

## Goal

Account A can pair the local Bridge. After switching to account B, the page must ask B to rebind the same machine with a **new pairing code**, restart the local process onto B's bridge id/token, then auto-detect. `GET /api/v1/device-bridges/mine` stays user + organization scoped. B must never list, rename, revoke, or debug through A's bridge.

## Git & PR Workflow

- Scratch branch: `fix/bridge-multi-account-repair` from latest `origin/main`
- Stop boundary: focused tests + `npm run build` + `npm run bridge:package:check`; no GitHub PR from the implementation agent
- Evidence: frontend/wizard/panel/DTS reload/node-debugging tests, device-bridge runtime tests, device-bridge route/repository/pairing tests, debugging service isolation, installer/package consistency

## Public seam

- Web: latest local `/health` + current-user `/mine` after reconnect
- Bridge CLI: `connect --code` force-restarts and waits for the **new** `bridgeId`
- API: pair creates or reuses a machine bridge **for the pairing-code owner only**

## Documentation Impact Matrix

| Area | Action | Paths |
| --- | --- | --- |
| Repository maps | No change | `AGENTS.md`, `ARCHITECTURE.md` |
| Planning docs | Update | `docs/PLANS.md`, `docs/zh-CN/PLANS.md`, this plan |
| Product specs | No change | product-spec remains account-owned debugging |
| Architecture / frontend | Update | `docs/FRONTEND.md`, `docs/zh-CN/frontend.md` |
| Quality / testing | Update | `docs/developer/verification-matrix.md`, `docs/zh-CN/developer/verification-matrix.md` |
| Reliability / runbooks | Update | `docs/runbooks/local-device-bridge.md`, `docs/zh-CN/runbooks/local-device-bridge.md` |
| Security / governance | Review | `/mine` user+org isolation is unchanged |
| Generated artifacts | Update | `ops/self-hosted/bridge-artifacts/0.1.1/` |
| Installer docs | Update | `ops/self-hosted/bridge-installer/README.md`, `README.zh-CN.md` |

## Documentation Update Gate

All Update rows above are edited in this change. Security review: `/mine`, revoke, rename, and debug detect/session continue to query by `userId` + `organizationId`; no org-wide Bridge visibility was added.

## UI interaction automation

Existing DTS reload and node-debugging component tests cover the rebind CTA, poll exclude, auto-detect, and failure copy. No new browser acceptance requirement ID is added in this round; real two-account hardware acceptance remains a local operator check.

## Verification

```bash
npm test -- src/components/bridgePanelStatus.test.ts src/infrastructure/http/bridgeConnectFailure.test.ts src/components/LocalDeviceBridgeWizard.test.tsx src/components/LocalDeviceBridgePanel.test.tsx src/features/dts-reload/DtsReloadPage.test.tsx src/NodeDebuggingPage.bridgeRebind.test.tsx
npm run bridge:test -- packages/device-bridge/src/connectCommand.test.ts packages/device-bridge/src/ensureBridgeRunning.test.ts
npm run test:server -- server/modules/deviceBridge/pairingService.test.ts server/modules/deviceBridge/routes.test.ts server/modules/deviceBridge/repository.test.ts server/modules/debugging/service.test.ts
npm run test:scripts -- scripts/check-bridge-package-consistency.test.ts scripts/check-acceptance-ci.test.ts
npm run bridge:package:check
npm run build
npm run lint
```
