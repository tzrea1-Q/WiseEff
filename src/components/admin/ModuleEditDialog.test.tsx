import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ModuleEditDialog } from "./ModuleEditDialog";

afterEach(() => cleanup());

describe("ModuleEditDialog", () => {
  it("keeps historical driver identity read-only even for mock admins", () => {
    const onSave = vi.fn();
    render(<ModuleEditDialog module={{ name: "SC8562", description: "", scope: "", kind: "driver-group" }}
      existingNames={[]} canAdmin driverNature="physical-device" instanceCardinality="singleton-per-project"
      onSave={onSave} onCancel={vi.fn()} />);
    const dialog = screen.getByRole("dialog", { name: "SC8562" });
    expect(within(dialog).getByLabelText("驱动性质")).toHaveValue("物理设备");
    expect(within(dialog).getByLabelText("实例基数")).toHaveValue("单例/项目");
    for (const label of ["驱动性质", "实例基数", "模块名称", "模块展示描述", "适用范围"]) {
      expect(within(dialog).getByLabelText(label)).toHaveAttribute("readonly");
      fireEvent.change(within(dialog).getByLabelText(label), { target: { value: "Forbidden edit" } });
    }
    expect(within(dialog).queryByRole("button", { name: "保存" })).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText("默认业务分类")).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: /从注册回放放置|添加 compatible|移除|配置组织级解析/ })).not.toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("keeps driver nature and cardinality read-only without admin", () => {
    render(
      <ModuleEditDialog
        module={{
          name: "SC8562",
          description: "",
          scope: "",
          kind: "driver-group",
        }}
        existingNames={[]}
        driverNature="physical-device"
        instanceCardinality="singleton-per-project"
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    const dialog = screen.getByRole("dialog", { name: "SC8562" });
    expect(within(dialog).getByLabelText("驱动性质")).toHaveValue("物理设备");
    expect(within(dialog).getByLabelText("实例基数")).toHaveValue("单例/项目");
    expect(within(dialog).getByLabelText("驱动性质").tagName).toBe("INPUT");
  });

  it("saves name and description changes", () => {
    const onSave = vi.fn();
    render(
      <ModuleEditDialog
        module={{ name: "Power", description: "旧", scope: "组织", kind: "business" }}
        existingNames={[]}
        showImportance
        onSave={onSave}
        onCancel={vi.fn()}
      />
    );

    const dialog = screen.getByRole("dialog", { name: "Power" });
    fireEvent.change(within(dialog).getByLabelText("模块展示描述"), {
      target: { value: "新描述" }
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Power",
        description: "新描述",
        scope: "组织",
        importance: "medium"
      })
    );
  });

  it("keeps historical metadata read-only and offers only canonical placement controls", () => {
    const onManageCanonicalPlacement = vi.fn();
    render(
      <ModuleEditDialog
        module={{ name: "SC8562", description: "", scope: "", kind: "driver-group" }}
        existingNames={[]}
        canAdmin
        driverNature="physical-device"
        instanceCardinality="multiple"
        historicalCompatibles={["vendor,sc8562"]}
        onManageCanonicalPlacement={onManageCanonicalPlacement}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    const dialog = screen.getByRole("dialog", { name: "SC8562" });
    expect(within(dialog).getByRole("region", { name: "历史 compatible 溯源" })).toHaveTextContent("vendor,sc8562");
    expect(within(dialog).getByLabelText("驱动性质")).toHaveAttribute("readonly");
    expect(within(dialog).getByLabelText("实例基数")).toHaveAttribute("readonly");
    expect(within(dialog).queryByRole("region", { name: "历史驱动登记" })).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText("默认业务分类")).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "从注册回放放置" })).not.toBeInTheDocument();
    const canonical = within(dialog).getByRole("region", { name: "规范主体放置" });
    fireEvent.click(within(canonical).getByRole("button", { name: "管理规范主体与归属" }));
    expect(onManageCanonicalPlacement).toHaveBeenCalledOnce();
  });
});
