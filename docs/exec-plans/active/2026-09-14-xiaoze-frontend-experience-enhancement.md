# Xiaoze Frontend Experience Enhancement

> Chinese: [Chinese](../../zh-CN/exec-plans/active/2026-09-14-xiaoze-frontend-experience-enhancement.md)
> Status: **Active implementation**
> Date: 2026-09-14. Branch: `feat/xiaoze-frontend-experience`

## Goal and Context

Enhance the frontend implementation of the Xiaoze AI assistant companion across Design System token compliance, dark mode accessibility, animation rendering performance, code block usability, stream reasoning stability, starter prompts, and contextual handoff from business pages.

## Git & PR Workflow

- **Scratch feature branch**: `feat/xiaoze-frontend-experience` branched from `main`.
- **Stop boundary**: Implement all 5 optimization tiers, pass unit tests and build, verify across 3 viewports with `playwright-cli`, and run `npm run docs:check`.

## Proposed Work Packages

- **XZ-01 (Design System & Dark Mode Compliance)**:
  - Replace hardcoded color literals in `src/styles.css` with semantic tokens (`--surface`, `--text`, `--accent`, `color-mix()`).
  - Add `:focus-within` on `.copilotKitPopup .copilotKitInput` to restore the required focus indicator ring (`var(--ring)`).
  - Standardize `KnowledgeDraftApprovalContent` in `src/features/agent/XiaozeApprovalCardContent.tsx` to Chinese-first actions (`拒绝` / `批准`).
- **XZ-02 (Animation & Motion Performance)**:
  - Remove `filter: blur(10px)` and `will-change: filter` from `.xiaoze-popup-window`.
  - Refine floating button halo animation from infinite looping to a gentle 2-cycle pulse.
- **XZ-03 (AI Content & Streamdown Enhancements)**:
  - Add custom code block component in `src/features/agent/xiaozeStreamdownComponents.tsx` supporting language tag badges and an interactive "复制" (Copy) button with checkmark feedback.
  - Smooth out reasoning collapse transitions in `src/features/agent/XiaozeTurnReasoningPanel.tsx` to prevent abrupt Cumulative Layout Shift (CLS).
  - Add interactive starter prompt pills in `src/features/agent/XiaozeWelcomePanel.tsx`.
- **XZ-04 (Context Handoff & Proactive Insights)**:
  - Extend `dispatchXiaozeOpenHandoff` and `XiaozeOpenHandoffListener` to inject query/preset text into the chat textarea and focus on handoff.
  - Connect `useXiaozeSuggestions` "问小泽" action to `dispatchXiaozeOpenHandoff`.
- **XZ-05 (Usability & Shortcuts)**:
  - Auto-focus chat textarea on popup open.
  - Add `⌘J` / `Ctrl+J` global shortcut to toggle Xiaoze window.

## Documentation Impact Matrix

| Area | Path | Status | Impact / Note |
| --- | --- | --- | --- |
| Architecture | `ARCHITECTURE.md` | No change | Architecture seams and agent protocol remain unchanged |
| Product spec | `docs/product-specs/` | No change | Product capabilities preserved |
| Design docs | `docs/design-docs/ui-design-system.md` | Review | Verify Xiaoze token alignment with UI Design System |
| Frontend | `docs/FRONTEND.md` | Review | Xiaoze component conventions |
| Active plans | `docs/exec-plans/active/2026-09-14-xiaoze-frontend-experience-enhancement.md` | Update | This active execution plan |
| Chinese active plans | `docs/zh-CN/exec-plans/active/2026-09-14-xiaoze-frontend-experience-enhancement.md` | Update | Chinese companion page |

## Documentation Update Gate

- [x] Active execution plan and Chinese counterpart created and linked.
- [x] UI Design System tokens and rules respected.
- [x] `npm run docs:check` passes.

## Verification Plan

- Unit tests: `npm test src/features/agent/`
- Build check: `npm run build`
- Documentation check: `npm run docs:check`
- Playwright-cli visual verification: Desktop `1440x900`, tablet `768x1024`, mobile `390x844`.
