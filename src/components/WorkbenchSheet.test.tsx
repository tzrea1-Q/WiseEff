import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkbenchSheet } from "./WorkbenchSheet";

afterEach(() => {
  cleanup();
  document.body.style.overflow = "";
});

describe("WorkbenchSheet", () => {
  it("renders no content when closed", () => {
    render(
      <WorkbenchSheet open={false} onClose={() => {}} title="参数草稿">
        草稿内容
      </WorkbenchSheet>
    );

    expect(screen.queryByText("草稿内容")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders title and content in a named dialog when open", () => {
    render(
      <WorkbenchSheet open onClose={() => {}} title="参数草稿">
        草稿内容
      </WorkbenchSheet>
    );

    expect(screen.getByRole("dialog", { name: "参数草稿" })).toBeInTheDocument();
    expect(screen.getByText("参数草稿")).toBeInTheDocument();
    expect(screen.getByText("草稿内容")).toBeInTheDocument();
  });

  it("calls onClose when the close button is clicked", () => {
    const onClose = vi.fn();
    render(
      <WorkbenchSheet open onClose={onClose} title="参数草稿">
        草稿内容
      </WorkbenchSheet>
    );

    fireEvent.click(screen.getByRole("button", { name: "关闭草稿" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when Escape is pressed on document", () => {
    const onClose = vi.fn();
    render(
      <WorkbenchSheet open onClose={onClose} title="参数草稿">
        草稿内容
      </WorkbenchSheet>
    );

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders the footer slot at the bottom", () => {
    render(
      <WorkbenchSheet
        open
        onClose={() => {}}
        title="参数草稿"
        footer={<button type="button">保存草稿</button>}
      >
        草稿内容
      </WorkbenchSheet>
    );

    const sheet = screen.getByRole("dialog", { name: "参数草稿" });
    const footer = sheet.querySelector(".workbench-sheet-foot");

    expect(footer).toContainElement(screen.getByRole("button", { name: "保存草稿" }));
    expect(sheet.lastElementChild).toBe(footer);
  });

  it("locks body scrolling while open and restores it on close", () => {
    document.body.style.overflow = "auto";
    const { rerender, unmount } = render(
      <WorkbenchSheet open onClose={() => {}} title="参数草稿">
        草稿内容
      </WorkbenchSheet>
    );

    expect(document.body.style.overflow).toBe("hidden");

    rerender(
      <WorkbenchSheet open={false} onClose={() => {}} title="参数草稿">
        草稿内容
      </WorkbenchSheet>
    );

    expect(document.body.style.overflow).toBe("auto");

    render(
      <WorkbenchSheet open onClose={() => {}} title="另一个草稿">
        另一个内容
      </WorkbenchSheet>
    );

    expect(document.body.style.overflow).toBe("hidden");

    unmount();
    cleanup();

    expect(document.body.style.overflow).toBe("auto");
  });

  it("focuses the close button when opened", () => {
    render(
      <WorkbenchSheet open onClose={() => {}} title="参数草稿">
        草稿内容
      </WorkbenchSheet>
    );

    expect(screen.getByRole("button", { name: "关闭草稿" })).toHaveFocus();
  });
});
