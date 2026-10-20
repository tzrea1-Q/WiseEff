import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ModuleEditDialog } from "./ModuleEditDialog";
import { selectControlOption } from "@/test/selectControlOption";

afterEach(() => cleanup());

describe("ModuleEditDialog", () => {
  it("uses scoped help and preserves edits until discard is explicitly confirmed", () => {
    const onCancel = vi.fn();
    render(<ModuleEditDialog module={{ name: "Power" }} existingNames={[]} description="维护节点模块。" onSave={vi.fn()} onCancel={onCancel} />);
    expect(screen.getByRole("dialog")).toHaveAccessibleDescription("维护节点模块。");
    expect(screen.queryByText(/共享参数库/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("模块名称"), { target: { value: "Battery" } });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(onCancel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "继续编辑" }));
    expect(screen.getByLabelText("模块名称")).toHaveValue("Battery");
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    fireEvent.click(screen.getByRole("button", { name: "放弃修改" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });
  it("allows administrators to maintain driver module details alongside source history", () => {
    const onSave = vi.fn();
    render(<ModuleEditDialog module={{ name: "SC8562", description: "", scope: "", kind: "driver-group" }}
      existingNames={[]} canAdmin driverNature="physical-device" instanceCardinality="singleton-per-project"
      onSave={onSave} onCancel={vi.fn()} />);
    const dialog = screen.getByRole("dialog", { name: "SC8562" });
    expect(within(dialog).getByLabelText("驱动性质")).toHaveTextContent("物理设备");
    expect(within(dialog).getByLabelText("实例基数")).toHaveTextContent("单例/项目");
    for (const label of ["驱动性质", "实例基数"]) {
      expect(within(dialog).getByLabelText(label)).toBeEnabled();
    }
    for (const label of ["模块名称", "模块展示描述", "适用范围"]) expect(within(dialog).getByLabelText(label)).not.toHaveAttribute("readonly");
    fireEvent.change(within(dialog).getByLabelText("模块名称"), { target: { value: "My Driver" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));
    expect(onSave).toHaveBeenCalledWith({ name: "My Driver", description: "", scope: "" });
    expect(within(dialog).queryByLabelText("默认业务分类")).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: /从注册回放放置|添加 compatible|移除|配置组织级解析/ })).not.toBeInTheDocument();
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
        readOnly
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    const dialog = screen.getByRole("dialog", { name: "SC8562" });
    expect(within(dialog).getByLabelText("驱动性质")).toHaveTextContent("物理设备");
    expect(within(dialog).getByLabelText("实例基数")).toHaveTextContent("单例/项目");
    expect(within(dialog).getByLabelText("驱动性质")).toBeDisabled();
    expect(within(dialog).getByLabelText("实例基数")).toBeDisabled();
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
        scope: "组织"
      })
    );
  });

  it("does not freeze inherited importance when only driver details change", () => {
    const onSave = vi.fn();
    render(<ModuleEditDialog module={{ name: "Driver", kind: "driver-group", importance: "medium", effectiveImportance: "high" }}
      showImportance canAdmin existingNames={[]} onSave={onSave} onCancel={vi.fn()} />);
    expect(screen.getByRole("combobox", { name: "模块重要性" })).toHaveTextContent("高");
    fireEvent.change(screen.getByLabelText("模块名称"), { target: { value: "Renamed" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(onSave).toHaveBeenCalledWith({ name: "Renamed", description: "", scope: "" });
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
    expect(within(dialog).getByLabelText("驱动性质")).toBeEnabled();
    expect(within(dialog).getByLabelText("实例基数")).toBeEnabled();
    expect(within(dialog).queryByRole("region", { name: "历史驱动登记" })).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText("默认业务分类")).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "从注册回放放置" })).not.toBeInTheDocument();
    const canonical = within(dialog).getByRole("region", { name: "规范主体放置" });
    fireEvent.click(within(canonical).getByRole("button", { name: "管理规范主体与归属" }));
    expect(onManageCanonicalPlacement).toHaveBeenCalledOnce();
  });

  it("saves current driver recognition rules through the same module form", async () => {
    const onSave = vi.fn();
    render(<ModuleEditDialog module={{ name: "Driver", kind: "driver-group", compatibles: ["old,device"],
      driverNature: "physical-device", instanceCardinality: "multiple" }}
      canAdmin existingNames={[]} onSave={onSave} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("compatible 匹配规则"), { target: { value: "new,device\nnew,alias\nnew,device" } });
    await selectControlOption(screen.getByLabelText("驱动性质"), "logical-service");
    await selectControlOption(screen.getByLabelText("实例基数"), "singleton-per-project");
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(onSave).toHaveBeenCalledWith({ name: "Driver", description: "", scope: "", compatibles: ["new,device", "new,alias"],
      driverNature: "logical-service", instanceCardinality: "singleton-per-project" });
  });

  it("saves node recognition independently from its display name", () => {
    const onSave = vi.fn();
    render(<ModuleEditDialog module={{ name: "Node display", kind: "node-type", nodeTypeName: "old_node" }}
      canAdmin existingNames={[]} onSave={onSave} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("节点类型名"), { target: { value: "new_node" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(onSave).toHaveBeenCalledWith({ name: "Node display", description: "", scope: "", nodeTypeName: "new_node" });
  });

  it("preserves current edits when optional historical provenance arrives", () => {
    const props = { module: { name: "Driver", kind: "driver-group" as const, compatibles: ["current,device"],
      driverNature: "physical-device" as const, instanceCardinality: "multiple" as const },
      canAdmin: true, existingNames: [], onSave: vi.fn(), onCancel: vi.fn() };
    const { rerender } = render(<ModuleEditDialog {...props} />);
    fireEvent.change(screen.getByLabelText("模块名称"), { target: { value: "My edit" } });
    fireEvent.change(screen.getByLabelText("compatible 匹配规则"), { target: { value: "edited,device" } });
    rerender(<ModuleEditDialog {...props} historicalCompatibles={["historical,device"]} driverNature="logical-service" />);
    expect(screen.getByLabelText("模块名称")).toHaveValue("My edit");
    expect(screen.getByLabelText("compatible 匹配规则")).toHaveValue("edited,device");
  });
});
