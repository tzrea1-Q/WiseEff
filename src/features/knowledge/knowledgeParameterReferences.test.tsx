import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { createMockKnowledgeRepository } from "@/infrastructure/mock/mockKnowledgeRepository";
import {
  ParameterSpecDetail,
  createSpecEditorDraft,
  type ParameterSpecDetailView
} from "@/components/parameter-topology/ParameterSpecDetail";
import { KnowledgePage } from "./KnowledgePage";
import type { KnowledgeSpecPickerOption } from "./KnowledgeEntryEditorDialog";

const editorCapability = { userId: "u-xu-yun", canView: true, canEdit: true, canManage: false };

const specOptions: KnowledgeSpecPickerOption[] = [
  { specId: "spec-mt5788-gpio-int", propertyKey: "gpio_int", displayName: null, driverModule: "mt5788", lifecycle: "active" }
];

function renderKnowledgePage(overrides: Partial<Parameters<typeof KnowledgePage>[0]> = {}) {
  const repository = createMockKnowledgeRepository();
  const utils = render(
    <KnowledgePage
      repository={repository}
      capability={editorCapability}
      askXiaozeEnabled={false}
      initialEntryId={null}
      {...overrides}
      {...(overrides.repository ? {} : { repository })}
    />
  );
  return { repository, ...utils };
}

describe("knowledge entry detail reference chips", () => {
  it("shows definition chips with module and an honest 已废弃 badge, deep-linking on click", async () => {
    const onOpenParameterSpec = vi.fn();
    renderKnowledgePage({ onOpenParameterSpec });
    const user = userEvent.setup();

    const table = await screen.findByRole("table", { name: "知识条目列表" });
    await user.click(within(table).getByText("快充温控调参经验"));

    const chips = await screen.findByTestId("knowledge-parameter-references");
    expect(within(chips).getByText("SC8562 GPIO interrupt · sc8562")).toBeInTheDocument();
    expect(within(chips).getByText("Legacy status (deprecated)")).toBeInTheDocument();
    expect(within(chips).getByText("已废弃")).toBeInTheDocument();

    await user.click(within(chips).getByRole("button", { name: /Legacy status/ }));
    expect(onOpenParameterSpec).toHaveBeenCalledWith("spec-deprecated-legacy");
  });
});

describe("knowledge entry editor reference picker", () => {
  it("searches definitions, adds a reference immediately, and removes it", async () => {
    const searchParameterSpecs = vi.fn(async () => specOptions);
    renderKnowledgePage({ searchParameterSpecs });
    const user = userEvent.setup();

    const table = await screen.findByRole("table", { name: "知识条目列表" });
    await user.click(within(table).getByText("快充温控调参经验"));
    await user.click(await screen.findByRole("button", { name: "编辑" }));

    const picker = await screen.findByTestId("knowledge-reference-picker");
    // Existing references render as removable chips inside the picker.
    expect(within(picker).getByText("SC8562 GPIO interrupt · sc8562")).toBeInTheDocument();

    await user.type(within(picker).getByRole("textbox", { name: "检索参数定义" }), "gpio");
    await user.click(within(picker).getByRole("button", { name: /检索定义/ }));
    expect(searchParameterSpecs).toHaveBeenCalledWith("gpio");

    const results = await within(picker).findByRole("list", { name: "参数定义检索结果" });
    await user.click(within(results).getByRole("button", { name: /关联/ }));

    // The mock repository resolves chip fields from its aligned spec catalog.
    await waitFor(() => {
      expect(within(picker).getByText("MT5788 GPIO interrupt · mt5788")).toBeInTheDocument();
    });

    await user.click(within(picker).getByRole("button", { name: "移除引用 MT5788 GPIO interrupt" }));
    await waitFor(() => {
      expect(within(picker).queryByText("MT5788 GPIO interrupt · mt5788")).not.toBeInTheDocument();
    });
  });

  it("tells creators to save the draft first and hides the picker without a search source", async () => {
    const searchParameterSpecs = vi.fn(async () => specOptions);
    renderKnowledgePage({ searchParameterSpecs });
    const user = userEvent.setup();

    await screen.findByRole("table", { name: "知识条目列表" });
    await user.click(screen.getByRole("button", { name: /新建条目/ }));
    const picker = await screen.findByTestId("knowledge-reference-picker");
    expect(within(picker).getByText("先创建草稿,再关联参数定义。")).toBeInTheDocument();
    expect(within(picker).queryByRole("textbox", { name: "检索参数定义" })).not.toBeInTheDocument();
  });

  it("hides the reference picker entirely without parameter:view (no search source)", async () => {
    renderKnowledgePage();
    const user = userEvent.setup();

    const table = await screen.findByRole("table", { name: "知识条目列表" });
    await user.click(within(table).getByText("快充温控调参经验"));
    await user.click(await screen.findByRole("button", { name: "编辑" }));

    await screen.findByRole("heading", { name: "编辑知识条目" });
    expect(screen.queryByTestId("knowledge-reference-picker")).not.toBeInTheDocument();
  });
});

describe("definition detail 相关知识 section", () => {
  function makeDetail(): ParameterSpecDetailView {
    return {
      id: "spec-sc8562-gpio-int",
      organizationId: "org-1",
      propertyKey: "gpio_int",
      driverModule: "sc8562",
      businessCategory: null,
      reviewState: "active",
      valueType: "cells",
      valueShape: { kind: "cells" },
      exampleValue: null,
      usageCount: 0,
      schemaSource: "dts",
      compatibles: [],
      attributionModules: [],
      attributionSubjectId: null,
      moduleNames: []
    } as unknown as ParameterSpecDetailView;
  }

  it("lists published referencing entries and deep-links into /knowledge", async () => {
    const load = vi.fn(async () => [
      { entryId: "mock-kb-1", title: "快充温控调参经验", excerpt: "当电池温度超过 45 度…", updatedAt: "2026-08-10T06:30:00.000Z" }
    ]);
    const onOpenEntry = vi.fn();
    const detail = makeDetail();
    render(
      <ParameterSpecDetail
        detail={detail}
        draft={createSpecEditorDraft(detail)}
        onDraftChange={() => undefined}
        editable={false}
        relatedKnowledge={{ load, onOpenEntry }}
      />
    );

    const section = await screen.findByTestId("spec-related-knowledge");
    expect(load).toHaveBeenCalledWith("spec-sc8562-gpio-int");
    expect(await within(section).findByText("快充温控调参经验")).toBeInTheDocument();
    expect(within(section).getByText("仅显示已发布条目；草稿与已归档不出现。")).toBeInTheDocument();

    await userEvent.setup().click(within(section).getByRole("button", { name: /快充温控调参经验/ }));
    expect(onOpenEntry).toHaveBeenCalledWith("mock-kb-1");
  });

  it("shows an honest empty state and stays hidden without the injected source", async () => {
    const detail = makeDetail();
    const { rerender } = render(
      <ParameterSpecDetail
        detail={detail}
        draft={createSpecEditorDraft(detail)}
        onDraftChange={() => undefined}
        editable={false}
        relatedKnowledge={{ load: async () => [], onOpenEntry: () => undefined }}
      />
    );
    const section = await screen.findByTestId("spec-related-knowledge");
    expect(await within(section).findByText("暂无引用该定义的已发布知识条目。")).toBeInTheDocument();

    rerender(
      <ParameterSpecDetail
        detail={detail}
        draft={createSpecEditorDraft(detail)}
        onDraftChange={() => undefined}
        editable={false}
      />
    );
    expect(screen.queryByTestId("spec-related-knowledge")).not.toBeInTheDocument();
  });
});
