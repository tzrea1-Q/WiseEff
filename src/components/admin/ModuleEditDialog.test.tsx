import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ModuleEditDialog } from "./ModuleEditDialog";

afterEach(() => cleanup());

describe("ModuleEditDialog", () => {
  it("shows editable driver nature and cardinality selects for admins", () => {
    const onSave = vi.fn();
    render(
      <ModuleEditDialog
        module={{
          name: "SC8562",
          description: "",
          scope: "",
          kind: "driver-group",
        }}
        existingNames={[]}
        canAdmin
        driverNature="physical-device"
        instanceCardinality="singleton-per-project"
        onSave={onSave}
        onCancel={vi.fn()}
      />
    );

    const dialog = screen.getByRole("dialog", { name: "SC8562" });
    const nature = within(dialog).getByLabelText("驱动性质");
    const cardinality = within(dialog).getByLabelText("实例基数");
    expect(nature.tagName).toBe("SELECT");
    expect(cardinality.tagName).toBe("SELECT");
    expect(nature).toHaveValue("physical-device");
    expect(cardinality).toHaveValue("singleton-per-project");
    expect(
      within(dialog).getByText(/与分类树中的节点类型（node-type）不是同一概念/)
    ).toBeInTheDocument();

    fireEvent.change(nature, { target: { value: "logical-service" } });
    fireEvent.change(cardinality, { target: { value: "multiple" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        driverNature: "logical-service",
        instanceCardinality: "multiple",
      })
    );
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

  it("shows overlay coverage label and author button for uncovered compatible rows", () => {
    const onAuthorOverlaySchema = vi.fn();
    render(
      <ModuleEditDialog
        module={{
          name: "SC8562",
          description: "",
          scope: "",
          kind: "driver-group"
        }}
        existingNames={[]}
        canAdmin
        compatibleMappings={[
          { id: "m1", matchKind: "compatible", matchValue: "vendor,sc8562" },
          { id: "m2", matchKind: "compatible", matchValue: "vendor,other" }
        ]}
        compatibleCoverages={[
          {
            compatible: "vendor,sc8562",
            covered: true,
            pattern: "vendor,sc8562*",
            source: "manual",
            driverId: "driver:org/org-1/vendor,sc8562:v1",
            scope: "organization"
          },
          { compatible: "vendor,other", covered: false }
        ]}
        onSave={vi.fn()}
        onCancel={vi.fn()}
        onRemoveCompatibleMapping={vi.fn()}
        onAddCompatibleMapping={vi.fn()}
        onAuthorOverlaySchema={onAuthorOverlaySchema}
      />
    );

    const dialog = screen.getByRole("dialog", { name: "SC8562" });
    expect(within(dialog).getByText(/组织级解析覆盖 · vendor,sc8562\*/)).toBeInTheDocument();
    expect(within(dialog).getByText("解析未覆盖")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "配置组织级解析" }));
    expect(onAuthorOverlaySchema).toHaveBeenCalledWith("vendor,other");
  });

  it("renders per-compatible parse coverage next to matching rules", () => {
    render(
      <ModuleEditDialog
        module={{
          name: "SC8562",
          description: "",
          scope: "",
          kind: "driver-group"
        }}
        existingNames={[]}
        compatibleMappings={[
          { id: "m1", matchKind: "compatible", matchValue: "vendor,sc8562" },
          { id: "m2", matchKind: "compatible", matchValue: "vendor,other" }
        ]}
        compatibleCoverages={[
          { compatible: "vendor,sc8562", covered: true, pattern: "vendor,sc8562*", scope: "platform" },
          { compatible: "vendor,other", covered: false }
        ]}
        onSave={vi.fn()}
        onCancel={vi.fn()}
        onRemoveCompatibleMapping={vi.fn()}
        onAddCompatibleMapping={vi.fn()}
      />
    );

    const dialog = screen.getByRole("dialog", { name: "SC8562" });
    expect(within(dialog).getByText("compatible:vendor,sc8562")).toBeInTheDocument();
    expect(within(dialog).getByText(/平台级解析覆盖 · vendor,sc8562\*/)).toBeInTheDocument();
    expect(within(dialog).getByText("解析未覆盖")).toBeInTheDocument();
  });

  it("saves name and description changes", () => {
    const onSave = vi.fn();
    render(
      <ModuleEditDialog
        module={{ name: "Power", description: "旧", scope: "组织", kind: "business" }}
        existingNames={[]}
        showImportance
        showKind
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
        kind: "business",
        importance: "medium"
      })
    );
  });

  it("shows default business category picker and replay button for admin driver groups", async () => {
    const onUpdateDefaultBusinessCategory = vi.fn().mockResolvedValue(undefined);
    const onReplayPlacement = vi.fn().mockResolvedValue({
      moved: 1,
      skippedCurated: 0,
      skippedMissingDefault: 0
    });
    render(
      <ModuleEditDialog
        module={{
          name: "SC8562",
          description: "",
          scope: "",
          kind: "driver-group"
        }}
        existingNames={[]}
        canAdmin
        modules={[
          {
            id: "biz-1",
            name: "充电策略",
            parentId: null,
            sortOrder: 0,
            description: "",
            scope: "",
            importance: "medium",
            kind: "business",
            origin: "curated",
            sourceKey: null,
            effectiveImportance: "medium",
            parameterCount: 0
          },
          {
            id: "biz-2",
            name: "无线充电",
            parentId: null,
            sortOrder: 1,
            description: "",
            scope: "",
            importance: "medium",
            kind: "business",
            origin: "curated",
            sourceKey: null,
            effectiveImportance: "medium",
            parameterCount: 0
          }
        ]}
        defaultBusinessCategoryId="biz-1"
        onUpdateDefaultBusinessCategory={onUpdateDefaultBusinessCategory}
        onReplayPlacement={onReplayPlacement}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    const dialog = screen.getByRole("dialog", { name: "SC8562" });
    expect(within(dialog).getByText(/自动发现的驱动组跟随此默认分类/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "从注册回放放置" }));
    expect(onReplayPlacement).toHaveBeenCalled();
    expect(await within(dialog).findByText(/回放完成：移动 1/)).toBeInTheDocument();
  });

  it("previews overlay retirement impact and gates no-successor coverage loss", async () => {
    const onDeprecateOverlaySchema = vi.fn().mockResolvedValue(undefined);
    render(
      <ModuleEditDialog
        module={{ name: "SC8562", description: "", scope: "", kind: "driver-group" }}
        existingNames={[]}
        canAdmin
        overlaySchemas={[
          {
            id: "overlay-1",
            compatible: "vendor,sc8562",
            displayName: "SC8562 组织解析",
            notes: "",
            lifecycle: "active",
            version: 1,
            properties: []
          },
          {
            id: "overlay-old",
            compatible: "vendor,sc8562",
            displayName: "旧组织解析",
            notes: "",
            lifecycle: "superseded",
            supersededBySchemaId: "platform-overlay-1",
            version: 1,
            properties: []
          }
        ]}
        onPreviewOverlayDeprecation={vi.fn().mockResolvedValue({
          schemaId: "overlay-1",
          compatible: "vendor,sc8562",
          coverageLoss: true,
          definitionCount: 2,
          projectCount: 3,
          successorSource: null
        })}
        onDeprecateOverlaySchema={onDeprecateOverlaySchema}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    const editor = screen.getByRole("dialog", { name: "SC8562" });
    expect(within(editor).getByText("已提升至平台层")).toBeInTheDocument();
    expect(within(editor).getByText(/后继来源：平台层解析 platform-overlay-1/)).toBeInTheDocument();
    fireEvent.click(within(editor).getByRole("button", { name: "停用解析 SC8562 组织解析" }));

    const impactDialog = await screen.findByRole("dialog", { name: "SC8562 组织解析" });
    expect(within(impactDialog).getByText("解析覆盖将丢失")).toBeInTheDocument();
    expect(within(impactDialog).getByText("定义 2 项")).toBeInTheDocument();
    expect(within(impactDialog).getByText("项目 3 个")).toBeInTheDocument();
    const confirm = within(impactDialog).getByRole("button", { name: "确认停用解析" });
    expect(confirm).toBeDisabled();
    fireEvent.click(
      within(impactDialog).getByRole("checkbox", { name: "我确认该 compatible 将失去解析覆盖" })
    );
    fireEvent.click(confirm);
    expect(onDeprecateOverlaySchema).toHaveBeenCalledWith("overlay-1", {
      confirmCoverageLoss: true
    });
  });
});
