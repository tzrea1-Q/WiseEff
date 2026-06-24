import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { XiaozeThreadHistoryPanel } from "./XiaozeThreadHistoryPanel";
import { resetXiaozeThreadStoreForTests, XiaozeThreadProvider } from "./XiaozeThreadContext";
import type { XiaozeThreadRecord } from "./xiaozeThreadTypes";

function renderPanel(options?: {
  threads?: XiaozeThreadRecord[];
  activeThreadId?: string;
  onDeleteThread?: (threadId: string) => void;
}) {
  const thread: XiaozeThreadRecord = {
    id: "thread-1",
    title: "charge 参数",
    preview: "相关参数有…",
    createdAt: "2026-06-24T08:00:00.000Z",
    updatedAt: "2026-06-24T08:05:00.000Z",
    messages: [{ id: "m1", role: "user", content: "charge 参数有哪些？" }]
  };

  resetXiaozeThreadStoreForTests({
    activeThreadId: options?.activeThreadId ?? "thread-1",
    threads: options?.threads ?? [thread]
  });

  const onDeleteThread = options?.onDeleteThread ?? vi.fn();

  render(
    <XiaozeThreadProvider>
      <XiaozeThreadHistoryPanel
        activeThreadId={options?.activeThreadId ?? "thread-1"}
        onSelectThread={vi.fn()}
        onDeleteThread={onDeleteThread}
      />
    </XiaozeThreadProvider>
  );

  return { onDeleteThread, thread };
}

describe("XiaozeThreadHistoryPanel", () => {
  it("renders delete control for each historical thread", () => {
    renderPanel();
    expect(screen.getByTestId("xiaoze-thread-delete-thread-1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "删除对话：charge 参数" })).toBeInTheDocument();
  });

  it("invokes delete handler without selecting the thread", async () => {
    const user = userEvent.setup();
    const onDeleteThread = vi.fn();
    renderPanel({ onDeleteThread });

    await user.click(screen.getByTestId("xiaoze-thread-delete-thread-1"));

    expect(onDeleteThread).toHaveBeenCalledWith("thread-1");
  });
});
