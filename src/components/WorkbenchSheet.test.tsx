import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { StrictMode, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ParameterDraftDialog } from "./ParameterDraftDialog";
import { WorkbenchSheet } from "./WorkbenchSheet";
import { ConfirmDialog } from "./common/ConfirmDialog";

afterEach(() => {
  cleanup();
  document.body.style.overflow = "";
});

describe("WorkbenchSheet", () => {
  it("preserves the trigger through StrictMode effect replay and repeated click opens", async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return <>
        <button type="button" onClick={(event) => {
          event.currentTarget.focus();
          setOpen(true);
        }}>编辑节点</button>
        {open ? <WorkbenchSheet open onClose={() => setOpen(false)} title="节点详情">内容</WorkbenchSheet> : null}
      </>;
    }
    render(<StrictMode><Harness /></StrictMode>);
    const trigger = screen.getByRole("button", { name: "编辑节点" });
    for (let index = 0; index < 2; index += 1) {
      fireEvent.click(trigger);
      const close = screen.getByRole("button", { name: "关闭草稿" });
      await waitFor(() => expect(close).toHaveFocus());
      fireEvent.click(close);
      await waitFor(() => expect(trigger).toHaveFocus());
    }
  });

  it("returns focus to its trigger after closing", async () => {
    const trigger = document.createElement("button");
    document.body.append(trigger);
    trigger.focus();
    const { rerender } = render(<WorkbenchSheet open onClose={() => {}} title="节点详情">内容</WorkbenchSheet>);
    expect(screen.getByRole("button", { name: "关闭草稿" })).toHaveFocus();
    rerender(<WorkbenchSheet open={false} onClose={() => {}} title="节点详情">内容</WorkbenchSheet>);
    await waitFor(() => expect(trigger).toHaveFocus());
    trigger.remove();
  });

  it("keeps focus in a replacement editor and returns to its own trigger", async () => {
    const first = document.createElement("button");
    const second = document.createElement("button");
    document.body.append(first, second);
    first.focus();
    const { rerender } = render(<StrictMode><WorkbenchSheet key="first" open onClose={() => {}} title="第一个节点">内容</WorkbenchSheet></StrictMode>);
    second.focus();
    rerender(<StrictMode><WorkbenchSheet key="second" open onClose={() => {}} title="第二个节点">内容</WorkbenchSheet></StrictMode>);
    await waitFor(() => expect(screen.getByRole("button", { name: "关闭草稿" })).toHaveFocus());
    rerender(<StrictMode><WorkbenchSheet key="second" open={false} onClose={() => {}} title="第二个节点">内容</WorkbenchSheet></StrictMode>);
    await waitFor(() => expect(second).toHaveFocus());
    first.remove();
    second.remove();
  });

  it("lets the confirmation above it handle Escape without closing the sheet", () => {
    const close = vi.fn();
    const cancel = vi.fn();
    render(<>
      <WorkbenchSheet open onClose={close} title="节点详情">内容</WorkbenchSheet>
      <ConfirmDialog open title="放弃修改？" description="修改尚未保存" confirmLabel="放弃" onConfirm={() => {}} onCancel={cancel} />
    </>);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(cancel).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();
  });

  it("does not consume Escape from a different non-modal dialog", () => {
    const close = vi.fn();
    render(<>
      <WorkbenchSheet open onClose={close} title="节点详情">内容</WorkbenchSheet>
      <div role="dialog" aria-label="助手"><input aria-label="助手输入" /></div>
    </>);
    fireEvent.keyDown(screen.getByRole("textbox", { name: "助手输入" }), { key: "Escape" });
    expect(close).not.toHaveBeenCalled();
  });

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

  it("renders an optional description below the title", () => {
    render(
      <WorkbenchSheet open onClose={() => {}} title="参数草稿" description="提交前可逐项调整目标值和原因。">
        草稿内容
      </WorkbenchSheet>
    );

    expect(screen.getByRole("dialog", { name: "参数草稿" })).toBeInTheDocument();
    expect(screen.getByText("提交前可逐项调整目标值和原因。")).toBeInTheDocument();
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

  it("keeps body scrolling locked until all overlapping modals close", () => {
    document.body.style.overflow = "auto";

    const draftProps: ComponentProps<typeof ParameterDraftDialog> = {
      open: true,
      title: "修改草稿",
      drafts: [],
      focusedParameterId: null,
      canEdit: true,
      onClose: () => {},
      onClearAll: () => {},
      onRemoveItem: () => {},
      onUpdateDraft: () => {},
      onSubmit: () => {},
      onViewSubmissions: () => {}
    };

    const { rerender } = render(
      <>
        <WorkbenchSheet open onClose={() => {}} title="参数草稿">
          草稿内容
        </WorkbenchSheet>
        <ParameterDraftDialog {...draftProps} />
      </>
    );

    expect(document.body.style.overflow).toBe("hidden");

    rerender(
      <>
        <WorkbenchSheet open={false} onClose={() => {}} title="参数草稿">
          草稿内容
        </WorkbenchSheet>
        <ParameterDraftDialog {...draftProps} />
      </>
    );

    expect(document.body.style.overflow).toBe("hidden");
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
