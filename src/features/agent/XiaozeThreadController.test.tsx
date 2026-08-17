import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { XiaozeThreadController } from "./XiaozeThreadController";
import { resetXiaozeThreadStoreForTests, XiaozeThreadProvider, useXiaozeThreads } from "./XiaozeThreadContext";

const agent = {
  messages: [] as unknown[],
  setMessages: vi.fn((next: unknown[]) => {
    agent.messages = next;
  }),
  pendingInterrupts: [] as Array<{ id: string }>,
  abortRun: vi.fn()
};

vi.mock("@copilotkit/react-core/v2", () => ({
  UseAgentUpdate: {
    OnMessagesChanged: "OnMessagesChanged"
  },
  useAgent: () => ({ agent })
}));

vi.mock("./XiaozePromptDebugContext", () => ({
  clearXiaozePromptDebugStore: vi.fn()
}));

function NewThreadButton() {
  const { createNewThread } = useXiaozeThreads();
  return (
    <button type="button" onClick={() => createNewThread(agent.messages as never)}>
      新对话
    </button>
  );
}

function SelectThreadButton({ threadId }: { threadId: string }) {
  const { selectThread } = useXiaozeThreads();
  return (
    <button type="button" onClick={() => selectThread(threadId, agent.messages as never)}>
      切换线程
    </button>
  );
}

async function renderController(extra: ReactNode) {
  const view = render(
    <XiaozeThreadProvider>
      <XiaozeThreadController />
      {extra}
    </XiaozeThreadProvider>
  );
  await waitFor(() => expect(agent.setMessages).toHaveBeenCalled());
  agent.pendingInterrupts = [{ id: "approval-stale" }];
  agent.abortRun.mockClear();
  return view;
}

describe("XiaozeThreadController", () => {
  beforeEach(() => {
    agent.messages = [];
    agent.pendingInterrupts = [];
    agent.setMessages.mockClear();
    agent.abortRun.mockClear();
    resetXiaozeThreadStoreForTests({
      activeThreadId: "thread-active",
      threads: [
        {
          id: "thread-active",
          title: "当前对话",
          preview: "待批准",
          createdAt: "2026-08-17T00:00:00.000Z",
          updatedAt: "2026-08-17T00:00:00.000Z",
          messages: [{ id: "m1", role: "user", content: "set pd-1 to <3100>" }]
        },
        {
          id: "thread-other",
          title: "另一段对话",
          preview: "你好",
          createdAt: "2026-08-16T00:00:00.000Z",
          updatedAt: "2026-08-16T00:00:00.000Z",
          messages: [{ id: "m2", role: "user", content: "你好" }]
        }
      ]
    });
  });

  it("clears CopilotKit pending interrupts when starting a new thread", async () => {
    const { getByRole } = await renderController(<NewThreadButton />);

    getByRole("button", { name: "新对话" }).click();

    await waitFor(() => {
      expect(agent.pendingInterrupts).toEqual([]);
    });
    expect(agent.abortRun).toHaveBeenCalled();
    expect(agent.setMessages).toHaveBeenCalledWith([]);
  });

  it("clears CopilotKit pending interrupts when selecting another thread", async () => {
    const { getByRole } = await renderController(<SelectThreadButton threadId="thread-other" />);

    getByRole("button", { name: "切换线程" }).click();

    await waitFor(() => {
      expect(agent.pendingInterrupts).toEqual([]);
    });
    expect(agent.abortRun).toHaveBeenCalled();
  });
});
