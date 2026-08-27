# Xiaoze Draggable Modeless Popup

> Chinese: [Chinese](../../zh-CN/exec-plans/active/2026-08-27-xiaoze-draggable-modeless-popup.md)

Status: **Active — design approved, implementation not started**  
Date: 2026-08-27  
Owner and final merge approver: Tzrea1 / `@tzrea1-Q`  
Feature branch: `codex/frontend-ui-optimization-20260827`  
Worktree: `/Users/tzrea1/Develop/WiseEff-worktrees/frontend-ui-optimization-20260827`  
Baseline: `origin/main@8b6a2ad2d80e6bdd24af150863ef1c7293039dbe`

## Goal

Turn the opened Xiaoze chat on desktop and tablet into a draggable, modeless companion window. Users can move and resize it while continuing to operate the underlying WiseEff page, retain one safe layout on the current browser, and recover the default layout. The fixed launcher remains discoverable, and the mobile chat remains full screen.

This plan is complete only when pointer, touch, keyboard, persistence, viewport recovery, modeless focus, route continuity, business-modal stacking, approval-card interaction, responsive layout, and accessibility are covered by tests and real-browser evidence.

## Confirmed Product Decisions

The owner approved the recommended answer at every design-tree frontier:

1. Only the **opened chat window** is draggable. The circular Xiaoze launcher remains fixed at the lower-right corner.
2. Desktop and tablet (`>=768px`) support dragging. Mobile (`<768px`) keeps the existing full-screen presentation and has no drag handle.
3. Desktop/tablet Xiaoze becomes **modeless**: the underlying business page remains operable while the chat stays open.
4. The central Xiaoze brand area in the header is the explicit drag handle. Header history, new-chat, reset, and close controls never initiate a drag.
5. The whole window stays within a safe visible viewport inset and does not snap to edges.
6. Clicking the business page does not close Xiaoze. Route changes keep it open and refresh page context.
7. A reset control appears after the layout differs from default; `Home` on the focused drag handle performs the same reset.
8. Business modals cover the modeless Xiaoze window while preserving its state. Xiaoze's own approval card remains above Xiaoze and remains actionable.
9. Position and size use one versioned browser-local layout record. They survive reloads and browser restarts on the same device and are not account-synchronized.
10. Resize moves to the conventional lower-right handle and keeps the upper-left position fixed.
11. Layout coordinates are stored as absolute CSS pixels and re-clamped after viewport or popup-size changes. Mobile full-screen use never overwrites the stored desktop/tablet layout.

## Current-Tree Evidence

- `src/features/agent/XiaozePopupView.tsx` renders the launcher, full-viewport layer, scrim, and dialog. It currently marks the opened popup `aria-modal="true"`, closes on outside pointer input, restores focus, and closes on route changes.
- `src/styles.css` fixes the desktop/tablet layer at `right: 1.5rem; bottom: 6rem`; the launcher is a separate fixed element. Below `768px`, the chat is full screen.
- `src/features/agent/xiaozePopupLayout.ts` owns popup size clamping and the `wiseeff.xiaoze.popup.size.v1` `sessionStorage` record, but has no position model.
- `src/features/agent/useXiaozePopupResize.ts` uses native Pointer Events, pointer capture, and a command-injected upper-left resize handle. `XiaozePopupChrome.tsx` is the existing chrome behavior seam.
- `src/features/agent/XiaozeChatHeader.tsx` has a central brand region between interactive history/new-chat and close controls.
- Popup entrance/exit animation already owns `transform`; drag placement must therefore use `left`/`top` or dedicated CSS variables, never a competing transform.
- Xiaoze approval content portals to `body` and relies on the declared Xiaoze approval layer plus the outside-close exception. `XIAOZE-APPROVAL-CARD-001` is a mandatory regression gate.
- The current coverage maps have no requirement or operation ID for popup movement or modeless page coexistence.

## Success Criteria

- At `1440x900` and `768x1024`, a user can drag Xiaoze from the dedicated header handle with mouse or touch and move it with the keyboard.
- The window never crosses the safe viewport inset after drag, resize, reload, route change, browser resize, or stored-data recovery.
- Clicking and typing in the underlying page leaves Xiaoze open; switching WiseEff routes leaves the same conversation open and updates page context.
- At `390x844`, Xiaoze remains full screen, has no drag/resize handle, and does not overwrite the stored desktop/tablet layout.
- Reloading restores the last committed `{x, y, width, height}` on the same browser. Reset returns to the current default lower-right layout.
- Business modals visually and interactively cover Xiaoze. Xiaoze approval cards remain above Xiaoze and support approve/reject without closing the chat.
- Pointer cancel, lost capture, unmount, route transition, and resize all leave no stuck cursor, selection lock, animation frame, event listener, or body class.
- Pointer, touch, keyboard, reduced-motion, accessibility, visual, responsive, build, documentation, and acceptance gates pass on the exact implementation tree.

## Scope

### In scope

- One deep popup layout model for position and size.
- Versioned local persistence and migration from the current size-only session record.
- Desktop/tablet drag and resize behavior through the existing Xiaoze chrome seam.
- Desktop/tablet modal-to-modeless conversion, focus and close behavior, route continuity, and layer ordering.
- Mobile full-screen preservation.
- Reset-to-default interaction and keyboard movement.
- Unit, component, browser acceptance, visual, responsive, accessibility, and operation-evidence coverage.
- Bilingual frontend/design/quality documentation and correction of the documented Xiaoze layer ladder where it differs from current tokens.

### Out of scope

- Dragging or relocating the circular Xiaoze launcher.
- A draggable mobile chat, edge snapping, magnetic docking, collision avoidance with arbitrary page content, or per-route layouts.
- Cross-device or server-owned layout synchronization.
- Multi-edge/eight-handle resizing.
- Changes to Xiaoze conversation, model, tool, approval, durable provenance, or backend APIs.
- Broad redesign of CopilotKit, business dialogs, toast infrastructure, or the application shell.

## Architecture

### 1. One versioned layout model

Deepen `src/features/agent/xiaozePopupLayout.ts` from size helpers into the sole popup-layout boundary:

```ts
type XiaozePopupLayoutV2 = {
  version: 2;
  x: number;
  y: number;
  width: number;
  height: number;
};
```

The module owns:

- default layout derivation from viewport, existing `24px` right offset, existing `96px` bottom offset, and default `420x680` size;
- the existing `320x420` minimum size;
- a token/grid-aligned safe viewport inset (target `16px`, plus relevant CSS safe-area insets);
- finite-number and schema validation;
- size-first, position-second clamping;
- comparison with the current default for reset-control visibility;
- read, migrate, write, reset, and apply operations;
- desktop/tablet eligibility without deleting layout while mobile is active.

Use a new local key such as `wiseeff.xiaoze.popup.layout.v2`. When no valid v2 layout exists, read the valid v1 session size once, combine it with the default position, write v2, and remove v1 only after the v2 write succeeds. Invalid JSON, non-finite numbers, unsupported versions, impossible geometry, or storage exceptions fall back safely without throwing during render.

Persistence happens only on committed pointer/keyboard/resize/reset operations, not on every pointer move. Cross-account sharing on one browser is intentional and must be documented; no user identifier enters the storage key.

### 2. Full-viewport non-intercepting desktop layer

At `>=768px`, retain a full fixed Xiaoze layer with `pointer-events: none`; only the popup window and its owned interactive descendants receive pointer events. Remove the visible/interactive scrim and outside-click dismissal for this breakpoint. Position the window with `left` and `top` CSS variables inside that layer.

Keep popup entrance/exit animation on the window's existing `transform` track. Drag and resize must not write `transform`. During a gesture, suspend only placement/size transitions and text selection; preserve reduced-motion behavior and the established enter/exit timing tokens.

At `<768px`, retain the current full-screen modal contract. No desktop position or size is applied or persisted there.

### 3. Modeless semantics and lifecycle

For desktop/tablet:

- keep `role="dialog"` and an accessible name, but remove `aria-modal="true"`, the background `inert` contract, the focus trap, and outside-click close behavior;
- opening from the launcher may move focus into Xiaoze; afterwards, normal page and popup focus order coexist;
- close restores focus to the launcher when the launcher still exists and no newer explicit focus target has taken ownership;
- `Escape` closes Xiaoze when focus is within Xiaoze or its owned approval surface, not while the user is editing an unrelated business-page control;
- route changes do not close Xiaoze; existing duplicate route-close effects in `XiaozePopupView.tsx` and `XiaozePopupOpenPolicy.tsx` are removed or replaced by context-refresh behavior;
- opening/closing and conversation state remain distinct from layout persistence.

For mobile, retain the existing modal/full-screen semantics while sharing the corrected route-continuity rule.

### 4. Drag interaction contract

Make the central brand region in `XiaozeChatHeader.tsx` a dedicated, focusable handle with a Chinese accessible name and concise instructions. Do not turn the action groups into drag surfaces.

Pointer behavior:

- primary pointer/button only;
- `touch-action: none` on the handle only;
- use the existing Pointer Events and `setPointerCapture` pattern;
- require a small movement threshold before entering dragging so a click/focus is not misclassified;
- update visual position at most once per animation frame;
- clamp each rendered position and commit once on `pointerup`;
- treat `pointercancel`, lost capture, unmount, breakpoint change, and popup close as complete cleanup paths.

Keyboard behavior on the focused handle:

- Arrow keys move by `8px`;
- `Shift+Arrow` moves by `32px`;
- `Home` restores the default layout;
- every movement is clamped and committed;
- the handle has visible focus, rest, hover, active/grabbing, and disabled states.

### 5. Resize integration

Replace the command-injected upper-left handle with an explicit lower-right resize handle owned by the same chrome/layout controller. The upper-left `{x, y}` remains fixed while width and height change. Clamp size first and then position so the entire window remains reachable. Drag and resize gestures are mutually exclusive and share cleanup code; neither hook may leave independent document-global state.

Prefer an explicit React ref/contract between popup view, header, and chrome over expanding the current body-wide `MutationObserver`. If CopilotKit ownership prevents a direct ref, isolate DOM discovery inside the chrome adapter and keep layout mathematics, gesture state, and persistence framework-independent and unit-testable.

### 6. Layer contract

Reorder declared semantic tokens so ordinary business modals sit above the modeless Xiaoze popup. Do not add raw `z-index` values. Keep:

- the fixed Xiaoze launcher discoverable when the popup is closed;
- Xiaoze's approval overlay/content above the Xiaoze popup and actionable;
- toasts on the repository's declared top notification layer;
- nested business modal behavior within the existing modal contract.

Update both UI-design-system languages to match the actual token ladder rather than copying their currently stale toast-only description.

## State Transitions

| Event | Desktop/tablet result | Mobile result | Persistence |
| --- | --- | --- | --- |
| First open, no stored layout | Default lower-right popup | Full-screen popup | Write only after a committed layout action or migration |
| Pointer/touch drag | Move and clamp | Not available | Commit on end/cancel only when a valid change completed |
| Keyboard move | Move and clamp | Not available | Commit each discrete key action |
| Resize | Lower-right resize and clamp | Not available | Commit on end |
| Reset | Default current-viewport layout | Not shown | Replace stored layout with valid default |
| Browser resize/display change | Re-clamp size then position | Full-screen | Persist the corrected desktop layout only at desktop/tablet |
| Route change | Keep open, preserve layout/conversation, refresh context | Keep open, refresh context | No layout write unless clamp changed it |
| Business modal opens | Xiaoze remains mounted below modal | Existing full-screen/modal arbitration | No write |
| Close and reopen | Restore stored layout | Full-screen | Read and clamp v2 |
| Invalid/legacy storage | Migrate or use safe default | Ignore desktop layout | Never throw or overwrite with invalid data |

## Planned File Changes

| Area | Expected files | Purpose |
| --- | --- | --- |
| Layout model | `src/features/agent/xiaozePopupLayout.ts`, `xiaozePopupLayout.test.ts` | Versioned rect, migration, clamp, defaults, storage |
| Chrome gestures | `src/features/agent/XiaozePopupChrome.tsx`, `useXiaozePopupResize.ts`, new or consolidated drag/layout hook and tests | Pointer, touch, keyboard, resize, cleanup |
| Header/view | `XiaozeChatHeader.tsx`, `XiaozePopupView.tsx`, their tests, `XiaozePopupOpenPolicy.tsx` | Handle/reset UI, modeless semantics, route continuity, focus/close rules |
| Styling | `src/styles.css` | CSS variables, pointer routing, states, breakpoint behavior, semantic z-index order |
| Browser coverage | new `e2e/acceptance/xiaoze-popup-layout.acceptance.spec.ts`; Xiaoze approval, quality visual/responsive/a11y specs and helpers | End-to-end behavior and regressions |
| Coverage governance | bilingual browser-acceptance and operation matrices plus requirements/operation registries | `XIAOZE-POPUP-MOVE-001` coverage and evidence |
| Frontend/design docs | `docs/FRONTEND.md`, `docs/zh-CN/frontend.md`, bilingual UI design system and this plan | Durable interaction and layer contract |

Exact file names for a new hook may change during TDD, but the implementation must retain one layout owner and one gesture-cleanup owner rather than parallel drag and resize subsystems.

## Acceptance and Operation Coverage

Before implementation is considered complete, add:

- requirement ID `XIAOZE-POPUP-MOVE-001`: desktop/tablet users move, resize, reset, reload, change route, and continue operating the underlying page while the popup remains safe and open; mobile remains full screen;
- operation ID `XIAOZE-POPUP-MOVE-001`: P1, Agent domain, automated, representative API-mode route such as `/parameters`, Admin role, assertions `ui` (layout, focus, persistence, page coexistence) with screenshot/trace evidence;
- browser owner `e2e/acceptance/xiaoze-popup-layout.acceptance.spec.ts`;
- regression linkage to `XIAOZE-APPROVAL-CARD-001` in `e2e/acceptance/xiaoze-action.acceptance.spec.ts`.

If the evidence generator requires distinct operations for keyboard/reset or route continuity, split them before implementation rather than overloading one operation record after tests are written.

## Test-Driven Implementation Tasks

### Task 1 — Layout v2 Red -> Green

- Add failing pure tests for defaults, v1 migration, invalid values, four-edge clamping, size-before-position clamping, local storage exceptions, viewport changes, and the mobile no-write rule.
- Implement the versioned layout module without DOM gesture code.
- Preserve the current default/minimum dimensions unless a failing viewport case proves an explicit token change is required.

### Task 2 — Pointer, touch, keyboard, and resize Red -> Green

- Add failing tests for primary-pointer filtering, threshold, capture/release, `pointercancel`, lost capture, interactive-child exclusion, animation-frame cleanup, Arrow/Shift+Arrow/Home, reset visibility, and drag/resize mutual exclusion.
- Implement the explicit brand handle and lower-right resize handle through one chrome controller.
- Verify persistence occurs only at the defined commit points.

### Task 3 — Modeless lifecycle Red -> Green

- Add failing component tests for desktop `role=dialog` without modal/inert background, page click without close, route continuity, page-context update, focus behavior, scoped Escape, business-modal layering, and mobile modal preservation.
- Remove duplicate route-close behavior and desktop scrim interception.
- Retain approval-card portal exceptions and close/focus cleanup.

### Task 4 — Browser acceptance and visual quality

- Register the new requirement and operation IDs before changing their owning spec.
- Automate mouse, touch-equivalent pointer, keyboard, reset, reload, route change, background form interaction, viewport clamp, resize, and approval-card regression paths.
- Extend visual, responsive, and focused accessibility coverage; do not treat the existing a11y exclusion of the popup layer as evidence for the new handle.

### Task 5 — Documentation and final review

- Update all `Update` rows in the Documentation Impact Matrix in both languages.
- Run the exact verification matrix and preserve actual results, skips, warnings, screenshots, traces, and operation evidence.
- Obtain independent Standards and Spec reviews on the final diff. Fix findings or record an owner decision; the implementation agent does not self-approve or self-merge.

## Verification Matrix

Focused development commands:

```bash
npm test -- --run src/features/agent/xiaozePopupLayout.test.ts
npm test -- --run src/features/agent/XiaozePopupView.test.tsx
npm test -- --run src/features/agent/XiaozeChatHeader.test.tsx
```

Add the exact new drag/chrome test path to the focused command once named. Completion gates:

```bash
npm test
npm run ui:check
npm run build
npm run acceptance:browser
npm run acceptance:evidence
npm run docs:check
git diff --check origin/main...HEAD
```

Real-browser verification must use the API-mode local route and `playwright-cli` at:

- `1440x900`: mouse drag to every boundary, keyboard movement/reset, lower-right resize, background form/navigation, route continuity, reload persistence, business modal ordering, approval-card interaction;
- `768x1024`: touch/pointer drag, clamp after resize/orientation-equivalent viewport change, page coexistence, reset;
- `390x844`: full-screen popup, no drag/resize handle, no horizontal overflow, input and approval content reachable, stored desktop layout unchanged.

For each relevant page and viewport, capture `snapshot`, `screenshot`, and `console error`; inspect failed/critical requests and interaction-related network behavior. Store evidence under `work/ui-checks/xiaoze-popup-move/` with deterministic names. The final report must include URL/routes, viewports, interactions, screenshot paths, console/network results, issues found and fixed, acceptance run ID, operation-evidence path, and exact-tree commit.

## Risks and Mitigations

| Risk | Mitigation / stop rule |
| --- | --- |
| Drag transform conflicts with popup motion | Placement uses `left`/`top`; stop if implementation writes drag state into the animated transform. |
| Modeless shell still intercepts page input | Full layer is pointer-transparent; browser test must click/type through outside the window. |
| Global Escape closes Xiaoze while editing the page | Scope Escape to Xiaoze/owned surfaces on desktop; add a page-input regression. |
| Drag starts from header actions | Dedicated brand handle plus threshold; explicit tests for history/new-chat/reset/close. |
| Resize and drag corrupt one another | One layout controller, mutually exclusive gesture state, size-first clamp. |
| Stored data strands the popup off-screen | Validate finite v2 data and clamp on every restore/viewport/size transition. |
| Mobile overwrites desktop layout | No layout writes below `768px`; test breakpoint round trip. |
| Business modal or approval layer becomes unreachable | Token-only layer reorder plus both modal and approval browser regressions. |
| CopilotKit DOM ownership prevents stable refs | Keep a narrow adapter; stop before spreading selectors/MutationObservers across components. |
| Existing ports/worktrees are disturbed | Use this worktree and its allocated frontend port; do not signal or reconfigure unrelated listeners. |
| Scope expands into Agent/server behavior | Stop and create a separate owner decision; this plan changes no Xiaoze backend contract. |

## Documentation Impact Matrix

| Area | Status | Exact paths and required evidence |
| --- | --- | --- |
| Repository maps and agent guidance | Review | `AGENTS.md`, `ARCHITECTURE.md`, `docs/README.md`; record unchanged unless routing becomes stale. |
| Planning and technical debt | Update | This bilingual plan; `docs/PLANS.md`; `docs/zh-CN/PLANS.md`. Review `docs/exec-plans/tech-debt-tracker.md` and add a row only for accepted residual work. |
| Product specs | Review | `docs/product-specs/index.md`, `docs/product-specs/product-spec.md`, `docs/product-specs/prototype-functional-spec.md`; update only if Xiaoze product behavior is specified there. |
| Architecture and domain model | Review | `docs/design-docs/full-stack-architecture.md`, `docs/design-docs/domain-model.md`; no server/domain change expected. |
| API/contracts/generated artifacts/references | No change | `docs/api/`, `server/modules/contracts/`, `docs/generated/`, `docs/references/`; layout is browser-local and adds no API/schema. |
| Security/governance | Review | `docs/SECURITY.md`; confirm no approval, auth, audit, or trusted-provenance semantics changed. |
| Reliability/runbooks | Review | `docs/RELIABILITY.md`, `docs/runbooks/manual-acceptance.md` and Chinese companion; update manual Xiaoze UI acceptance steps. |
| Quality/testing | Update | `docs/developer/browser-acceptance-coverage-map.md`, `docs/developer/user-operation-coverage-matrix.md`, Chinese companions, requirements and operation registries, relevant acceptance/quality specs. |
| Frontend/design | Update | `docs/FRONTEND.md`, `docs/zh-CN/frontend.md`, bilingual `ui-design-system.md`; document modeless/drag/layout/layer contracts and correct the z-index ladder. |
| Environment/deployment | No change | `.env.example`, `docs/developer/environment-variables.md`, `ops/self-hosted/`; no runtime variable or deployment change. |

## Documentation Update Gate

- [ ] Every `Update` row is changed in English and Chinese where a companion exists.
- [ ] Every `Review` row records the exact review result; any deferred corrective work is added to the technical-debt tracker.
- [ ] `XIAOZE-POPUP-MOVE-001` exists in requirement and operation sources of truth before completion.
- [ ] Manual acceptance documents explain desktop/tablet modeless behavior and mobile full-screen behavior.
- [ ] Frontend/design docs describe layout persistence, keyboard/reset behavior, route continuity, business-modal ordering, and Xiaoze approval ordering.
- [ ] Real-browser and operation evidence are linked from the completion record.
- [ ] `npm run docs:check` passes on the final exact tree.
- [ ] Only after implementation, verification, reviews, and the gate above pass may this plan move to `completed/` in both language trees.

## Git & PR Workflow

Implementation stays on `codex/frontend-ui-optimization-20260827` in the isolated worktree named above. Before product-code edits, fetch `origin/main`, disclose divergence, and integrate current `main` using the repository-approved non-destructive workflow; never touch or clean the original `/Users/tzrea1/Develop/WiseEff` worktree.

An implementation subagent may edit, test, and commit only on this feature branch. It must not push to `main`, create or merge a GitHub PR, or synchronize local `main`. The parent/session owner reviews the exact diff and evidence, creates the PR, waits for required CI, merges only after approval, and then synchronizes local `main`. Existing unrelated worktree changes and services are out of scope.

## Completion Record

Not yet implemented. No product code, acceptance registry, or runtime behavior has changed as part of this planning pass. Local plan validation does not constitute browser, Hosted CI, target-device, or release evidence.
