import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CATALOG_ORGANIZATION_ID,
  CATALOG_RELEASE_ID,
  readyCatalogDocument,
  unregisteredSubject
} from "@/application/parameter-catalog/fixtures";
import type { ParameterCatalogRepository } from "@/application/ports/ParameterCatalogRepository";
import type { ParameterCatalogGovernanceRepository } from "@/application/ports/ParameterCatalogGovernanceRepository";
import { EMPTY_PARAMETER_MODULE_REGISTRY } from "@/domain/parameter-topology/moduleRegistry";
import { createTestModuleRegistryRepository } from "@/test/harness";
import { ParameterModuleMappingPanel } from "./ParameterModuleMappingPanel";

afterEach(() => cleanup());

describe("historical registry isolation", () => {
  it("renders canonical subjects and counts while history loads, fails and retries independently", async () => {
    let rejectHistory!: (error: Error) => void;
    const pendingHistory = new Promise<never>((_resolve, reject) => { rejectHistory = reject; });
    const listDriverRegistry = vi.fn()
      .mockReturnValueOnce(pendingHistory)
      .mockResolvedValue({ items: [] });
    const getRegistry = vi.fn().mockResolvedValue(EMPTY_PARAMETER_MODULE_REGISTRY);
    const getDiscoveryHints = vi.fn();
    const repository = createTestModuleRegistryRepository({
      getRegistry, getDiscoveryHints, listDriverRegistry,
      listOrganizationDriverSchemas: vi.fn().mockResolvedValue([])
    });
    const listSubjects = vi.fn().mockResolvedValue({
      items: [unregisteredSubject], totalCount: 1, hasMore: false, nextCursor: null,
      catalogReleaseId: CATALOG_RELEASE_ID
    });
    const catalog = {
      getCatalog: vi.fn().mockResolvedValue(readyCatalogDocument), listSubjects
    } as unknown as ParameterCatalogRepository;
    const governance = {
      listRegistrations: vi.fn().mockResolvedValue({
        items: [], totalCount: 0, hasMore: false, nextCursor: null, catalogReleaseId: CATALOG_RELEASE_ID
      }),
      listDriverCompatibleDiscovery: vi.fn().mockResolvedValue({
        status: "ready", catalogRelease: { id: CATALOG_RELEASE_ID, digest: "sha256:one" },
        matcherRevision: "matcher_one", items: [], nextCursor: null,
        ignoredReviewItemCount: 0, emptyReason: "no-observations"
      })
    } as unknown as ParameterCatalogGovernanceRepository;
    render(<ParameterModuleMappingPanel repository={repository} canonicalEnabled
      canonicalCatalog={catalog} canonicalGovernance={governance}
      canonicalOrganizationId={CATALOG_ORGANIZATION_ID} />);

    const canonical = await screen.findByRole("region", { name: "规范主体归属" });
    expect(await within(canonical).findByText(unregisteredSubject.canonicalName)).toBeInTheDocument();
    expect(canonical).toHaveTextContent("1 个有效主体");
    expect(canonical).toHaveTextContent(`${unregisteredSubject.definitionCounts.active} 个有效定义`);
    const historical = screen.getByRole("region", { name: "历史驱动注册表" });
    expect(historical).toHaveAttribute("aria-busy", "true");

    rejectHistory(new Error("historical registry unavailable"));
    expect(await within(historical).findByRole("alert")).toHaveTextContent("无法加载历史驱动注册表，请重试。");
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(within(canonical).queryByRole("alert")).not.toBeInTheDocument();
    expect(canonical).toHaveTextContent(unregisteredSubject.canonicalName);
    expect(canonical).toHaveTextContent("1 个有效主体");

    fireEvent.click(within(historical).getByRole("button", { name: "重试历史驱动注册表" }));
    await waitFor(() => expect(historical).toHaveAttribute("aria-busy", "false"));
    expect(within(historical).queryByRole("alert")).not.toBeInTheDocument();
    expect(listDriverRegistry).toHaveBeenCalledTimes(2);
    expect(getRegistry).toHaveBeenCalledTimes(1);
    expect(listSubjects).toHaveBeenCalledTimes(1);
    expect(getDiscoveryHints).not.toHaveBeenCalled();
    expect(canonical).toHaveTextContent("1 个有效主体");
  });
});
