import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CATALOG_MODULE_ID,
  CATALOG_ORGANIZATION_ID,
  CATALOG_RELEASE_ID,
  catalogRegistration,
  readyCatalogDocument,
  registeredSubject,
  unregisteredSubject
} from "@/application/parameter-catalog/fixtures";
import type { ParameterCatalogRepository } from "@/application/ports/ParameterCatalogRepository";
import type { ParameterCatalogGovernanceRepository } from "@/application/ports/ParameterCatalogGovernanceRepository";
import { EMPTY_PARAMETER_MODULE_REGISTRY } from "@/domain/parameter-topology/moduleRegistry";
import { createTestModuleRegistryRepository } from "@/test/harness";
import { ParameterModuleMappingPanel } from "./ParameterModuleMappingPanel";

afterEach(() => cleanup());

describe("historical registry isolation", () => {
  it("keeps discovery separate from the subject list and restores subjects when returning to modules", async () => {
    const subjects = [
      { ...registeredSubject, canonicalName: "acme,power" },
      { ...unregisteredSubject, id: "subject_config", type: "configuration-schema" as const, canonicalName: "wiseeff.issue897.settings" },
      { ...unregisteredSubject, id: "subject_node", type: "node-type" as const, canonicalName: "issue897-node" }
    ];
    const catalog = {
      getCatalog: vi.fn().mockResolvedValue(readyCatalogDocument),
      listSubjects: vi.fn().mockResolvedValue({
        items: subjects, totalCount: 3, hasMore: false, nextCursor: null,
        catalogReleaseId: CATALOG_RELEASE_ID
      })
    } as unknown as ParameterCatalogRepository;
    const governance = {
      listRegistrations: vi.fn().mockResolvedValue({
        items: [catalogRegistration], totalCount: 1, hasMore: false, nextCursor: null,
        catalogReleaseId: CATALOG_RELEASE_ID
      }),
      listDriverCompatibleDiscovery: vi.fn().mockResolvedValue({
        status: "ready", catalogRelease: { id: CATALOG_RELEASE_ID, digest: "sha256:one" },
        matcherRevision: "matcher_one", items: [], nextCursor: null,
        ignoredReviewItemCount: 0, emptyReason: "no-observations"
      })
    } as unknown as ParameterCatalogGovernanceRepository;
    const props = {
      repository: createTestModuleRegistryRepository(), canonicalEnabled: true, canAdmin: true,
      canonicalActor: "org-admin" as const,
      canonicalCatalog: catalog, canonicalGovernance: governance,
      canonicalOrganizationId: CATALOG_ORGANIZATION_ID, onNavigate: vi.fn()
    };
    const view = render(<ParameterModuleMappingPanel {...props} />);
    expect(await screen.findByText("acme,power", { exact: true })).toBeVisible();
    await userEvent.click(screen.getByRole("tab", { name: "来源识别" }));
    expect(props.onNavigate).toHaveBeenLastCalledWith("/parameter-admin/modules?tab=queue");
    view.rerender(<ParameterModuleMappingPanel {...props} search="?tab=queue" />);
    expect(screen.queryByRole("list", { name: "规范主体列表" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "打开待审核事项" }))
      .toHaveAttribute("href", "/parameter-admin/specs?review=open");
    view.rerender(<div>Catalog</div>);
    view.rerender(<ParameterModuleMappingPanel {...props} search="?tab=queue" />);
    expect(await screen.findByRole("region", { name: "来源识别结果" })).toBeVisible();
    expect(screen.queryByRole("list", { name: "规范主体列表" })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "来源识别" })).toHaveAttribute("aria-selected", "true");
    view.rerender(<ParameterModuleMappingPanel {...props} />);
    const subjectsList = await screen.findByRole("list", { name: "规范主体列表" });
    for (const subject of subjects) {
      expect(within(subjectsList).getByText(subject.canonicalName, { exact: true })).toBeVisible();
    }
    expect(screen.getByRole("button", { name: "调整归属：acme,power", exact: true })).toBeVisible();
    expect(screen.queryByRole("region", { name: "来源识别结果" })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "模块" })).toHaveAttribute("aria-selected", "true");
  });

  it.each(["ready history", "failed history"])(
    "renders the canonical tree and registrations independently of %s",
    async (scenario) => {
      const registry = {
        modules: [{
          id: CATALOG_MODULE_ID, name: "规范驱动组", parentId: null,
          sortOrder: 0, description: "", scope: "organization", importance: "medium" as const,
          kind: "driver-group" as const, origin: "curated" as const, sourceKey: null,
          attributionSubjectId: null,
          effectiveImportance: "medium" as const, parameterCount: 2, definitionCount: 14
        }],
        mappings: [], navigationOnly: true
      };
      let rejectHistory!: (error: Error) => void;
      const pendingHistory = new Promise<never>((_resolve, reject) => { rejectHistory = reject; });
      const repository = createTestModuleRegistryRepository({
        getRegistry: vi.fn().mockResolvedValue(registry),
        getDiscoveryHints: vi.fn(),
        listDriverRegistry: vi.fn().mockReturnValue(
          scenario === "failed history" ? pendingHistory : Promise.resolve({ items: [] })
        )
      });
      const catalog = {
        getCatalog: vi.fn().mockResolvedValue(readyCatalogDocument),
        listSubjects: vi.fn().mockResolvedValue({
          items: [registeredSubject], totalCount: 1, hasMore: false, nextCursor: null,
          catalogReleaseId: CATALOG_RELEASE_ID
        })
      } as unknown as ParameterCatalogRepository;
      const governance = {
        listRegistrations: vi.fn().mockResolvedValue({
          items: [catalogRegistration], totalCount: 1, hasMore: false, nextCursor: null,
          catalogReleaseId: CATALOG_RELEASE_ID
        }),
        listDriverCompatibleDiscovery: vi.fn().mockResolvedValue({
          status: "ready", catalogRelease: { id: CATALOG_RELEASE_ID, digest: "sha256:one" },
          matcherRevision: "matcher_one", items: [{
            observationId: "obs_retired_overlay", projectId: "project_one", logicalNodeId: "node_one",
            configRevisionId: "revision_one", observedCatalogReleaseId: CATALOG_RELEASE_ID,
            observedMatcherRevision: "matcher_one",
            source: { status: "current", configSetId: "config_one", sourceName: "device.dts",
              fileVersionId: "version_one", sourceDigest: "sha256:source", revisionDigest: "sha256:revision" },
            compatibles: [{ compatible: "vendor,device", candidate: {
              kind: "review-required", reason: "unknown", reviewItemIds: []
            } }]
          }], nextCursor: null, ignoredReviewItemCount: 0
        })
      } as unknown as ParameterCatalogGovernanceRepository;
      render(<ParameterModuleMappingPanel repository={repository} canonicalEnabled canAdmin
        canonicalCatalog={catalog} canonicalGovernance={governance}
        canonicalOrganizationId={CATALOG_ORGANIZATION_ID} />);

      const canonical = await screen.findByRole("region", { name: "规范主体归属" });
      expect(await within(canonical).findByText(registeredSubject.canonicalName)).toBeInTheDocument();
      expect(canonical).toHaveTextContent("归属：规范驱动组");
      expect(canonical).toHaveTextContent("14 个有效定义");
      expect(screen.getByRole("treeitem", { name: /规范驱动组/ })).toBeInTheDocument();
      expect(screen.queryByText("没有匹配的模块。")).not.toBeInTheDocument();
      expect(screen.queryByText("正在加载模块注册表…")).not.toBeInTheDocument();
      expect(repository.getDiscoveryHints).not.toHaveBeenCalled();
      await userEvent.click(screen.getByRole("tab", { name: "来源识别" }));
      expect(await screen.findByText("vendor,device")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "编写覆盖解析" })).not.toBeInTheDocument();
      expect(screen.getByRole("link", { name: "打开待审核事项" }))
        .toHaveAttribute("href", "/parameter-admin/specs?review=open");

      if (scenario === "failed history") {
        await userEvent.click(screen.getByRole("tab", { name: "历史注册表" }));
        const historical = screen.getByRole("region", { name: "历史驱动注册表" });
        expect(historical).toHaveAttribute("aria-busy", "true");
        rejectHistory(new Error("historical registry unavailable"));
        expect(await within(historical).findByRole("alert")).toHaveTextContent("无法加载历史驱动注册表，请重试。");
        expect(screen.getAllByRole("alert")).toHaveLength(1);
        expect(screen.queryByRole("region", { name: "规范主体归属" })).not.toBeInTheDocument();
        await userEvent.click(screen.getByRole("tab", { name: "模块" }));
        const restored = await screen.findByRole("region", { name: "规范主体归属" });
        expect(await within(restored).findByText(registeredSubject.canonicalName)).toBeVisible();
        expect(restored).toHaveTextContent("归属：规范驱动组");
        expect(screen.getByRole("treeitem", { name: /规范驱动组/ })).toBeInTheDocument();
      }
    }
  );

  it("renders canonical subjects and counts while history loads, fails and retries independently", async () => {
    let rejectHistory!: (error: Error) => void;
    const pendingHistory = new Promise<never>((_resolve, reject) => { rejectHistory = reject; });
    const listDriverRegistry = vi.fn()
      .mockReturnValueOnce(pendingHistory)
      .mockReturnValueOnce(pendingHistory)
      .mockResolvedValue({ items: [] });
    const getRegistry = vi.fn().mockResolvedValue(EMPTY_PARAMETER_MODULE_REGISTRY);
    const getDiscoveryHints = vi.fn();
    const repository = createTestModuleRegistryRepository({
      getRegistry, getDiscoveryHints, listDriverRegistry
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
    await userEvent.click(screen.getByRole("tab", { name: "历史注册表" }));
    const historical = screen.getByRole("region", { name: "历史驱动注册表" });
    expect(historical).toHaveAttribute("aria-busy", "true");

    rejectHistory(new Error("historical registry unavailable"));
    expect(await within(historical).findByRole("alert")).toHaveTextContent("无法加载历史驱动注册表，请重试。");
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.queryByRole("region", { name: "规范主体归属" })).not.toBeInTheDocument();

    fireEvent.click(within(historical).getByRole("button", { name: "重试历史驱动注册表" }));
    await waitFor(() => expect(historical).toHaveAttribute("aria-busy", "false"));
    expect(within(historical).queryByRole("alert")).not.toBeInTheDocument();
    expect(listDriverRegistry).toHaveBeenCalledTimes(3);
    expect(getRegistry).toHaveBeenCalledTimes(1);
    expect(listSubjects).toHaveBeenCalledTimes(1);
    expect(getDiscoveryHints).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("tab", { name: "模块" }));
    const restored = await screen.findByRole("region", { name: "规范主体归属" });
    expect(await within(restored).findByText(unregisteredSubject.canonicalName)).toBeVisible();
    expect(restored).toHaveTextContent("1 个有效主体");
  });
});
