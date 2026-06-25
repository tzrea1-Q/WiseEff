# Xiaoze Turn State UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix tool-call turn UX (e.g. “aurora 项目里和 charge 相关的参数有哪些？”) so each turn renders as user → phase strip → single complete answer, with dev tooling outside the conversation flow.

**Architecture:** Introduce `xiaoze_turn_state` as the single live UI contract (phase, steps, authoritative answer). CopilotKit `messages[]` remains for persistence/history only. Phase A stops bleeding (dev panels, partial markdown). Phase B wires backend state machine. Phase C polishes UI and removes heuristic merge paths.

**Tech Stack:** AG-UI SSE, CopilotKit v2, Vitest, playwright-cli

**Verification:** After each task group, run targeted tests + `playwright-cli` snapshot on `/debugging?project=aurora` at 1440×900.

---

## Target UX

```
[User bubble]
[Phase strip — live during run, compact after done]
  ① 理解问题 → ② 搜索参数定义 ✓ → ③ 生成回答
[Assistant — ONE markdown block when phase=done or composing with complete table]
[Dev-only: header drawer — 完整提示词 + 模型推理]
```

---

## File Map

| File | Responsibility |
|------|----------------|
| `server/modules/agent/xiaoze/xiaozeTurnState.ts` | Turn state types, tracker, CUSTOM event builder |
| `server/modules/agent/xiaoze/agUiEndpoint.ts` | Emit turn state during pump + finalize |
| `src/features/agent/xiaozeTurnStateTypes.ts` | Frontend mirror types |
| `src/features/agent/XiaozeTurnStateContext.tsx` | Live turn state store |
| `src/features/agent/XiaozeTurnStateCapture.tsx` | agent.subscribe → store |
| `src/features/agent/XiaozeTurnBlock.tsx` | Render from turn state |
| `src/features/agent/XiaozeDevToolsDrawer.tsx` | Prompt debug + reasoning (header) |
| `src/features/agent/XiaozeChatHeader.tsx` | Host dev drawer |
| `src/features/agent/XiaozeUserMessage.tsx` | User bubble only |
| `src/features/agent/xiaozeTurnGrouping.ts` | History grouping; simplified answer resolve |

---

## Phase A — Stop the bleeding

### Task A1: User message has no dev panels

**Files:**
- Modify: `src/features/agent/XiaozeUserMessage.tsx`
- Test: `src/features/agent/XiaozeUserMessage.test.tsx` (create)

- [ ] **Step 1: Write failing test**

```tsx
it("does not render prompt debug inside the user message block", () => {
  vi.mocked(xiaozePromptDebugEnabled).mockReturnValue(true);
  render(<XiaozeUserMessage message={{ id: "u1", role: "user", content: "hello" }} />);
  expect(screen.queryByRole("button", { name: "完整提示词" })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run test — expect FAIL**
- [ ] **Step 3: Remove prompt debug from XiaozeUserMessage**
- [ ] **Step 4: Run test — expect PASS**
- [ ] **Step 5: Browser check** — user bubble only, no “完整提示词” under question

### Task A2: Dev tools in chat header drawer

**Files:**
- Create: `src/features/agent/XiaozeDevToolsDrawer.tsx`
- Modify: `src/features/agent/XiaozeChatHeader.tsx`
- Test: `src/features/agent/XiaozeDevToolsDrawer.test.tsx`

- [ ] **Step 1: Failing test** — drawer collapsed by default, expands to show latest prompt debug
- [ ] **Step 2–4: Implement drawer + wire header**
- [ ] **Step 5: Browser check** — “开发者” in header, not in message list

### Task A3: Defer partial answer during tool runs

**Files:**
- Modify: `src/features/agent/xiaozeTurnGrouping.ts`
- Test: `src/features/agent/xiaozeTurnGrouping.test.ts`

- [ ] **Step 1: Failing test** — `shouldDeferTurnAnswer` true when active + tool steps running + no turnReply
- [ ] **Step 2–4: Implement + use in XiaozeTurnBlock**
- [ ] **Step 5: Remove dev reasoning block from TurnBlock**
- [ ] **Step 6: Browser check** — no half table during tool run; answer appears once at end

---

## Phase B — Turn state contract

### Task B1: Backend turn state types + tracker

**Files:**
- Create: `server/modules/agent/xiaoze/xiaozeTurnState.ts`
- Test: `server/modules/agent/xiaoze/xiaozeTurnState.test.ts`

- [ ] **Step 1: Failing tests** for phase transitions: thinking → tool → composing → done
- [ ] **Step 2–4: Implement `XiaozeTurnStateTracker`**

### Task B2: Emit turn state from agUiEndpoint

**Files:**
- Modify: `server/modules/agent/xiaoze/agUiEndpoint.ts`
- Test: `server/modules/agent/xiaoze/agUiEndpoint.test.ts`

- [ ] **Step 1: Failing test** — tool run emits `xiaoze_turn_state` with phase sequence
- [ ] **Step 2–4: Wire tracker in `yieldMappedSinkEvents` + `finalizeTurnReply`**
- [ ] **Step 5: Keep `xiaoze_turn_reply` as alias at done for one release**

### Task B3: Frontend turn state capture

**Files:**
- Create: `src/features/agent/xiaozeTurnStateTypes.ts`
- Create: `src/features/agent/XiaozeTurnStateContext.tsx`
- Create: `src/features/agent/XiaozeTurnStateCapture.tsx`
- Modify: `src/features/agent/XiaozeProvider.tsx`
- Test: `src/features/agent/xiaozeTurnState.test.ts`

- [ ] **Step 1: Failing tests** for reducer: set state by messageId, clear on RUN_STARTED
- [ ] **Step 2–4: Implement capture + provider**
- [ ] **Step 5: Browser check** — phase strip updates live during tool run

---

## Phase C — Polish and simplify

### Task C1: TurnBlock reads turn state first

**Files:**
- Modify: `src/features/agent/XiaozeTurnBlock.tsx`
- Modify: `src/features/agent/XiaozeTurnTimeline.tsx` (phase strip variant)
- Test: `src/features/agent/XiaozeReasoningMessage.test.tsx` (extend)

- [ ] **Step 1: Tests** — phase strip shows “搜索参数定义”; answer from `turnState.text` when done
- [ ] **Step 2–4: Implement phase strip component `XiaozeTurnPhaseStrip`**
- [ ] **Step 5: Simplify `resolveTurnAnswerText`** — prefer turn state text when phase=done

### Task C2: Remove redundant captures (optional deprecation)

- [ ] Merge `XiaozeTurnReplyCapture` into turn state capture or make reply a shim
- [ ] Document env flags in `docs/FRONTEND.md` § Xiaoze dev tools

### Task C3: Full browser acceptance

- [ ] `playwright-cli` on `/debugging?project=aurora`
- [ ] Ask charge question; verify 1440×900, 768×1024, 390×844
- [ ] snapshot + screenshot + console error check

---

## Documentation Impact Matrix

| Doc | Update |
|-----|--------|
| `docs/FRONTEND.md` | Xiaoze turn UX + dev drawer |
| `docs/zh-CN/frontend.md` | Mirror |
| `docs/developer/browser-acceptance-coverage-map.md` | Xiaoze tool-turn scenario |

---

## Success Criteria

1. One user-facing answer per tool turn, no duplicate or truncated table
2. Live phase strip during run; compact summary after done
3. No “完整提示词” or “调试：模型推理” in message flow
4. All new tests pass; `npm run build` succeeds
5. playwright-cli evidence recorded under `work/ui-checks/`
