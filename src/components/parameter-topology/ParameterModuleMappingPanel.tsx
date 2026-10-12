import { useCallback, useEffect, useMemo, useState } from "react";
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
  summarizeDriverCoverage
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
import { DataTable } from "@/components/admin/DataTable";

const moduleTabs = [
  { value: "tree", label: "模块", id: "module-governance-tab-tree", panelId: "module-governance-panel" },
  { value: "queue", label: "发现队列", id: "module-governance-tab-queue", panelId: "module-governance-panel" },
  { value: "registry", label: "历史注册表", id: "module-governance-tab-registry", panelId: "module-governance-panel" }
] as const;

export type ParameterModuleMappingPanelProps = {
  canAdmin?: boolean;
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
};

/**
 * Organization business taxonomy with read-only historical driver attribution.
 */
export function ParameterModuleMappingPanel({
  canAdmin = false,
  repository,
  pathname = "/parameter-admin/modules",
  search = "",
  onNavigate,
  canonicalCatalog,
  canonicalGovernance,
  canonicalOrganizationId,
  canonicalActor = "user",
  canonicalSessionPermissions,
  canonicalEnabled = false
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
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [canonicalDiscoveryRefresh, setCanonicalDiscoveryRefresh] = useState(0);
  const [registryRefresh, setRegistryRefresh] = useState(0);
  const [localSubView, setLocalSubView] = useState<{ location: string; value: ParameterAdminModulesSubView } | null>(null);

  const refreshDriverRegistry = useCallback(async (isCancelled: () => boolean = () => false) => {
    setDriverRegistryLoading(true);
    setDriverRegistryError(null);
    try {
      const list = await client.listDriverRegistry();
      if (!isCancelled()) setDriverRegistry(list.items);
    } catch (loadError) {
      if (!isCancelled()) {
        setDriverRegistry([]);
        setDriverRegistryError(presentError(loadError, "无法加载历史驱动注册表，请重试。"));
      }
    } finally {
      if (!isCancelled()) setDriverRegistryLoading(false);
    }
  }, [client]);

  useEffect(() => {
    let cancelled = false;
    void refreshDriverRegistry(() => cancelled);
    return () => { cancelled = true; };
  }, [refreshDriverRegistry]);

  useEffect(() => {
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
        setRegistry(EMPTY_PARAMETER_MODULE_REGISTRY);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [client, canonicalEnabled, registryRefresh]);
  const requestedSubView: ParameterAdminModulesSubView =
    parseParameterAdminModulesSubView(pathname, search) ?? "tree";
  const activeSubView = localSubView?.location === pathname + search ? localSubView.value : requestedSubView;
  const activeTab = moduleTabs.find((tab) => tab.value === activeSubView)!;
  const canonicalAvailable = Boolean(canonicalEnabled && canonicalCatalog && canonicalGovernance && canonicalOrganizationId);
  const selectTab = (value: ParameterAdminModulesSubView) => {
    if (onNavigate) onNavigate(buildParameterAdminModulesPath(value, search));
    else setLocalSubView({ location: pathname + search, value });
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
    setCanonicalDiscoveryRefresh((value) => value + 1);
    setRegistry(await client.getRegistry());
    await refreshDriverRegistry();
  };

  const moduleTree = (
    <ModuleAttributionTree
      modules={registry.modules}
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
      canAdmin={canAdmin}
      busy={busy}
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
        } finally {
          setBusy(false);
        }
      }}
    />
  );

  return (
    <section className="parameter-module-mapping-panel" aria-label={PARAMETER_ADMIN_UI.moduleMapping} aria-busy={loading}>
      <NavigatorWorkbench pageKey="module-governance" navigatorLabel="模块导航" taskLabel={activeTab.label}
        panelId={activeTab.panelId} tabId={activeTab.id}
        toolbar={<ViewSwitch variant="tabs" ariaLabel="模块治理视图" value={activeSubView}
          onValueChange={(value) => selectTab(value as ParameterAdminModulesSubView)} items={[...moduleTabs]} />}
        primaryAction={<Button type="button" disabled={loading || busy} onClick={() => {
          setRegistryRefresh((value) => value + 1);
          setCanonicalDiscoveryRefresh((value) => value + 1);
          void refreshDriverRegistry();
        }}>刷新模块治理</Button>}
        notice={error ? <p className="parameter-module-mapping-panel__error" role="alert">
          <AlertCircle size={15} strokeWidth={2} aria-hidden="true" />{error}</p> : undefined}
        navigator={loading ? <SectionSkeleton label="正在加载模块注册表…" /> : moduleTree}
        taskState={loading ? { kind: "loading", message: "正在加载模块注册表…" } : undefined}>
        {canonicalEnabled && !canonicalAvailable ? <p role="alert">规范目录发现服务不可用，请检查组织与治理接口。</p> : null}
        <div hidden={activeSubView !== "tree"}>
          {canonicalEnabled && canonicalCatalog && canonicalGovernance && canonicalOrganizationId ? (
            <CanonicalSubjectPlacementPanel catalog={canonicalCatalog} governance={canonicalGovernance}
              organizationId={canonicalOrganizationId} actor={canonicalActor} sessionPermissions={canonicalSessionPermissions}
              canAdmin={canAdmin} modules={registry.modules} onChanged={refreshAfterCanonicalChange} />
          ) : !canonicalEnabled ? <SectionEmpty message="Mock 模式仅支持共享业务分类管理，请使用 API 模式管理规范主体与归属。" /> : null}
        </div>
        <div hidden={activeSubView !== "queue"}>
          {canonicalEnabled && canonicalCatalog && canonicalGovernance && canonicalOrganizationId ? (
            <CanonicalDriverDiscovery governance={canonicalGovernance} organizationId={canonicalOrganizationId}
              onNavigate={onNavigate} refreshKey={canonicalDiscoveryRefresh} />
          ) : !canonicalEnabled ? <SectionEmpty message="Mock 模式不提供规范发现队列，请使用 API 模式。" /> : null}
        </div>
        <div hidden={activeSubView !== "registry"}>
          <section aria-label="历史驱动注册表" aria-busy={driverRegistryLoading}>
            {driverRegistryLoading ? <SectionSkeleton label="正在加载历史驱动注册表…" />
              : driverRegistryError ? <div role="alert"><p>{driverRegistryError}</p>
                <Button type="button" variant="secondary" onClick={() => void refreshDriverRegistry()}>重试历史驱动注册表</Button>
              </div> : <DataTable ariaLabel="历史驱动注册表" rows={driverRegistry} rowKey={(row) => row.moduleId}
                emptyMessage="暂无历史驱动注册记录。规范主体登记请前往模块页签。"
                columns={[
                  { key: "name", header: "驱动组", render: (row) => row.name },
                  { key: "compatibles", header: "兼容标识", render: (row) => row.compatibles.join("、") || "—" },
                  { key: "category", header: "业务分类", render: (row) => row.businessCategoryName || "未分类" },
                  { key: "observed", header: "观察状态", render: (row) => row.notYetObserved ? "尚未观察" : row.observed ? "已观察" : "未观察" },
                  { key: "count", header: "实测处", render: (row) => row.parameterCount }
                ]} />}
          </section>
        </div>
      </NavigatorWorkbench>
    </section>
  );
}
