import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DtsBindingCompareDialog } from "./DtsBindingCompareDialog";
import type { BindingComparePeer } from "@/domain/parameter-topology/bindingProjectComparison";

const peers: BindingComparePeer[] = [
  {
    projectId: "proj-aurora",
    projectName: "Aurora 量产平台",
    rawValue: "<3590>"
  },
  {
    projectId: "proj-nebula",
    projectName: "Nebula 高频调试项目",
    rawValue: "<3500>"
  }
];

function renderCompare(
  overrides: Partial<React.ComponentProps<typeof DtsBindingCompareDialog>> = {}
) {
  const onClose = vi.fn();
  const onUseCompareAsDraft = vi.fn();
  const view = render(
    <DtsBindingCompareDialog
      propertyKey="gpio_int"
      baseProjectId="proj-source"
      baseProjectName="当前项目"
      baseRawValue="<3590>"
      peers={peers}
      canEdit
      onClose={onClose}
      onUseCompareAsDraft={onUseCompareAsDraft}
      {...overrides}
    />
  );
  return { ...view, onClose, onUseCompareAsDraft };
}

describe("DtsBindingCompareDialog", () => {
  it("shows a single selection prompt in embedded details before offering a draft action", () => {
    renderCompare({ embedded: true });
    expect(screen.getByRole("combobox", { name: "对比目标配置实例" })).toBeInTheDocument();
    expect(screen.queryByText("请选择要比较的配置实例")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "使用该项目配置加入草稿" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Nebula 高频调试项目/ }));
    expect(screen.getByRole("button", { name: "使用该项目配置加入草稿" })).toBeEnabled();
  });
  it("renders as a ModalDialog card named and described from the title, not the backdrop", () => {
    renderCompare();

    const dialog = screen.getByRole("dialog", { name: "gpio_int 跨项目对比" });
    expect(dialog).toHaveClass("dts-binding-compare-dialog");
    expect(dialog.parentElement).toHaveClass("modal-backdrop", "dts-binding-compare-dialog__overlay");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleDescription(
      "选择要比较的配置实例，查看与当前项目的参数差异，并可将其配置加入草稿。"
    );
    expect(dialog.querySelector(".dts-binding-compare-dialog__content")).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "关闭跨项目对比" })).toBeInTheDocument();
  });

  it("focuses the target project select on open and dismisses on Escape or paired backdrop press", () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <div>
          <button type="button" onClick={() => setOpen(true)}>打开对比</button>
          {open ? (
            <DtsBindingCompareDialog
              propertyKey="gpio_int"
              baseProjectId="proj-source"
              baseProjectName="当前项目"
              baseRawValue="<3590>"
              peers={peers}
              canEdit={false}
              onClose={() => setOpen(false)}
            />
          ) : null}
        </div>
      );
    }

    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "打开对比" });
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "gpio_int 跨项目对比" });
    expect(within(dialog).getByLabelText("对比目标配置实例")).toHaveFocus();

    const last = within(dialog).getByRole("button", { name: "关闭" });
    const first = within(dialog).getByRole("button", { name: "关闭跨项目对比" });
    last.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(first);
    first.focus();
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);

    const backdrop = dialog.parentElement!;
    fireEvent.pointerDown(dialog);
    fireEvent.pointerUp(backdrop);
    expect(screen.getByRole("dialog", { name: "gpio_int 跨项目对比" })).toBeInTheDocument();

    fireEvent.pointerDown(backdrop);
    fireEvent.pointerUp(backdrop);
    expect(screen.queryByRole("dialog", { name: "gpio_int 跨项目对比" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();

    fireEvent.click(trigger);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "gpio_int 跨项目对比" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("lets the user pick a peer and seed a draft from that project", () => {
    const { onUseCompareAsDraft } = renderCompare();

    const compare = screen.getByRole("dialog", { name: "gpio_int 跨项目对比" });
    expect(within(compare).getByLabelText("对比目标配置实例")).toHaveAttribute("data-value", "");
    expect(within(compare).getAllByText("请选择要比较的配置实例")).toHaveLength(1);

    const overview = within(compare).getByRole("list", { name: "跨项目对比" });
    const entries = within(overview).getAllByRole("listitem").filter((item) => item.hasAttribute("data-kind"));
    fireEvent.click(within(entries[1]!).getByRole("button", { name: /Nebula 高频调试项目/ }));
    expect(within(compare).getByLabelText("对比目标配置实例")).toHaveAttribute("data-value", "proj-nebula");

    fireEvent.click(within(compare).getByRole("button", { name: "使用该项目配置加入草稿" }));
    expect(onUseCompareAsDraft).toHaveBeenCalledWith({
      rawValue: "<3500>",
      reason: "参考 Nebula 高频调试项目 当前配置生成草稿"
    });
  });

  it("hides the draft action for read-only users", () => {
    renderCompare({ canEdit: false, onUseCompareAsDraft: vi.fn() });

    expect(screen.getByRole("button", { name: "使用该项目配置加入草稿" })).toBeDisabled();
  });

  it("reports no comparable instance only when the compare response is empty", () => {
    renderCompare({ peers: [] });

    const compare = screen.getByRole("dialog", { name: "gpio_int 跨项目对比" });
    expect(within(compare).getAllByText("暂无可比较实例")).toHaveLength(1);
    expect(within(compare).queryByText("请选择要比较的配置实例")).not.toBeInTheDocument();
  });

  it("shows both exact revisions when the selected target has a pinned/effective mismatch", () => {
    renderCompare({
      peers: [
        {
          bindingId: "binding-nebula",
          projectId: "proj-nebula",
          projectName: "Nebula 高频调试项目",
          rawValue: "<3500>",
          definitionRevisionId: "definition-revision-fixed",
          effectiveRevisionId: "binding-revision-effective"
        }
      ]
    });

    const compare = screen.getByRole("dialog", { name: "gpio_int 跨项目对比" });
    expect(within(compare).getByText("值的固定修订与当前有效修订不同")).toBeInTheDocument();
    expect(within(compare).getByText("definition-revision-fixed")).toBeInTheDocument();
    expect(within(compare).getByText("binding-revision-effective")).toBeInTheDocument();
  });

  it("embeds without a nested modal and references a present boolean with empty raw text", () => {
    const { onUseCompareAsDraft } = renderCompare({ embedded: true,
      baseEffectiveValue: { kind: "boolean", present: true }, baseRawValue: "",
      peers: [{ projectId: "peer", projectName: "参考项目", rawValue: "", valueState: "present" }] });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getAllByText("属性存在").length).toBeGreaterThan(0);
    expect(screen.getByText("全部相同")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "使用该项目配置加入草稿" }));
    expect(onUseCompareAsDraft).toHaveBeenCalledWith({ rawValue: "", reason: "参考 参考项目 当前配置生成草稿" });
  });

  it("cannot reference a deleted property as a present boolean", () => {
    renderCompare({ baseEffectiveValue: { kind: "boolean", present: true },
      peers: [{ projectId: "peer", projectName: "参考项目", rawValue: "", valueState: "deleted" }] });
    expect(screen.getByRole("button", { name: "使用该项目配置加入草稿" })).toBeDisabled();
  });
});
