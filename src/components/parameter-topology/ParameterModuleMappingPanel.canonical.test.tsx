import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EMPTY_PARAMETER_MODULE_REGISTRY } from "@/domain/parameter-topology/moduleRegistry";
import type { ParameterCatalogGovernanceRepository } from "@/application/ports/ParameterCatalogGovernanceRepository";
import type { ParameterCatalogRepository } from "@/application/ports/ParameterCatalogRepository";
import { createTestModuleRegistryRepository } from "@/test/harness";
import { ParameterModuleMappingPanel } from "./ParameterModuleMappingPanel";

vi.mock("@/components/parameter-admin-next/CanonicalSubjectPlacementPanel", () => ({
  CanonicalSubjectPlacementPanel: ({ onChanged }: { onChanged: () => Promise<void> }) =>
    <button type="button" onClick={() => void onChanged()}>完成规范登记</button>
}));

describe("canonical module page request boundary", () => {
  it.each(["driver-group", "node-type"] as const)("keeps historical %s name/details read-only with a canonical handoff", async (moduleKind) => {
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

    expect(await screen.findByText(/当前来源：device.dts/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("region", { name: "历史驱动注册表" }))
      .toHaveAttribute("aria-busy", "false"));
    fireEvent.click(screen.getByRole("button", { name: "修改模块 Historical driver" }));
    const dialog = screen.getByRole("dialog", { name: "Historical driver" });
    if (moduleKind === "driver-group") {
      expect(within(dialog).getByLabelText("驱动性质")).toHaveAttribute("readonly");
      expect(within(dialog).getByLabelText("实例基数")).toHaveAttribute("readonly");
      expect(within(dialog).getByText("vendor,device")).toBeInTheDocument();
    }
    for (const label of ["模块名称", "模块展示描述", "适用范围"]) {
      expect(within(dialog).getByLabelText(label)).toHaveAttribute("readonly");
      fireEvent.change(within(dialog).getByLabelText(label), { target: { value: "Forbidden legacy edit" } });
    }
    expect(within(dialog).queryByRole("button", { name: "保存" })).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "管理规范主体与归属" })).toBeInTheDocument();
    expect(within(dialog).queryByLabelText("默认业务分类")).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "从注册回放放置" })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: /移除|添加 compatible/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /编写覆盖解析|配置组织级解析|全量重算/ })).not.toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "管理规范主体与归属" }));
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
    expect(await screen.findByText("当前范围没有来源观察记录。")).toBeInTheDocument();
    expect(getDiscoveryHints).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "刷新发现" }));
    await waitFor(() => expect(listDriverCompatibleDiscovery).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole("button", { name: "完成规范登记" }));
    await waitFor(() => expect(listDriverCompatibleDiscovery).toHaveBeenCalledTimes(3));
    expect(getRegistry).toHaveBeenCalledTimes(2);
    expect(getDiscoveryHints).not.toHaveBeenCalled();
    expect(repository.createMapping).not.toHaveBeenCalled();
    expect(repository.recomputeBindings).not.toHaveBeenCalled();
    expect(repository.dismissCompatible).not.toHaveBeenCalled();
    expect(repository.restoreDismissedCompatible).not.toHaveBeenCalled();
  });
});
