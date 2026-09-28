import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EMPTY_PARAMETER_MODULE_REGISTRY } from "@/domain/parameter-topology/moduleRegistry";
import type { ParameterCatalogGovernanceRepository } from "@/application/ports/ParameterCatalogGovernanceRepository";
import type { ParameterCatalogRepository } from "@/application/ports/ParameterCatalogRepository";
import type { ParameterModuleRegistryRepository } from "@/application/ports/ParameterModuleRegistryRepository";
import { ParameterModuleMappingPanel } from "./ParameterModuleMappingPanel";

vi.mock("@/components/parameter-admin-next/CanonicalSubjectPlacementPanel", () => ({
  CanonicalSubjectPlacementPanel: ({ onChanged }: { onChanged: () => Promise<void> }) =>
    <button type="button" onClick={() => void onChanged()}>完成规范登记</button>
}));

describe("canonical module page request boundary", () => {
  it("uses canonical discovery on load, refresh and placement change without legacy hints or mapping writes", async () => {
    const getRegistry = vi.fn().mockResolvedValue(EMPTY_PARAMETER_MODULE_REGISTRY);
    const getDiscoveryHints = vi.fn();
    const listDriverRegistry = vi.fn().mockResolvedValue({ items: [] });
    const repository = { getRegistry, getDiscoveryHints, listDriverRegistry,
      listOrganizationDriverSchemas: vi.fn().mockResolvedValue([]),
      recomputeBindings: vi.fn(), createMapping: vi.fn(), deleteMapping: vi.fn(),
      dismissCompatible: vi.fn(), restoreDismissedCompatible: vi.fn() } as unknown as ParameterModuleRegistryRepository;
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
