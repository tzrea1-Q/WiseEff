import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createTestModuleRegistryRepository, createTestParameterTopologyRepository } from "@/test/harness";
import {
  CATALOG_RELEASE_ID,
  activeDefinition
} from "@/application/parameter-catalog/fixtures";
import type { CatalogListQuery } from "@/infrastructure/http/parameterCatalogDtos";
import { listAllCanonicalPages } from "./CanonicalSubjectPlacementPanel";
import { OrganizationModuleGovernancePanel } from "./OrganizationModuleGovernancePanel";
import { ParameterAdminProvider } from "./ParameterAdminProvider";

describe("canonical module governance", () => {
  it("preserves shared taxonomy create/edit/move without legacy identity creation or reclassification", async () => {
    const navigation = {
      modules: [{ id: "business_one", name: "Business", parentId: null, sortOrder: 0,
        description: "", scope: "", importance: "medium" as const, kind: "business" as const,
        origin: "curated" as const, sourceKey: null, attributionSubjectId: null,
        effectiveImportance: "medium" as const, parameterCount: 0, definitionCount: 0 },
      { id: "node_one", name: "Node placement", parentId: null, sortOrder: 1,
        description: "", scope: "", importance: "medium" as const, kind: "node-type" as const,
        origin: "curated" as const, sourceKey: null, attributionSubjectId: null,
        effectiveImportance: "medium" as const, parameterCount: 0, definitionCount: 0 }],
      mappings: [], navigationOnly: true
    };
    const retiredWrites = { registerOrClaimDriver: vi.fn(), createMapping: vi.fn() };
    const moduleRegistry = { ...createTestModuleRegistryRepository({
      getRegistry: vi.fn().mockResolvedValue(navigation),
      listDriverRegistry: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      createModule: vi.fn().mockResolvedValue(navigation),
      updateModule: vi.fn().mockResolvedValue(navigation)
    }), ...retiredWrites };
    render(<ParameterAdminProvider topology={createTestParameterTopologyRepository()} moduleRegistry={moduleRegistry}>
      <OrganizationModuleGovernancePanel canonicalEnabled actor="org-admin" />
    </ParameterAdminProvider>);
    expect(await screen.findByRole("alert")).toHaveTextContent("规范目录发现服务不可用");
    fireEvent.click(screen.getByRole("button", { name: "新建模块" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByLabelText("模块类型")).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText("Exact compatible")).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText("sourceKey")).not.toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("模块名称"), { target: { value: "Shared category" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "创建" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(moduleRegistry.createModule).toHaveBeenCalledWith(expect.objectContaining({
      name: "Shared category", kind: "business", origin: "curated", parentId: null
    }));

    fireEvent.click(screen.getByRole("button", { name: "修改模块 Business" }));
    const editor = screen.getByRole("dialog");
    expect(within(editor).queryByLabelText("模块类型")).not.toBeInTheDocument();
    fireEvent.change(within(editor).getByLabelText("模块名称"), { target: { value: "Renamed category" } });
    fireEvent.click(within(editor).getByRole("button", { name: "保存" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(moduleRegistry.updateModule).toHaveBeenCalledWith("business_one", {
      name: "Renamed category", description: "", scope: "", importance: "medium"
    });

    fireEvent.click(screen.getByRole("button", { name: "Business 更多操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "移动模块 Business" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "确认移动" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(moduleRegistry.updateModule).toHaveBeenCalledWith("business_one", { parentId: null });

    fireEvent.click(screen.getByRole("button", { name: "Business 更多操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "添加子模块到 Business" }));
    const childCreator = screen.getByRole("dialog");
    expect(within(childCreator).queryByLabelText("模块类型")).not.toBeInTheDocument();
    fireEvent.change(within(childCreator).getByLabelText("模块名称"), { target: { value: "Child category" } });
    fireEvent.click(within(childCreator).getByRole("button", { name: "创建" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(moduleRegistry.createModule).toHaveBeenCalledWith(expect.objectContaining({
      name: "Child category", kind: "business", parentId: "business_one"
    }));

    fireEvent.click(screen.getByRole("button", { name: "修改模块 Node placement" }));
    expect(within(screen.getByRole("dialog")).queryByLabelText("模块类型")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Node placement 更多操作" })).not.toBeInTheDocument();
    expect(moduleRegistry.registerOrClaimDriver).not.toHaveBeenCalled();
    expect(moduleRegistry.createMapping).not.toHaveBeenCalled();
  });
});

describe("canonical definition pagination", () => {
  it("reads every active registered canonical definition page without changing identity or revision shape", async () => {
    const secondDefinition = {
      ...activeDefinition,
      id: "pdef_extra_119",
      propertyKey: "extra_119"
    };
    const queries: CatalogListQuery[] = [];
    const listDefinitions = vi.fn(async (query?: CatalogListQuery) => {
      queries.push(query ?? {});
      if (query?.cursor === "page-2") {
        return {
          items: [secondDefinition],
          totalCount: 2,
          hasMore: false,
          nextCursor: null,
          catalogReleaseId: CATALOG_RELEASE_ID
        };
      }
      return {
        items: [activeDefinition],
        totalCount: 2,
        hasMore: true,
        nextCursor: "page-2",
        catalogReleaseId: CATALOG_RELEASE_ID
      };
    });

    const rows = await listAllCanonicalPages(listDefinitions, {
      lifecycle: "active", registration: "active", limit: 50
    });

    expect(queries).toEqual([
      { lifecycle: "active", registration: "active", limit: 50 },
      { lifecycle: "active", registration: "active", limit: 50, cursor: "page-2" }
    ]);
    expect(rows.map((row) => row.propertyKey)).toEqual(["gpio-int", "extra_119"]);
    expect(rows[0]?.id).toBe(activeDefinition.id);
    expect(rows[0]?.currentRevision).toEqual(activeDefinition.currentRevision);
    expect(rows[0]?.currentRevision.valueShape).toEqual(activeDefinition.currentRevision.valueShape);
    expect(rows[0]?.registration).toEqual(activeDefinition.registration);
  });

  it("stops instead of looping when a canonical cursor repeats", async () => {
    const fetchPage = vi.fn(async (query: CatalogListQuery) => ({
      items: [],
      totalCount: 0,
      hasMore: true,
      nextCursor: query.cursor ?? "page-1",
      catalogReleaseId: CATALOG_RELEASE_ID
    }));

    await expect(listAllCanonicalPages(fetchPage, { limit: 50 })).rejects.toThrow(
      "无效分页游标"
    );
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });
});
