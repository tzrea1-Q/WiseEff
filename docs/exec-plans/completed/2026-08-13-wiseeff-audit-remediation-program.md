# WiseEff audit remediation program — closeout

> Status: **Completed 2026-08-13** (multi-PR program; the one remaining item is a product decision tracked as TD-108)
> Date: 2026-08-12 → 2026-08-13
> Chinese: [Chinese](../../zh-CN/exec-plans/completed/2026-08-13-wiseeff-audit-remediation-program.md)

## Background

A six-agent audit on 2026-08-12 reviewed spec-vs-implementation gaps, frontend UX, backend security and API contracts, quality gates, in-flight work, and documentation governance, and produced a prioritized findings list. This program tracked the remediation. The original active-plan file was lost to a worktree race during the same high-concurrency development window, so this closeout re-records the durable outcomes.

## Landed by this program

- **Documentation honesty (#325).** `docs/product-specs/prototype-functional-spec.md` gained a real "Simulation boundaries" section (rule-based analysis, templated AI summaries), fixing the dangling reference from `product-spec.md`; zh-CN spec pages mirrored. `docs/FRONTEND.md` marks ADR-0001's `ProjectOperationsDialog` as superseded by the #240 configuration workbench. `ARCHITECTURE.md` backend map now lists `jobs/`, `notifications/`, `deviceBridge/`, `contracts/`.
- **Path traversal guard (#325).** `nodePathSchema` rejects `..` segments; dotted node paths (`battery.0`) stay valid. `server/modules/debugging/schemas.ts` plus tests.
- **Global error boundary (#325).** `src/components/common/ErrorBoundary.tsx` wraps the app root; render crashes land on a recoverable zh-CN fallback (retry / reload / home / copy diagnostics) instead of a white screen.
- **Doc-governance duplicate check (#325).** `scripts/check-doc-governance.ts` fails when one plan filename lives in both `active/` and `completed/`.
- **Device-bridge audit trail (#337).** Pairing-code issue, pairing (reuse and new-bridge paths, at the service layer), rename, and revoke now write audit events with severity mapping; token values are never logged.
- **CI contract gate (#433).** `contract:check` (OpenAPI drift) joins `build-and-test`. `bridge:test` and `test:scripts` gates were added to CI by parallel work in the same window.
- **#417 conflict resolution.** The P2 page-defect wave collided with the DebuggingGateway port refactor on main. The resolution kept both intents: mandatory `debuggingActions` plus the `runtimeStatus`/`runtimeError`/`onRuntimeRetry` surface, bridge seams intact; the test fetch mock now answers `/health` and `/api/v1/device-bridges/{mine,releases}` so panel mounts stop stealing queued hdc responses; the demo-toast test was retired because the refactor removed that branch (detect failures stay covered by the event-history assertion). 58/58 page tests green.

## Verified as closed by parallel development

- **Auth fail-closed.** `contextFactory`, `tokenVerifier`, and `oidcVerifier` production paths rethrow every failure as 401 `ApiError`s; no fail-open catch remains.
- **Mock-runtime honesty.** Owned and completed by `2026-08-05-mock-honesty-and-dead-residual-cleanup.md`.
- **CI test-file gaps.** `test:scripts` / `bridge:test` steps exist on main.

## Remaining product decision → TD-108

`packages/device-bridge` answers `/connect` and `/health` with `Access-Control-Allow-Origin: *` plus Private Network Access approval **by design** (zero-friction pairing from any WiseEff origin, including LAN/self-hosted). The audit flagged it as a P0 candidate; investigation showed an intentional trade-off — pairing still needs a short-lived code and bridge-side confirmation. Narrowing to an origin allowlist is a product decision, tracked as TD-108 in the tech-debt tracker.

## Verification

- `npm run contract:check` green on top of main `57364c79`.
- `src/NodeDebuggingPage.test.tsx` 58/58 after the conflict resolution.
- `npm run docs:check` green including this closeout pair.
