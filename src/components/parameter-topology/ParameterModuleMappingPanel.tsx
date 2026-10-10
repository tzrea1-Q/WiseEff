import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, LoaderCircle } from "lucide-react";

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

export type ParameterModuleMappingPanelProps = {
  canAdmin?: boolean;
  repository?: ParameterModuleRegistryRepository;
  pathname?: string;
  search?: string;
  onNavigate?: (path: string) => void;
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
  }, [client, canonicalEnabled]);
  const requestedSubView: ParameterAdminModulesSubView =
    parseParameterAdminModulesSubView(pathname) ?? "tree";
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
    // Legacy /modules/registry bookmarks → tree.
    if (/^\/parameter-admin\/modules\/registry\/?$/.test(pathname)) {
      onNavigate(buildParameterAdminModulesPath("tree", search));
      return;
    }
    if (
      requestedSubView === "queue" && !loading
    ) {
      onNavigate(buildParameterAdminModulesPath("tree", search));
    }
  }, [loading, onNavigate, pathname, requestedSubView, search]);

  const refreshAfterCanonicalChange = async () => {
    setCanonicalDiscoveryRefresh((value) => value + 1);
    setRegistry(await client.getRegistry());
    await refreshDriverRegistry();
  };

  if (loading) {
    return (
      <section
        className="parameter-module-mapping-panel"
        aria-label={PARAMETER_ADMIN_UI.moduleMapping}
        aria-busy="true"
      >
        <p role="status">
          <LoaderCircle
            className="dts-status-icon dts-status-icon--spin"
            size={16}
            strokeWidth={2}
            aria-hidden="true"
          />
          正在加载模块注册表…
        </p>
      </section>
    );
  }

  return (
    <section className="parameter-module-mapping-panel" aria-label={PARAMETER_ADMIN_UI.moduleMapping}>
      <header className="parameter-module-mapping-panel__header">
        <div className="parameter-module-mapping-panel__intro">
          <h3>{PARAMETER_ADMIN_UI.moduleMapping}</h3>
          <p>{PARAMETER_ADMIN_UI.moduleMappingBlurb}</p>
        </div>

      </header>

      {error ? (
        <p className="parameter-module-mapping-panel__error" role="alert">
          <AlertCircle size={15} strokeWidth={2} aria-hidden="true" /> {error}
        </p>
      ) : null}

      <div
        className={`parameter-module-mapping-panel__stack${
          canonicalEnabled ? " parameter-module-mapping-panel__stack--canonical" : ""
        }`}
      >
        {canonicalEnabled && (!canonicalCatalog || !canonicalGovernance || !canonicalOrganizationId) ? (
          <p role="alert">规范目录发现服务不可用，请检查组织与治理接口。</p>
        ) : null}
        {canonicalEnabled && canonicalCatalog && canonicalGovernance && canonicalOrganizationId ? (
          <CanonicalDriverDiscovery
            governance={canonicalGovernance}
            organizationId={canonicalOrganizationId}
            onNavigate={onNavigate}
            refreshKey={canonicalDiscoveryRefresh}
          />
        ) : null}
        {canonicalEnabled && canonicalCatalog && canonicalGovernance && canonicalOrganizationId ? (
          <CanonicalSubjectPlacementPanel
            catalog={canonicalCatalog}
            governance={canonicalGovernance}
            organizationId={canonicalOrganizationId}
            actor={canonicalActor}
            sessionPermissions={canonicalSessionPermissions}
            canAdmin={canAdmin}
            modules={registry.modules}
            onChanged={refreshAfterCanonicalChange}
          />
        ) : null}
        <section aria-label="历史驱动注册表" aria-busy={driverRegistryLoading}>
          {driverRegistryLoading ? <p role="status">正在加载历史驱动注册表…</p> : null}
          {driverRegistryError ? (
            <div role="alert">
              <p>{driverRegistryError}</p>
              <button
                type="button"
                className="button subtle"
                disabled={driverRegistryLoading}
                onClick={() => void refreshDriverRegistry()}
              >
                重试历史驱动注册表
              </button>
            </div>
          ) : null}
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
        </section>
      </div>

    </section>
  );
}
