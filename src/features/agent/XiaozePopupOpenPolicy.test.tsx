import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { XiaozePopupOpenPolicy } from "./XiaozePopupOpenPolicy";

const setModalOpen = vi.fn();

vi.mock("@copilotkit/react-core/v2", () => ({
  useCopilotChatConfiguration: () => ({
    isModalOpen: true,
    setModalOpen
  })
}));

describe("XiaozePopupOpenPolicy", () => {
  beforeEach(() => {
    sessionStorage.clear();
    setModalOpen.mockReset();
  });

  it("closes the outer modal scope on first mount", () => {
    render(<XiaozePopupOpenPolicy />);

    expect(setModalOpen).toHaveBeenCalledTimes(1);
    expect(setModalOpen).toHaveBeenCalledWith(false);
  });

  it("does not close the popup again when its provider rerenders", () => {
    const { rerender } = render(<XiaozePopupOpenPolicy />);
    setModalOpen.mockClear();

    rerender(<XiaozePopupOpenPolicy />);

    expect(setModalOpen).not.toHaveBeenCalled();
  });
});
