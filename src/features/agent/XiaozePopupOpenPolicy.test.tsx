import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { XiaozePopupOpenPolicy } from "./XiaozePopupOpenPolicy";

const setModalOpen = vi.fn();
let pagePath = "/parameters";

vi.mock("@copilotkit/react-core/v2", () => ({
  useCopilotChatConfiguration: () => ({
    isModalOpen: true,
    setModalOpen
  })
}));

vi.mock("./xiaozePageContext", () => ({
  useXiaozePageContextValue: () => ({ path: pagePath, pageKey: "parameters" })
}));

describe("XiaozePopupOpenPolicy", () => {
  beforeEach(() => {
    sessionStorage.clear();
    pagePath = "/parameters";
    setModalOpen.mockReset();
  });

  it("closes the outer modal scope on first mount", () => {
    render(<XiaozePopupOpenPolicy />);

    expect(setModalOpen).toHaveBeenCalledWith(false);
  });

  it("closes the outer modal scope when the page path changes", () => {
    const { rerender } = render(<XiaozePopupOpenPolicy />);
    setModalOpen.mockClear();
    pagePath = "/debugging";

    rerender(<XiaozePopupOpenPolicy />);

    expect(setModalOpen).toHaveBeenCalledWith(false);
  });
});
