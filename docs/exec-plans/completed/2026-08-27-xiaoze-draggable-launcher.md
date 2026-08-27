# Xiaoze Draggable Launcher and Coupled Popup

Status: **Completed — implemented and locally verified**  
Date: 2026-08-27  
Feature branch: `codex/xiaoze-draggable-launcher-20260827`  
Baseline: `origin/main@e87d7d23d6c9e442839527b0bc9879ce27d83b37`

## Goal

Let desktop and tablet users drag the Xiaoze launcher across the full safe viewport. When Xiaoze is open, the launcher remains the visible drag handle and the popup follows through smart top/bottom/left/right attachment. Mobile keeps the established full-screen popup contract.

## Success Criteria

- A pointer drag on the launcher moves it without toggling Xiaoze.
- A click without crossing the drag threshold still opens or closes Xiaoze.
- Opening after a closed-state drag places the popup next to the launcher.
- Dragging the launcher while open lets the launcher cover the safe viewport while the popup follows on the side with enough room and stays visible.
- Header drag, resize, reset, persistence, route continuity, keyboard access, and mobile full-screen behavior remain intact.
- `XIAOZE-POPUP-MOVE-001` acceptance evidence exercises launcher drag in closed and open states.

## Architecture

`xiaozePopupLayout.ts` remains the sole geometry boundary. Launcher position is independent from popup geometry and owned by the current `useXiaozePopupLayout` page lifetime; it is intentionally not persisted, so release/open/close/SPA navigation retain it while browser refresh resets it. The obsolete `wiseeff.xiaoze.launcher.position.v1` record is removed on mount. Popup geometry remains under layout v2. On open launcher drag, the module selects a fitting top, bottom, left, or right attachment and clamps both surfaces independently. `useXiaozePopupLayout.ts` owns gesture cleanup and commit timing. A post-drag click is suppressed, while sub-threshold pointer input remains a normal toggle click.

## Git & PR Workflow

Implementation and verification occur only on `codex/xiaoze-draggable-launcher-20260827`. This task does not open or merge a PR unless the owner requests it after reviewing the result.

## Planned Files

- `src/features/agent/xiaozePopupLayout.ts` and tests: group clamping and launcher placement.
- `src/features/agent/useXiaozePopupLayout.ts`: shared launcher/popup gesture controller.
- `src/features/agent/XiaozeChatToggleButton.tsx` and `src/styles.css`: explicit draggable surface and states.
- `e2e/acceptance/xiaoze-popup-layout.acceptance.spec.ts`: real launcher and coupled movement coverage.
- Bilingual frontend and coverage-map docs: durable interaction description.

## Verification

```bash
npm test -- --run src/features/agent/xiaozePopupLayout.test.ts src/features/agent/XiaozePopupView.test.tsx
npm run build
npm run docs:check
playwright-cli -s=xiaoze-launcher open http://127.0.0.1:5180/
```

Real-browser completion covers `1440x900`, `768x1024`, and `390x844`, with snapshot, screenshot, console inspection, and real pointer interactions.

## Documentation Impact Matrix

| Area | Decision | Evidence / path |
| --- | --- | --- |
| Repository maps | Review | `AGENTS.md`, `ARCHITECTURE.md`; no map change expected |
| Planning | Update | this plan; `docs/PLANS.md` on completion |
| Product specs | Review | interaction refinement only; no workflow/domain change expected |
| Architecture | Review | one existing frontend layout seam; no system architecture change expected |
| Quality/testing | Update | `e2e/acceptance/xiaoze-popup-layout.acceptance.spec.ts`; existing requirement/operation IDs retained |
| Reliability/runbooks | No change | no runtime or operational behavior change |
| Security/governance | No change | no auth, approval, audit, or data mutation change |
| Frontend/design | Update | `docs/FRONTEND.md`, `docs/zh-CN/frontend.md`; design tokens unchanged |
| Generated artifacts | No change | no generated contract or schema change |
| References | No change | no external or API reference change |

## Documentation Update Gate

Completed: frontend and coverage truth sources were updated in both languages; repository maps, product specs, architecture, reliability, security, generated artifacts, and references were reviewed and require no change. `npm run docs:check` passed, and no active copy remains.

## Completion Evidence

- Focused Vitest: 24/24 passed.
- Production build passed.
- `XIAOZE-POPUP-MOVE-001`: runtime warmup plus acceptance spec passed, 2/2.
- `playwright-cli` snapshots and screenshots passed at `1440x900`, `768x1024`, and `390x844`; console errors: 0.
- Follow-up defect evidence: the original top-left repro produced `(381,713)` because the launcher was derived from a clamped popup at `(16,16)`. After separating launcher position, the same command reaches the top-left safe inset; acceptance also covers the opposite bottom-right corner and smart popup reattachment.
- Follow-up state-lifetime defect: launcher coordinates were initially written to `localStorage`, which contradicted the required “hold until refresh” behavior. The regression now checks a stable center after the release animation, no launcher-position storage write, and lower-right reset after reload; the launcher controller remains shared across popup mount/unmount and SPA navigation within one page lifetime.
- Follow-up screenshots: `work/ui-checks/xiaoze-launcher-full-coverage/desktop-smart-attachment.png`, `tablet-smart-attachment.png`, and `mobile-fullscreen.png`.
- Screenshots: `work/ui-checks/xiaoze-launcher-coupled/desktop-closed-drag.png`, `desktop-open-coupled-drag.png`, `tablet-open.png`, and `mobile-fullscreen.png`.
