import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle } from "lucide-react";

import { presentError } from "@/infrastructure/http/presentError";
import type { CatalogActorKind } from "@/application/parameter-catalog/authority";
import type { ParameterCatalogGovernanceRepository } from "@/application/ports/ParameterCatalogGovernanceRepository";
import type { ParameterCatalogRepository } from "@/application/ports/ParameterCatalogRepository";
import {
  buildParameterAdminModulesPath,
  parseParameterAdminModulesSubView,
  type ParameterAdminModulesSubView
} from "@/application/parameters/parameterAdminOrganizationPath";
import { PARAMETER_ADMIN_UI } from "@/application/parameters/parameterAdminUiCopy";
import type {
  DriverRegistryEntry,
  ParameterModuleRegistryRepository
} from "@/application/ports/ParameterModuleRegistryRepository";
import { ModuleAttributionTree } from "@/components/parameter-topology/ModuleAttributionTree";
import {
  summarizeDriverCoverage, MODULE_TREE_QUERY_KEYS
} from "@/components/parameter-topology/moduleAttributionTreeUtils";
import {
  EMPTY_PARAMETER_MODULE_REGISTRY,
  type ParameterModuleRegistry
} from "@/domain/parameter-topology/moduleRegistry";
import { createHttpParameterModuleRegistryRepository } from "@/infrastructure/http/parameterModuleRegistryClient";
import { CanonicalSubjectPlacementPanel } from "@/components/parameter-admin-next/CanonicalSubjectPlacementPanel";
import { CanonicalDriverDiscovery } from "@/components/parameter-admin-next/CanonicalDriverDiscovery";
import { NavigatorWorkbench } from "@/components/layout/NavigatorWorkbench";
import { ViewSwitch } from "@/components/ui/view-switch";
import { Button } from "@/components/ui/button";
import { SectionEmpty, SectionSkeleton } from "@/components/common/SectionState";
import { AdminListPage } from "@/components/layout/AdminListPage";
import { SelectControl } from "@/components/common/SelectControl";
import { ModalDialog } from "@/components/common/ModalDialog";
import type { Project } from "@/domain/prototype/types";
import { formatDriverNatureLabel, formatInstanceCardinalityLabel } from "@/application/parameters/driverRegistrationLabels";
import { collectSubtreeModuleIds } from "@/domain/modules/moduleTree";
import { toAttributionFlatNodes } from "@/components/parameter-topology/moduleAttributionTreeUtils";
import "./module-governance.css";

const moduleTabs = [
  { value: "tree", label: "模块", id: "module-governance-tab-tree", panelId: "module-governance-panel" },
  { value: "queue", label: "来源识别", id: "module-governance-tab-queue", panelId: "module-governance-panel" },
  { value: "registry", label: "历史注册表", id: "module-governance-tab-registry", panelId: "module-governance-panel" }
] as const;

export type ParameterModuleMappingPanelProps = {
  canAdmin?: boolean;
  canManageTaxonomy?: boolean;
  repository?: ParameterModuleRegistryRepository;
  pathname?: string;
  search?: string;
  onNavigate?: (path: string, options?: { replace?: boolean }) => void;
  /** Canonical subject/placement seam; absent in mock mode. */
  canonicalCatalog?: ParameterCatalogRepository;
  canonicalGovernance?: ParameterCatalogGovernanceRepository;
  canonicalOrganizationId?: string;
  canonicalActor?: CatalogActorKind;
  canonicalSessionPermissions?: readonly string[] | null;
  canonicalEnabled?: boolean;
  projects?: readonly Project[];
};

/**
 * Organization business taxonomy with read-only historical driver attribution.
 */
export function ParameterModuleMappingPanel({
  canAdmin = false,
  canManageTaxonomy = canAdmin,
  repository,
  pathname = "/parameter-admin/modules",
  search = "",
  onNavigate,
  canonicalCatalog,
  canonicalGovernance,
  canonicalOrganizationId,
  canonicalActor = "user",
  canonicalSessionPermissions,
  canonicalEnabled = false,
  projects = []
}: ParameterModuleMappingPanelProps) {
  const client = useMemo(
    () => repository ?? createHttpParameterModuleRegistryRepository(),
    [repository]
  );
  const [registry, setRegistry] = useState<ParameterModuleRegistry>(EMPTY_PARAMETER_MODULE_REGISTRY);
  const [driverRegistry, setDriverRegistry] = useState<DriverRegistryEntry[]>([]);
  const [driverRegistryLoading, setDriverRegistryLoading] = useState(false);
  const [driverRegistryError, setDriverRegistryError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [registryLoaded, setRegistryLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [canonicalDiscoveryRefresh, setCanonicalDiscoveryRefresh] = useState(0);
  const [registryRefresh, setRegistryRefresh] = useState(0);
  const [localSubView, setLocalSubView] = useState<{ location: string; value: ParameterAdminModulesSubView } | null>(null);
  const [localSelection, setLocalSelection] = useState<{ location: string; value: string | null } | null>(null);
  const selectedModuleId = localSelection?.location === pathname + search
    ? localSelection.value : new URLSearchParams(search).get("moduleId");
  const requestedSubView = parseParameterAdminModulesSubView(pathname, search) ?? "tree";
  const activeSubView = localSubView?.location === pathname + search ? localSubView.value : requestedSubView;
  const activeTab = moduleTabs.find((tab) => tab.value === activeSubView)!;
  const historyGeneration = useRef(0);
  const [historicalDetail, setHistoricalDetail] = useState<DriverRegistryEntry | null>(null);
  const [visibleModuleIds, setVisibleModuleIds] = useState<readonly string[] | null>(null);
  const visibleModuleScope = useMemo(() => visibleModuleIds === null ? null
    : [...collectSubtreeModuleIds(toAttributionFlatNodes(registry.modules), visibleModuleIds)], [registry.modules, visibleModuleIds]);
  const [createRootRequest, setCreateRootRequest] = useState(0);
  const [localHistorySearch, setLocalHistorySearch] = useState<{ location: string; params: string } | null>(null);
  useEffect(() => {
    setLocalSelection(null);
    setLocalHistorySearch(null);
  }, [pathname, search]);
  const historyParams = new URLSearchParams(localHistorySearch?.location === pathname + search ? localHistorySearch.params : search);
  const historyQuery = historyParams.get("historyQ") ?? "";
  const historyCategory = historyParams.get("historyCategory") ?? "all";
  const historyObserved = historyParams.get("historyObserved") ?? "all";
  const parsedHistoryPage = Number(historyParams.get("historyPage"));
  const historyPage = Number.isSafeInteger(parsedHistoryPage) && parsedHistoryPage > 0 ? parsedHistoryPage : 1;
  const updateHistorySearch = (patch: Record<string, string>) => {
    const params = new URLSearchParams(historyParams);
    for (const [key, value] of Object.entries(patch)) {
      if (value && value !== "all") params.set(key, value);
      else params.delete(key);
    }
    if (!("historyPage" in patch)) params.delete("historyPage");
    setLocalHistorySearch({ location: pathname + search, params: params.toString() });
    onNavigate?.(buildParameterAdminModulesPath("registry", params.toString()), { replace: true });
  };

  const refreshDriverRegistry = useCallback(async (isCancelled: () => boolean = () => false) => {
    const generation = ++historyGeneration.current;
    setDriverRegistryLoading(true);
    setDriverRegistryError(null);
    try {
      const list = await client.listDriverRegistry();
      if (!isCancelled() && generation === historyGeneration.current) setDriverRegistry(list.items);
    } catch (loadError) {
      if (!isCancelled() && generation === historyGeneration.current) {
        setDriverRegistry([]);
        setDriverRegistryError(presentError(loadError, "无法加载历史驱动注册表，请重试。"));
      }
    } finally {
      if (!isCancelled() && generation === historyGeneration.current) setDriverRegistryLoading(false);
    }
  }, [client]);

  useEffect(() => {
    if (activeSubView === "queue") return;
    let cancelled = false;
    void refreshDriverRegistry(() => cancelled);
    return () => { cancelled = true; };
  }, [refreshDriverRegistry, activeSubView]);

  useEffect(() => {
    if (activeSubView !== "tree") return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    client.getRegistry()
      .then((nextRegistry) => {
        if (cancelled) return;
        setRegistry(nextRegistry);

      })
      .catch((loadError) => {
        if (cancelled) return;
        setError(presentError(loadError, "无法加载模块注册表，请稍后重试。"));
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
          setRegistryLoaded(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [client, canonicalEnabled, registryRefresh, activeSubView]);
  const canonicalAvailable = Boolean(canonicalEnabled && canonicalCatalog && canonicalGovernance && canonicalOrganizationId);
  const selectTab = (value: ParameterAdminModulesSubView) => {
    const params = new URLSearchParams(search);
    if (selectedModuleId) params.set("moduleId", selectedModuleId);
    else params.delete("moduleId");
    if (onNavigate) onNavigate(buildParameterAdminModulesPath(value, params.toString()));
    else setLocalSubView({ location: pathname + search, value });
  };
  const selectModule = (value: string | null) => {
    if (value === selectedModuleId) value = null;
    setLocalSelection({ location: pathname + search, value });
    const params = new URLSearchParams(search);
    if (value) params.set("moduleId", value);
    else params.delete("moduleId");
    if (onNavigate) onNavigate(buildParameterAdminModulesPath("tree", params.toString()));
    else setLocalSubView({ location: pathname + search, value: "tree" });
  };
  const driverCoverage = useMemo(
    () => summarizeDriverCoverage(driverRegistry),
    [driverRegistry]
  );
  const driverRegistrationByModuleId = useMemo(() => {
    const map = new Map<
      string,
      {
        driverNature: DriverRegistryEntry["driverNature"];
        instanceCardinality: DriverRegistryEntry["instanceCardinality"];
        compatibles: string[];
      }
    >();
    for (const entry of driverRegistry) {
      map.set(entry.moduleId, {
        driverNature: entry.driverNature ?? null,
        instanceCardinality: entry.instanceCardinality ?? null,
        compatibles: entry.compatibles,
      });
    }
    return map;
  }, [driverRegistry]);

  useEffect(() => {
    if (!onNavigate) return;
    if (/^\/parameter-admin\/modules\/(queue|registry)\/?$/.test(pathname)) {
      onNavigate(buildParameterAdminModulesPath(requestedSubView, search), { replace: true });
    }
  }, [onNavigate, pathname, requestedSubView, search]);

  const refreshAfterCanonicalChange = async () => {
    try {
      setRegistry(await client.getRegistry());
      await refreshDriverRegistry();
    } catch (refreshError) {
      setError(presentError(refreshError, "登记已完成，模块摘要刷新失败，请重试刷新。"));
    }
  };

  const moduleTree = (
    <ModuleAttributionTree
      modules={registry.modules}
      selectedModuleId={selectedModuleId}
      onVisibleModuleIdsChange={setVisibleModuleIds}
      createRootRequest={createRootRequest}
      showRootCreateAction={false}
      search={search}
      onSearchChange={onNavigate ? (query) => {
        const params = new URLSearchParams(search);
        for (const key of MODULE_TREE_QUERY_KEYS) params.delete(key);
        for (const [key, value] of new URLSearchParams(query)) params.set(key, value);
        onNavigate(buildParameterAdminModulesPath("tree", params.toString()), { replace: true });
      } : undefined}
      onSelectModule={canonicalAvailable ? selectModule : undefined}
      mappings={registry.mappings}
      driverCoverage={driverCoverage}
      driverRegistrationByModuleId={driverRegistrationByModuleId}
      canonicalPlacementAvailable={Boolean(
        canonicalEnabled && canonicalCatalog && canonicalGovernance && canonicalOrganizationId
      )}
      onOpenCanonicalPlacement={
        canonicalEnabled && canonicalCatalog && canonicalGovernance && canonicalOrganizationId
          ? () => {
              selectTab("tree");
              window.requestAnimationFrame(() => {
                const panel = document.getElementById("canonical-subject-placement");
                panel?.scrollIntoView({ block: "start" });
                panel?.focus({ preventScroll: true });
              });
            }
          : undefined
      }
      canAdmin={canManageTaxonomy}
      busy={busy || loading}
      onUpdateModule={async (moduleId, patch) => {
        setBusy(true);
        setError(null);
        try {
          setRegistry(await client.updateModule(moduleId, patch));
        } catch (updateError) {
          setError(presentError(updateError, "更新模块失败，请稍后重试。"));
          throw updateError;
        } finally {
          setBusy(false);
        }
      }}
      onMove={async (moduleId, parentId) => {
        setBusy(true);
        setError(null);
        try {
          setRegistry(await client.updateModule(moduleId, { parentId }));
        } catch (moveError) {
          setError(presentError(moveError, "移动模块失败，请稍后重试。"));
          throw moveError;
        } finally {
          setBusy(false);
        }
      }}
      onDelete={async (moduleId) => {
        setBusy(true);
        setError(null);
        try {
          setRegistry(await client.deleteModule(moduleId));
          await refreshDriverRegistry();
        } catch (deleteError) {
          setError(presentError(deleteError, "删除模块失败，请稍后重试。"));
          throw deleteError;
        } finally {
          setBusy(false);
        }
      }}
      onCreateModule={async (input) => {
        setBusy(true);
        setError(null);
        try {
          setRegistry(
            await client.createModule({
              name: input.name,
              description: input.description,
              scope: input.scope,
              importance: input.importance,
              parentId: input.parentId,
              kind: "business",
              origin: "curated"
            })
          );
        } catch (createError) {
          setError(presentError(createError, "创建模块失败，请稍后重试。"));
          throw createError;
        } finally {
          setBusy(false);
        }
      }}
    />
  );

  const tabs = <ViewSwitch variant="tabs" ariaLabel="模块治理视图" value={activeSubView}
    onValueChange={(value) => selectTab(value as ParameterAdminModulesSubView)} items={[...moduleTabs]} />;
  const refresh = <Button type="button" variant="outline" size="sm"
    disabled={busy || (activeSubView === "tree" ? loading : activeSubView === "registry" && driverRegistryLoading)}
    onClick={() => {
      if (activeSubView === "tree") setRegistryRefresh((value) => value + 1);
      setCanonicalDiscoveryRefresh((value) => value + 1);
      if (activeSubView !== "queue") void refreshDriverRegistry();
    }}>刷新</Button>;
  const selectedModule = registry.modules.find((module) => module.id === selectedModuleId);
  const modulePath: string[] = [];
  const seenModules = new Set<string>();
  let ancestor = selectedModule;
  while (ancestor && !seenModules.has(ancestor.id)) {
    seenModules.add(ancestor.id);
    modulePath.unshift(ancestor.name);
    ancestor = registry.modules.find((module) => module.id === ancestor?.parentId);
  }
  const historicalRows = driverRegistry.filter((row) => {
    const observation = row.notYetObserved ? "not-yet" : row.observed ? "observed" : "unobserved";
    return (historyCategory === "all" || (row.businessCategoryName ?? "未分类") === historyCategory)
      && (historyObserved === "all" || observation === historyObserved)
      && [row.name, row.businessCategoryName, ...row.compatibles].join(" ").toLowerCase().includes(historyQuery.trim().toLowerCase());
  });
  const historyColumns = [
    { key: "name", header: "驱动组", render: (row: DriverRegistryEntry) => row.name, sortAccessor: (row: DriverRegistryEntry) => row.name },
    { key: "compatibles", header: "兼容标识", render: (row: DriverRegistryEntry) => row.compatibles.join("、") || "未记录" },
    { key: "category", header: "业务分类", render: (row: DriverRegistryEntry) => row.businessCategoryName || "未分类", sortAccessor: (row: DriverRegistryEntry) => row.businessCategoryName ?? "" },
    { key: "observed", header: "观察状态", render: (row: DriverRegistryEntry) => row.notYetObserved ? "尚未观察" : row.observed ? "已观察" : "未观察" },
    { key: "count", header: "实测处", render: (row: DriverRegistryEntry) => row.parameterCount, sortAccessor: (row: DriverRegistryEntry) => row.parameterCount }
  ];

  return <section className="parameter-module-mapping-panel" aria-label={PARAMETER_ADMIN_UI.moduleMapping}>
    {activeSubView !== "tree" ? <div className="navigator-workbench__toolbar" role="group" aria-label="工作台操作"><div className="navigator-workbench__controls">{tabs}</div>{refresh}</div> : null}
    {activeSubView === "tree" ? <NavigatorWorkbench pageKey="module-governance" navigatorLabel="模块导航" taskLabel={activeTab.label}
      panelId={activeTab.panelId} tabId={activeTab.id} toolbar={tabs} primaryAction={<>
        {refresh}
        {canManageTaxonomy ? <Button type="button" size="sm" disabled={busy || !registryLoaded}
          onClick={() => setCreateRootRequest((value) => value + 1)}>新建模块</Button> : null}
      </>}
      context={selectedModule || visibleModuleIds ? <div className="module-governance-context">
        <div><strong>{selectedModule ? modulePath.join(" / ") : "模块筛选"}</strong>
          <p className="parameter-text-content">{selectedModule?.description || "按模块查看主体及参数定义，管理组织内的分类与归属。"}</p></div>
        {selectedModule ? <dl><dt>适用范围</dt><dd>{selectedModule.scope || "未填写"}</dd><dt>重要性</dt><dd>{{ low: "低", medium: "中", high: "高" }[selectedModule.effectiveImportance]}</dd>
          <dt>定义</dt><dd>{selectedModule.definitionCount}</dd><dt>实测处</dt><dd>{selectedModule.parameterCount}</dd></dl> : null}
        {visibleModuleIds ? <span className="module-governance-filter-scope" role="status">列表已应用模块树筛选，包含匹配模块的子模块</span> : null}
      </div> : undefined}
      notice={error ? <p className="parameter-module-mapping-panel__error" role="alert"><AlertCircle size={15} aria-hidden="true" />{error}</p> : undefined}
      navigator={!registryLoaded ? <SectionSkeleton label="正在加载模块注册表…" /> : moduleTree}
      taskState={!registryLoaded ? { kind: "loading", message: "正在加载模块注册表…" } : undefined}>
      {canonicalAvailable && canonicalCatalog && canonicalGovernance && canonicalOrganizationId ? <CanonicalSubjectPlacementPanel
        catalog={canonicalCatalog} governance={canonicalGovernance} organizationId={canonicalOrganizationId}
        actor={canonicalActor} sessionPermissions={canonicalSessionPermissions} canAdmin={canAdmin} modules={registry.modules}
        onChanged={refreshAfterCanonicalChange} selectedModuleId={selectedModuleId} visibleModuleIds={visibleModuleScope}
        search={search} refreshKey={canonicalDiscoveryRefresh} managedRefresh onNavigate={onNavigate}
        onCreateBusinessModule={canManageTaxonomy ? () => setCreateRootRequest((value) => value + 1) : undefined} />
        : canonicalEnabled ? <p role="alert">规范目录发现服务不可用，请检查组织与治理接口。</p>
          : <SectionEmpty message="Mock 模式仅支持共享业务分类管理，请使用 API 模式管理规范主体与归属。" />}
    </NavigatorWorkbench> : activeSubView === "queue" ? <AdminListPage label="来源识别" headerActions={null} filterBar={null}
      table={{ rows: [] as DriverRegistryEntry[], columns: historyColumns, rowKey: (row) => row.moduleId }}
      emptyState={{ message: "暂无发现记录。", actionLabel: "查看模块", onAction: () => selectTab("tree") }}
      tableState={<div role="tabpanel" id={activeTab.panelId} aria-labelledby={activeTab.id}>
        {canonicalAvailable && canonicalGovernance && canonicalOrganizationId ? <CanonicalDriverDiscovery
          governance={canonicalGovernance} catalog={canonicalCatalog} projects={projects} organizationId={canonicalOrganizationId}
          onNavigate={onNavigate} refreshKey={canonicalDiscoveryRefresh} managedRefresh />
          : <SectionEmpty message={canonicalEnabled ? "来源识别需要可用的 API 组织与治理服务。" : "Mock 模式不提供来源识别，请使用 API 模式。"} />}
      </div>} /> : <section aria-label="历史驱动注册表" aria-busy={driverRegistryLoading}>
      <div role="tabpanel" id={activeTab.panelId} aria-labelledby={activeTab.id}><AdminListPage label="历史注册表" headerActions={null}
        notice={<p>历史注册快照仅用于溯源，不代表当前主体身份或归属；此接口不提供历史时间线。当前登记请在模块页查阅。</p>}
        filterBar={<><label className="admin-list-page__filter-field">搜索历史记录<input type="search" aria-label="搜索历史记录" placeholder="驱动组、兼容标识或业务分类"
          value={historyQuery} onChange={(event) => updateHistorySearch({ historyQ: event.target.value })} /></label>
          <SelectControl ariaLabel="筛选历史业务分类" value={historyCategory} onValueChange={(value) => updateHistorySearch({ historyCategory: value })} size="filter"
            options={[{ value: "all", label: "全部业务分类" }, ...[...new Set(driverRegistry.map((row) => row.businessCategoryName || "未分类"))].sort().map((value) => ({ value, label: value }))]} />
          <SelectControl ariaLabel="筛选历史观察状态" value={historyObserved} onValueChange={(value) => updateHistorySearch({ historyObserved: value })} size="filter"
            options={[{ value: "all", label: "全部观察状态" }, { value: "observed", label: "已观察" }, { value: "unobserved", label: "未观察" }, { value: "not-yet", label: "尚未观察" }]} />
          <Button type="button" variant="ghost" size="sm" onClick={() => updateHistorySearch({ historyQ: "", historyCategory: "", historyObserved: "" })}>清除筛选</Button></>}
        table={{ ariaLabel: "历史驱动注册表", rows: historicalRows, rowKey: (row) => row.moduleId, columns: historyColumns,
          page: historyPage, onPageChange: (page) => updateHistorySearch({ historyPage: String(page) }) }}
        rowActions={(row) => ({ label: `${row.name}操作`, primaryAction: { id: "detail", label: "查看", ariaLabel: `查看历史记录 ${row.name}`, onSelect: () => setHistoricalDetail(row) }, items: [] })}
        emptyState={{ message: driverRegistry.length ? "没有匹配的历史记录。" : "暂无历史驱动注册记录。", actionLabel: "清除筛选", onAction: () => updateHistorySearch({ historyQ: "", historyCategory: "", historyObserved: "" }) }}
        tableState={driverRegistryLoading ? <SectionSkeleton label="正在加载历史驱动注册表…" /> : driverRegistryError ? <div role="alert"><p>{driverRegistryError}</p><Button type="button" variant="outline" onClick={() => void refreshDriverRegistry()}>重试历史驱动注册表</Button></div> : undefined} /></div>
      {historicalDetail ? <ModalDialog open onDismiss={() => setHistoricalDetail(null)} className="confirm-dialog module-history-detail" describedBy>
        {({ titleId, descriptionId }) => <><h2 id={titleId}>{historicalDetail.name}</h2><p id={descriptionId}>历史注册资料，只读溯源。</p>
          <dl><dt>业务分类</dt><dd>{historicalDetail.businessCategoryName || "未分类"}</dd>
            <dt>驱动性质</dt><dd>{historicalDetail.driverNature ? formatDriverNatureLabel(historicalDetail.driverNature) : "未记录"}</dd>
            <dt>实例基数</dt><dd>{historicalDetail.instanceCardinality ? formatInstanceCardinalityLabel(historicalDetail.instanceCardinality) : "未记录"}</dd>
            <dt>兼容标识</dt><dd>{historicalDetail.compatibles.join("、") || "未记录"}</dd>
            <dt>解析覆盖</dt><dd>{historicalDetail.parseCoverages.length ? historicalDetail.parseCoverages.map((entry) => `${entry.compatible}：${entry.coverage.covered ? "已覆盖" : "未覆盖"}`).join("；") : "未记录"}</dd>
            <dt>实测处</dt><dd>{historicalDetail.parameterCount}</dd></dl>
          <div className="dialog-actions"><Button variant="outline" onClick={() => setHistoricalDetail(null)}>关闭</Button></div></>}
      </ModalDialog> : null}
    </section>}
  </section>;
}
