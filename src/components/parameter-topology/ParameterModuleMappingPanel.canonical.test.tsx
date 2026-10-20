import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { EMPTY_PARAMETER_MODULE_REGISTRY } from "@/domain/parameter-topology/moduleRegistry";
import type { ParameterCatalogGovernanceRepository } from "@/application/ports/ParameterCatalogGovernanceRepository";
import type { ParameterCatalogRepository } from "@/application/ports/ParameterCatalogRepository";
import { createTestModuleRegistryRepository } from "@/test/harness";
import { ParameterModuleMappingPanel } from "./ParameterModuleMappingPanel";

vi.mock("@/components/parameter-admin-next/CanonicalSubjectPlacementPanel", () => ({
  CanonicalSubjectPlacementPanel: ({ onChanged, selectedModuleId }: { onChanged: () => Promise<void>; selectedModuleId?: string | null }) =>
    <button type="button" data-selected-module={selectedModuleId} onClick={() => void onChanged()}>完成规范登记</button>
}));

describe("canonical module page request boundary", () => {
  it("selects a module, retains URL context across tabs, and isolates the discovery task", async () => {
    const module = { id: "power", name: "电源", parentId: null, sortOrder: 0, description: "", scope: "organization",
      importance: "medium" as const, effectiveImportance: "medium" as const, kind: "business" as const,
      origin: "curated" as const, sourceKey: null, parameterCount: 0, definitionCount: 0 };
    const repository = createTestModuleRegistryRepository({ getRegistry: vi.fn().mockResolvedValue({ modules: [module], mappings: [] }) });
    const onNavigate = vi.fn();
    render(<ParameterModuleMappingPanel repository={repository} canonicalEnabled search="?q=vendor"
      onNavigate={onNavigate} canonicalCatalog={{} as ParameterCatalogRepository}
      canonicalGovernance={{ listDriverCompatibleDiscovery: vi.fn().mockResolvedValue({ status: "ready",
        catalogRelease: { id: "release", digest: "digest" }, matcherRevision: "matcher", items: [], nextCursor: null,
        ignoredReviewItemCount: 0 }) } as unknown as ParameterCatalogGovernanceRepository} canonicalOrganizationId="org" />);
    const selection = await screen.findByRole("button", { name: "查看模块：电源" });
    fireEvent.click(selection);
    expect(selection).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "完成规范登记" })).toHaveAttribute("data-selected-module", "power");
    expect(onNavigate).toHaveBeenLastCalledWith("/parameter-admin/modules?q=vendor&moduleId=power");
    await userEvent.click(screen.getByRole("tab", { name: "来源识别" }));
    expect(onNavigate).toHaveBeenLastCalledWith("/parameter-admin/modules?q=vendor&moduleId=power&tab=queue");
    expect(screen.queryByRole("button", { name: "全部模块" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "模块" }));
    fireEvent.keyDown(screen.getByRole("button", { name: "查看模块：电源" }).closest('[role="treeitem"]')!, { key: "Enter" });
    expect(onNavigate).toHaveBeenLastCalledWith("/parameter-admin/modules?q=vendor");
  });
  it("connects tree URL state without dropping subject and module context", async () => {
    const module = { id: "power", name: "电源", parentId: null, sortOrder: 0, description: "", scope: "organization",
      importance: "medium" as const, effectiveImportance: "medium" as const, kind: "business" as const,
      origin: "curated" as const, sourceKey: null, parameterCount: 0, definitionCount: 0 };
    const onNavigate = vi.fn();
    render(<ParameterModuleMappingPanel repository={createTestModuleRegistryRepository({ getRegistry: vi.fn().mockResolvedValue({ modules: [module], mappings: [] }) })}
      search="?moduleId=power&subjectQ=vendor&treeQ=电源" onNavigate={onNavigate} />);
    const search = await screen.findByRole("searchbox", { name: "搜索模块" });
    expect(search).toHaveValue("电源");
    fireEvent.change(search, { target: { value: "充电" } });
    await waitFor(() => expect(onNavigate).toHaveBeenCalled());
    const href = new URL(onNavigate.mock.calls.at(-1)![0], "http://localhost");
    expect(href.searchParams.get("treeQ")).toBe("充电");
    expect(href.searchParams.get("moduleId")).toBe("power");
    expect(href.searchParams.get("subjectQ")).toBe("vendor");
  });
  it("restores the bookmarked module after navigating forward and back", async () => {
    const module = { id: "power", name: "电源", parentId: null, sortOrder: 0, description: "", scope: "organization",
      importance: "medium" as const, effectiveImportance: "medium" as const, kind: "business" as const,
      origin: "curated" as const, sourceKey: null, parameterCount: 0, definitionCount: 0 };
    const props = { repository: createTestModuleRegistryRepository({ getRegistry: vi.fn().mockResolvedValue({ modules: [module,
      { ...module, id: "battery", name: "电池" }], mappings: [] }) }), canonicalEnabled: true,
      canonicalCatalog: {} as ParameterCatalogRepository, canonicalGovernance: {} as ParameterCatalogGovernanceRepository,
      canonicalOrganizationId: "org", onNavigate: vi.fn() };
    const view = render(<ParameterModuleMappingPanel {...props} search="?moduleId=power" />);
    await userEvent.click(await screen.findByRole("button", { name: "查看模块：电池" }));
    view.rerender(<ParameterModuleMappingPanel {...props} search="?moduleId=battery" />);
    expect(screen.getByRole("button", { name: "查看模块：电池" })).toHaveAttribute("aria-pressed", "true");
    view.rerender(<ParameterModuleMappingPanel {...props} search="?moduleId=power" />);
    expect(screen.getByRole("button", { name: "查看模块：电源" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "查看模块：电池" })).toHaveAttribute("aria-pressed", "false");
  });
  it.each(["driver-group", "node-type"] as const)("allows direct %s edits alongside a canonical handoff", async (moduleKind) => {
    const registry = {
      modules: [{
        id: "mod_driver", name: "Historical driver", parentId: null, sortOrder: 0,
        description: "", scope: "organization", importance: "medium" as const,
        kind: moduleKind, origin: "curated" as const, sourceKey: null,
        effectiveImportance: "medium" as const, parameterCount: 2, definitionCount: 1
      }],
      mappings: [], navigationOnly: true
    };
    const retiredWrites = {
      updateDriverRegistration: vi.fn(), updateDriverRegistrationDefault: vi.fn(),
      replayDriverPlacement: vi.fn(), registerOrClaimDriver: vi.fn(),
      createMapping: vi.fn(), deleteMapping: vi.fn(), dismissCompatible: vi.fn(),
      restoreDismissedCompatible: vi.fn(), recomputeBindings: vi.fn()
    };
    const repository = { ...createTestModuleRegistryRepository({
      getRegistry: vi.fn().mockResolvedValue(registry),
      updateModule: vi.fn().mockResolvedValue(registry),
      listDriverRegistry: vi.fn().mockResolvedValue({ items: moduleKind === "driver-group" ? [{
        moduleId: "mod_driver", name: "Historical driver", origin: "curated",
        businessCategoryId: null, businessCategoryName: null, defaultBusinessCategoryId: null,
        compatibles: ["vendor,device"], parameterCount: 2, observed: true, notYetObserved: false,
        driverNature: "physical-device", instanceCardinality: "multiple",
        parseCoverages: [{ compatible: "vendor,device", coverage: { covered: false } }]
      }] : [], total: moduleKind === "driver-group" ? 1 : 0 })
    }), ...retiredWrites };
    const listDriverCompatibleDiscovery = vi.fn().mockResolvedValue({
      status: "ready", catalogRelease: { id: "crel_one", digest: "sha256:one" },
      matcherRevision: "matcher_one", nextCursor: null, ignoredReviewItemCount: 0,
      items: [{ observationId: "obs_one", projectId: "project_one", logicalNodeId: "node_one",
        source: { status: "current", sourceName: "device.dts", fileVersionId: "version_one" },
        compatibles: [{ compatible: "vendor,device", candidate: { kind: "recognized",
          subjectId: "subject_one", registrationId: "registration_one" } }] }]
    });
    render(<ParameterModuleMappingPanel canAdmin repository={repository} canonicalEnabled
      canonicalCatalog={{} as ParameterCatalogRepository}
      canonicalGovernance={{ listDriverCompatibleDiscovery } as unknown as ParameterCatalogGovernanceRepository}
      canonicalOrganizationId="org_one" />);

    expect(listDriverCompatibleDiscovery).not.toHaveBeenCalled();
    await userEvent.click(await screen.findByRole("tab", { name: "来源识别" }));
    expect(await screen.findByText(/当前来源：device.dts/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "历史注册表" }));
    await waitFor(() => expect(screen.getByRole("region", { name: "历史驱动注册表" }))
      .toHaveAttribute("aria-busy", "false"));
    expect(screen.queryByRole("tree", { name: "模块归属树" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "模块" }));
    fireEvent.click(await screen.findByRole("button", { name: "修改模块 Historical driver" }));
    const dialog = screen.getByRole("dialog", { name: "Historical driver" });
    if (moduleKind === "driver-group") {
      expect(within(dialog).getByLabelText("驱动性质")).toBeEnabled();
      expect(within(dialog).getByLabelText("实例基数")).toBeEnabled();
      expect(within(dialog).getByLabelText("compatible 匹配规则")).toHaveValue("vendor,device");
    }
    for (const label of ["模块名称", "模块展示描述", "适用范围"]) {
      expect(within(dialog).getByLabelText(label)).not.toHaveAttribute("readonly");
    }
    expect(within(dialog).queryByRole("button", { name: "保存" })).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "管理规范主体与归属" })).toBeInTheDocument();
    expect(within(dialog).queryByLabelText("默认业务分类")).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "从注册回放放置" })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: /移除|添加 compatible/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /编写覆盖解析|配置组织级解析|全量重算/ })).not.toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "管理规范主体与归属" }));
    expect(screen.getByRole("tab", { name: "模块" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(repository.updateModule).not.toHaveBeenCalled();
    for (const retiredWrite of Object.values(retiredWrites)) {
      expect(retiredWrite).not.toHaveBeenCalled();
    }
  });

  it("uses canonical discovery on load, refresh and placement change without legacy hints or mapping writes", async () => {
    const getRegistry = vi.fn().mockResolvedValue(EMPTY_PARAMETER_MODULE_REGISTRY);
    const getDiscoveryHints = vi.fn();
    const listDriverRegistry = vi.fn().mockResolvedValue({ items: [] });
    const repository = { ...createTestModuleRegistryRepository({ getRegistry, listDriverRegistry }), getDiscoveryHints,
      recomputeBindings: vi.fn(), createMapping: vi.fn(), deleteMapping: vi.fn(),
      dismissCompatible: vi.fn(), restoreDismissedCompatible: vi.fn() };
    const listDriverCompatibleDiscovery = vi.fn().mockResolvedValue({
      status: "ready", catalogRelease: { id: "crel_one", digest: "sha256:one" },
      matcherRevision: "matcher_one", items: [], nextCursor: null,
      ignoredReviewItemCount: 0, emptyReason: "no-observations"
    });
    render(<ParameterModuleMappingPanel canAdmin repository={repository} canonicalEnabled
      canonicalCatalog={{} as ParameterCatalogRepository}
      canonicalGovernance={{ listDriverCompatibleDiscovery } as unknown as ParameterCatalogGovernanceRepository}
      canonicalOrganizationId="org_one" />);
    await screen.findByRole("button", { name: "完成规范登记" });
    expect(listDriverCompatibleDiscovery).not.toHaveBeenCalled();
    expect(getDiscoveryHints).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("tab", { name: "来源识别" }));
    expect(await screen.findByText("当前范围没有来源观察记录。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    await waitFor(() => expect(listDriverCompatibleDiscovery).toHaveBeenCalledTimes(2));
    await userEvent.click(screen.getByRole("tab", { name: "模块" }));
    fireEvent.click(screen.getByRole("button", { name: "完成规范登记" }));
    await waitFor(() => expect(getRegistry).toHaveBeenCalledTimes(3));
    expect(listDriverCompatibleDiscovery).toHaveBeenCalledTimes(2);
    expect(getDiscoveryHints).not.toHaveBeenCalled();
    expect(repository.createMapping).not.toHaveBeenCalled();
    expect(repository.recomputeBindings).not.toHaveBeenCalled();
    expect(repository.dismissCompatible).not.toHaveBeenCalled();
    expect(repository.restoreDismissedCompatible).not.toHaveBeenCalled();
  });
});
