import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { XiaozeChatToggleButton } from "./XiaozeChatToggleButton";
import { readXiaozePopupOpenSession, writeXiaozePopupOpenSession } from "./xiaozePopupOpenState";

const setModalOpen = vi.fn();

vi.mock("./XiaozeToggleHint", () => ({
  XiaozeToggleHint: () => null
}));

vi.mock("@copilotkit/react-core/v2", () => ({
  useCopilotChatConfiguration: () => ({
    isModalOpen: false,
    setModalOpen,
    labels: {
      chatToggleOpenLabel: "打开小泽",
      chatToggleCloseLabel: "关闭小泽"
    }
  })
}));

describe("XiaozeChatToggleButton", () => {
  beforeEach(() => {
    sessionStorage.clear();
    setModalOpen.mockReset();
  });

  it("renders the custom toggle with open label and toggles modal state", () => {
    render(<XiaozeChatToggleButton />);

    const button = screen.getByRole("button", { name: "打开小泽" });
    expect(button).toHaveClass("xiaoze-chat-toggle");
    expect(button).toHaveAttribute("data-state", "closed");

    fireEvent.click(button);
    expect(setModalOpen).toHaveBeenCalledWith(true);
    expect(readXiaozePopupOpenSession()).toBe(true);

    writeXiaozePopupOpenSession(false);
  });
});
