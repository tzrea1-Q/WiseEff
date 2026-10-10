import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { createMockKnowledgeRepository } from "@/infrastructure/mock/mockKnowledgeRepository";
import { createMockCatalogPorts } from "@/application/parameter-catalog/mockAdapter";
import { deriveCatalogDomainState } from "@/application/parameter-catalog/states";
import { DefinitionEditorBody } from "@/features/parameter-catalog-governance/DefinitionEditorBody";
import { KnowledgePage } from "./KnowledgePage";
import { KnowledgeParameterReferenceChips } from "./KnowledgeParameterReferenceChips";
import type { KnowledgeDefinitionPickerPage } from "./KnowledgeEntryEditorDialog";
import {
  CATALOG_RELEASE_ID,
  activeDefinition,
  readyCatalogDocument,
  registeredSubject
} from "@/application/parameter-catalog/fixtures";

const editorCapability = { userId: "u-xu-yun", canView: true, canEdit: true, canManage: false };

const definitionPage: KnowledgeDefinitionPickerPage = {
  items: [{ definitionId: activeDefinition.id, propertyKey: activeDefinition.propertyKey,
    displayName: activeDefinition.currentRevision.displayName, driverModule: activeDefinition.subject.canonicalName,
    lifecycle: activeDefinition.lifecycle }],
  nextCursor: null, catalogReleaseId: "release-1"
};

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
  it.each(["current", "unavailable"] as const)("explains a non-navigable %s Definition chip", (availability) => {
    render(<KnowledgeParameterReferenceChips references={[{
      kind: "definition", definitionId: activeDefinition.id, availability,
      propertyKey: activeDefinition.propertyKey, displayName: activeDefinition.currentRevision.displayName,
      driverModule: activeDefinition.subject.canonicalName, lifecycle: "active",
      createdByUserId: "u-xu-yun", createdAt: "2026-10-09T00:00:00.000Z"
    }]} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByTitle(availability === "unavailable"
      ? "当前会话无法读取该定义，引用保留但无法打开。"
      : "当前会话未提供可访问的参数定义读取入口。"))
      .toHaveAccessibleName(expect.stringContaining(activeDefinition.currentRevision.displayName));
  });
  it("navigates only current canonical identities and keeps unavailable identities visible", async () => {
    const onOpenDefinition = vi.fn();
    render(<KnowledgeParameterReferenceChips onOpenDefinition={onOpenDefinition} references={[
      { kind: "definition", definitionId: activeDefinition.id, availability: "current",
        propertyKey: activeDefinition.propertyKey, displayName: activeDefinition.currentRevision.displayName,
        driverModule: activeDefinition.subject.canonicalName, lifecycle: "active",
        createdByUserId: "u-xu-yun", createdAt: "2026-09-29T00:00:00.000Z" },
      { kind: "definition", definitionId: "hidden-definition", availability: "unavailable",
        propertyKey: null, displayName: null, driverModule: null, lifecycle: null,
        createdByUserId: "u-xu-yun", createdAt: "2026-09-29T00:00:00.000Z" }
    ]} />);
    expect(screen.getByText("定义不可用")).toBeInTheDocument();
    expect(screen.getByText("不可用")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "查看参数定义 hidden-definition" })).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByTitle(`查看参数定义 ${activeDefinition.propertyKey}`));
    expect(onOpenDefinition).toHaveBeenCalledExactlyOnceWith(activeDefinition.id);
  });
  it("shows historical Spec chips without retargeting their identity to a Definition", async () => {
    const onOpenDefinition = vi.fn();
    renderKnowledgePage({ onOpenDefinition });
    const user = userEvent.setup();

    const table = await screen.findByRole("table", { name: "知识条目列表" });
    await user.click(within(table).getByText("快充温控调参经验"));

    const chips = await screen.findByTestId("knowledge-parameter-references");
    expect(within(chips).getByText("SC8562 GPIO interrupt · sc8562")).toBeInTheDocument();
    expect(within(chips).getByText("Legacy status (deprecated)")).toBeInTheDocument();
    expect(within(chips).getByText("已废弃")).toBeInTheDocument();

    expect(within(chips).queryByRole("button", { name: /Legacy status/ })).not.toBeInTheDocument();
    expect(onOpenDefinition).not.toHaveBeenCalled();
  });

  it("shows an explicit historical badge instead of silently retargeting to draft-current", async () => {
    const repository = createMockKnowledgeRepository();
    const originalList = repository.list.bind(repository);
    repository.list = async (query) => {
      const listed = await originalList(query);
      return {
        items: listed.items.map((entry) => ({
          ...entry,
          parameterReferences: entry.parameterReferences.map((reference, index) =>
            index === 1
              ? { ...reference, historicalOnly: true, mappingStatus: "historical" as const }
              : reference,
          ),
        })),
      };
    };
    const onOpenDefinition = vi.fn();
    renderKnowledgePage({ repository, onOpenDefinition });
    const user = userEvent.setup();

    const table = await screen.findByRole("table", { name: "知识条目列表" });
    await user.click(within(table).getByText("快充温控调参经验"));

    const chips = await screen.findByTestId("knowledge-parameter-references");
    const historical = within(chips).getByText("历史");
    expect(historical).toBeInTheDocument();
    expect(historical.closest("li")).toHaveAttribute("data-historical", "true");
    expect(historical.closest("li")).toHaveAttribute("data-mapping-status", "historical");
  });
});

describe("knowledge entry editor reference picker", () => {
  it("searches definitions, adds a reference immediately, and removes it", async () => {
    const searchParameterDefinitions = vi.fn(async () => definitionPage);
    renderKnowledgePage({ searchParameterDefinitions });
    const user = userEvent.setup();

    const table = await screen.findByRole("table", { name: "知识条目列表" });
    await user.click(within(table).getByText("快充温控调参经验"));
    await user.click(await screen.findByRole("button", { name: "编辑" }));

    const picker = await screen.findByTestId("knowledge-reference-picker");
    // Existing references render as removable chips inside the picker.
    expect(within(picker).getByText("SC8562 GPIO interrupt · sc8562")).toBeInTheDocument();

    await user.type(within(picker).getByRole("searchbox", { name: "检索参数定义" }), "gpio");
    await user.click(within(picker).getByRole("button", { name: /检索定义/ }));
    expect(searchParameterDefinitions).toHaveBeenCalledWith("gpio");

    const results = await within(picker).findByRole("list", { name: "参数定义检索结果" });
    await user.click(within(results).getByRole("button", { name: /关联/ }));

    // The mock repository resolves the same canonical identity as CatalogRead.
    await waitFor(() => {
      expect(within(picker).getByText(`${activeDefinition.currentRevision.displayName} · ${activeDefinition.subject.canonicalName}`)).toBeInTheDocument();
    });

    await user.click(within(picker).getByRole("button", { name: `移除引用 ${activeDefinition.currentRevision.displayName}` }));
    await waitFor(() => {
      expect(within(picker).queryByText(`${activeDefinition.currentRevision.displayName} · ${activeDefinition.subject.canonicalName}`)).not.toBeInTheDocument();
    });
  });

  it("loads the next Catalog page with the original release pin before selecting", async () => {
    const firstPage = Array.from({ length: 50 }, (_, index) => ({
      ...definitionPage.items[0]!, definitionId: `definition-${index}`, propertyKey: `property_${index}`,
      displayName: `Definition ${index}`
    }));
    const searchParameterDefinitions = vi.fn(async (_q: string, cursor?: string, releaseId?: string) =>
      cursor
        ? { ...definitionPage, items: definitionPage.items, nextCursor: null }
        : { ...definitionPage, items: firstPage, nextCursor: "page-2" });
    renderKnowledgePage({ searchParameterDefinitions });
    const user = userEvent.setup();
    const table = await screen.findByRole("table", { name: "知识条目列表" });
    await user.click(within(table).getByText("快充温控调参经验"));
    await user.click(await screen.findByRole("button", { name: "编辑" }));
    const picker = await screen.findByTestId("knowledge-reference-picker");
    await user.click(within(picker).getByRole("button", { name: /检索定义/ }));
    expect(within(picker).getAllByRole("button", { name: "关联" })).toHaveLength(50);
    await user.click(within(picker).getByRole("button", { name: "加载更多定义" }));
    expect(searchParameterDefinitions).toHaveBeenLastCalledWith("", "page-2", "release-1");
    expect(await within(picker).findByText(activeDefinition.currentRevision.displayName)).toBeInTheDocument();
    await user.click(within(picker).getAllByRole("button", { name: "关联" })[50]!);
    expect(await within(picker).findByText(`${activeDefinition.currentRevision.displayName} · ${activeDefinition.subject.canonicalName}`)).toBeInTheDocument();
  });

  it("does not merge pages from different Catalog releases", async () => {
    const searchParameterDefinitions = vi.fn(async (_q: string, cursor?: string) =>
      cursor
        ? { ...definitionPage, items: [{ ...definitionPage.items[0]!, definitionId: "drifted-definition" }], catalogReleaseId: "release-2" }
        : { ...definitionPage, items: [], nextCursor: "page-2" });
    renderKnowledgePage({ searchParameterDefinitions });
    const user = userEvent.setup();
    const table = await screen.findByRole("table", { name: "知识条目列表" });
    await user.click(within(table).getByText("快充温控调参经验"));
    await user.click(await screen.findByRole("button", { name: "编辑" }));
    const picker = await screen.findByTestId("knowledge-reference-picker");
    await user.click(within(picker).getByRole("button", { name: /检索定义/ }));
    await user.click(within(picker).getByRole("button", { name: "加载更多定义" }));
    expect(await within(picker).findByRole("alert")).toHaveTextContent("目录发布已变化");
    expect(within(picker).queryByText(activeDefinition.currentRevision.displayName)).not.toBeInTheDocument();
  });

  it("shows retired Definitions but does not offer a new reference", async () => {
    renderKnowledgePage({ searchParameterDefinitions: async () => ({ ...definitionPage,
      items: [{ ...definitionPage.items[0]!, lifecycle: "retired" }] }) });
    const user = userEvent.setup();
    const table = await screen.findByRole("table", { name: "知识条目列表" });
    await user.click(within(table).getByText("快充温控调参经验"));
    await user.click(await screen.findByRole("button", { name: "编辑" }));
    const picker = await screen.findByTestId("knowledge-reference-picker");
    await user.click(within(picker).getByRole("button", { name: /检索定义/ }));
    expect(await within(picker).findByRole("button", { name: "不可关联" })).toBeDisabled();
  });

  it("tells creators to save the draft first and hides the picker without a search source", async () => {
    const searchParameterDefinitions = vi.fn(async () => definitionPage);
    renderKnowledgePage({ searchParameterDefinitions });
    const user = userEvent.setup();

    await screen.findByRole("table", { name: "知识条目列表" });
    await user.click(screen.getByRole("button", { name: /新建条目/ }));
    const picker = await screen.findByTestId("knowledge-reference-picker");
    expect(within(picker).getByText("先创建草稿,再关联参数定义。")).toBeInTheDocument();
    expect(within(picker).queryByRole("searchbox", { name: "检索参数定义" })).not.toBeInTheDocument();
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
  function definitionEditor(relatedKnowledge?: Parameters<typeof DefinitionEditorBody>[0]["relatedKnowledge"]) {
    const ports = createMockCatalogPorts({ scenario: "ready" });
    return (
      <DefinitionEditorBody
        actor="org-admin"
        domainState={deriveCatalogDomainState({ document: readyCatalogDocument })}
        catalog={ports.catalog}
        catalogReleaseId={CATALOG_RELEASE_ID}
        definition={activeDefinition}
        relatedKnowledge={relatedKnowledge}
        subjects={[registeredSubject]}
        history={null}
        authoringAllowed={false}
      />
    );
  }

  it("lists published referencing entries and deep-links into /knowledge", async () => {
    const load = vi.fn(async () => [
      { entryId: "mock-kb-1", title: "快充温控调参经验", excerpt: "当电池温度超过 45 度…", updatedAt: "2026-08-10T06:30:00.000Z" }
    ]);
    const onOpenEntry = vi.fn();
    render(definitionEditor({ load, onOpenEntry }));

    const section = await screen.findByTestId("spec-related-knowledge");
    expect(load).toHaveBeenCalledWith(activeDefinition.id);
    expect(await within(section).findByText("快充温控调参经验")).toBeInTheDocument();
    expect(within(section).getByText("仅显示已发布条目；草稿与已归档不出现。")).toBeInTheDocument();

    await userEvent.setup().click(within(section).getByRole("button", { name: /快充温控调参经验/ }));
    expect(onOpenEntry).toHaveBeenCalledWith("mock-kb-1");
  });

  it("shows an honest empty state and stays hidden without the injected source", async () => {
    const { rerender } = render(
      definitionEditor({ load: async () => [], onOpenEntry: () => undefined })
    );
    const section = await screen.findByTestId("spec-related-knowledge");
    expect(await within(section).findByText("暂无引用该定义的已发布知识条目。")).toBeInTheDocument();

    rerender(definitionEditor());
    expect(screen.queryByTestId("spec-related-knowledge")).not.toBeInTheDocument();
  });
});
