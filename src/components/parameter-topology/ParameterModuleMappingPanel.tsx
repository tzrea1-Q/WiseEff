import { useEffect, useMemo, useState } from "react";
import { AlertCircle, LoaderCircle, RefreshCw } from "lucide-react";

import {
  buildParameterAdminModulesPath,
  parseParameterAdminModulesSubView,
  type ParameterAdminModulesSubView
} from "@/application/parameters/parameterAdminOrganizationPath";
import { PARAMETER_ADMIN_UI } from "@/application/parameters/parameterAdminUiCopy";
import type {
  CreateOrganizationDriverSchemaInput,
  DriverRegistryEntry,
  MappingApplyPreview,
  ParameterModuleRegistryRepository,
  RegisterOrClaimDriverInput,
  RecomputeBindingModulesResult
} from "@/application/ports/ParameterModuleRegistryRepository";
import { OrganizationDriverSchemaDialog, type LinkedOverlaySpec } from "@/components/admin/OrganizationDriverSchemaDialog";
import { OverlaySpecPickerDialog } from "@/components/admin/OverlaySpecPickerDialog";
import { ClassifyCompatibleDialog } from "@/components/parameter-topology/ClassifyCompatibleDialog";
import { ModuleAttributionTree } from "@/components/parameter-topology/ModuleAttributionTree";
import { RegisterDriverDialog } from "@/components/parameter-topology/RegisterDriverDialog";
import { RecomputeBindingsResultDialog } from "@/components/parameter-topology/RecomputeBindingsResultDialog";
import { UnclassifiedCompatibleQueue } from "@/components/parameter-topology/UnclassifiedCompatibleQueue";
import { type ParameterSpecLibraryRow } from "@/components/parameter-topology/ParameterSpecLibrary";
import {
  summarizeDriverCoverage
} from "@/components/parameter-topology/moduleAttributionTreeUtils";
import {
  filterUnmappedCompatibles,
  toUnmappedCompatibleHint,
  type UnmappedCompatibleHint
} from "@/domain/parameter-topology/moduleDiscovery";
import { normalizeMatchToken } from "@/domain/parameter-topology/modulePlacement";
import {
  EMPTY_PARAMETER_MODULE_REGISTRY,
  type ParameterModuleRegistry
} from "@/domain/parameter-topology/moduleRegistry";
import { createHttpParameterModuleRegistryRepository } from "@/infrastructure/http/parameterModuleRegistryClient";

export type { UnmappedCompatibleHint };

export type ParameterModuleMappingPanelProps = {
  canAdmin?: boolean;
  repository?: ParameterModuleRegistryRepository;
  /** Load definition-library rows for overlay property linking. */
  listLibrarySpecs?: () => Promise<ParameterSpecLibraryRow[]>;
  pathname?: string;
  search?: string;
  onNavigate?: (path: string) => void;
};

/**
 * Organization module attribution: tree-first; unclassified queue is a secondary view.
 */
export function ParameterModuleMappingPanel({
  canAdmin = false,
  repository,
  listLibrarySpecs,
  pathname = "/parameter-admin/modules",
  search = "",
  onNavigate
}: ParameterModuleMappingPanelProps) {
  const client = useMemo(
    () => repository ?? createHttpParameterModuleRegistryRepository(),
    [repository]
  );
  const [registry, setRegistry] = useState<ParameterModuleRegistry>(EMPTY_PARAMETER_MODULE_REGISTRY);
  const [driverRegistry, setDriverRegistry] = useState<DriverRegistryEntry[]>([]);
  const [observedCompatibles, setObservedCompatibles] = useState<UnmappedCompatibleHint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [recomputing, setRecomputing] = useState(false);
  const [recomputeNotice, setRecomputeNotice] = useState<string | null>(null);
  const [recomputeResult, setRecomputeResult] = useState<RecomputeBindingModulesResult | null>(null);
  const [selectedCompatibles, setSelectedCompatibles] = useState<string[]>([]);
  const [classifyHints, setClassifyHints] = useState<UnmappedCompatibleHint[] | null>(null);
  const [registerDialogOpen, setRegisterDialogOpen] = useState(false);
  const [registerDraft, setRegisterDraft] = useState<{
    displayName: string;
    compatibles: string[];
  } | null>(null);
  const [overlaySchemaDraft, setOverlaySchemaDraft] = useState<{
    compatible: string;
  } | null>(null);
  const [overlayLinkedSpecs, setOverlayLinkedSpecs] = useState<LinkedOverlaySpec[]>([]);
  const [overlayPickerOpen, setOverlayPickerOpen] = useState(false);
  const [overlayLibrarySpecs, setOverlayLibrarySpecs] = useState<ParameterSpecLibraryRow[]>([]);
  const [overlayLibraryLoading, setOverlayLibraryLoading] = useState(false);

  const refreshDiscoveryHints = async () => {
    const hints = await client.getDiscoveryHints();
    setObservedCompatibles(
      hints.compatibles.map((hint) =>
        toUnmappedCompatibleHint({
          compatible: hint.compatible,
          bindingCount: hint.bindingCount,
          projectCount: hint.projectCount,
          suggestedGroupName: hint.suggestedGroupName
        })
      )
    );
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([client.getRegistry(), client.getDiscoveryHints(), client.listDriverRegistry()])
      .then(([nextRegistry, hints, driverList]) => {
        if (cancelled) return;
        setRegistry(nextRegistry);
        setDriverRegistry(driverList.items);
        setObservedCompatibles(
          hints.compatibles.map((hint) =>
            toUnmappedCompatibleHint({
              compatible: hint.compatible,
              bindingCount: hint.bindingCount,
              projectCount: hint.projectCount,
              suggestedGroupName: hint.suggestedGroupName
            })
          )
        );
      })
      .catch((loadError) => {
        if (cancelled) return;
        setError(loadError instanceof Error ? loadError.message : "无法加载模块注册表。");
        setRegistry(EMPTY_PARAMETER_MODULE_REGISTRY);
        setDriverRegistry([]);
        setObservedCompatibles([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  const unmappedCompatibles = useMemo(
    () => filterUnmappedCompatibles(observedCompatibles, registry.mappings),
    [observedCompatibles, registry.mappings]
  );
  const queueCount = unmappedCompatibles.length;
  const hasQueue = queueCount > 0;
  const requestedSubView: ParameterAdminModulesSubView =
    parseParameterAdminModulesSubView(pathname) ?? "tree";
  const activeSubView: ParameterAdminModulesSubView =
    requestedSubView === "queue" && !hasQueue ? "tree" : requestedSubView;
  const driverCoverage = useMemo(
    () => summarizeDriverCoverage(driverRegistry),
    [driverRegistry]
  );
  const driverCoverageDetails = useMemo(() => {
    const map = new Map<
      string,
      Array<{
        compatible: string;
        covered: boolean;
        pattern?: string;
        source?: string;
        driverId?: string;
      }>
    >();
    for (const entry of driverRegistry) {
      map.set(
        entry.moduleId,
        entry.parseCoverages.map(({ compatible, coverage }) => ({
          compatible,
          covered: coverage.covered,
          pattern: coverage.covered ? coverage.pattern : undefined,
          source: coverage.covered ? coverage.source : undefined,
          driverId: coverage.covered ? coverage.driverId : undefined
        }))
      );
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
    if (requestedSubView === "queue" && !loading && !hasQueue) {
      onNavigate(buildParameterAdminModulesPath("tree", search));
    }
  }, [hasQueue, loading, onNavigate, pathname, requestedSubView, search]);

  const goToSubView = (subView: ParameterAdminModulesSubView) => {
    onNavigate?.(buildParameterAdminModulesPath(subView, search));
  };

  const classifyPreview: MappingApplyPreview | null = useMemo(() => {
    if (!classifyHints || classifyHints.length === 0) return null;
    return {
      affectedBindings: classifyHints.reduce((sum, hint) => sum + hint.bindingCount, 0),
      byProject: [],
      fromModules: [],
      toModuleId: null,
      emptiedModules: [],
      conflicts: []
    };
  }, [classifyHints]);

  const dismissCompatible = async (compatible: string) => {
    if (!canAdmin) return;
    setBusy(true);
    setError(null);
    try {
      const hints = await client.dismissCompatible({ compatible });
      setObservedCompatibles(
        hints.compatibles.map((hint) =>
          toUnmappedCompatibleHint({
            compatible: hint.compatible,
            bindingCount: hint.bindingCount,
            projectCount: hint.projectCount,
            suggestedGroupName: hint.suggestedGroupName
          })
        )
      );
      setSelectedCompatibles((current) => current.filter((value) => value !== compatible));
    } catch (dismissError) {
      setError(dismissError instanceof Error ? dismissError.message : "忽略 compatible 失败。");
    } finally {
      setBusy(false);
    }
  };

  const classifyCompatibles = async (input: {
    businessModuleId: string;
    createBusinessName?: string;
    groups: Array<{ compatible: string; driverGroupName: string }>;
  }) => {
    if (!canAdmin) return;
    setBusy(true);
    setError(null);
    try {
      let parentId = input.businessModuleId;
      let nextRegistry = registry;
      if (input.createBusinessName) {
        nextRegistry = await client.createModule({
          name: input.createBusinessName,
          importance: "medium"
        });
        const created = nextRegistry.modules.find(
          (module) => module.name === input.createBusinessName && module.parentId === null
        );
        if (!created) {
          throw new Error("创建业务分类后未能定位到新模块。");
        }
        parentId = created.id;
      }

      let moved = 0;
      for (const group of input.groups) {
        const normalizedCompatible =
          normalizeMatchToken(group.compatible) ?? group.compatible.trim().toLowerCase();
        const driverGroupName = group.driverGroupName.trim();
        nextRegistry = await client.createModule({
          name: driverGroupName,
          parentId,
          kind: "driver-group",
          origin: "auto",
          sourceKey: `compatible:${normalizedCompatible}`
        });
        const groupModule =
          nextRegistry.modules.find(
            (module) =>
              module.kind === "driver-group" &&
              module.name === driverGroupName &&
              module.parentId === parentId
          ) ??
          nextRegistry.modules.find(
            (module) => module.sourceKey === `compatible:${normalizedCompatible}`
          ) ??
          nextRegistry.modules.find((module) => module.name === driverGroupName);
        if (!groupModule) {
          throw new Error(`创建驱动组「${driverGroupName}」后未能定位到新模块。`);
        }
        const mapped = await client.createMapping({
          moduleId: groupModule.id,
          matchKind: "compatible",
          matchValue: normalizedCompatible,
          priority: 300
        });
        nextRegistry = mapped.registry;
        moved += mapped.apply.affectedBindings;
      }

      setRegistry(nextRegistry);
      await refreshDiscoveryHints();
      setSelectedCompatibles([]);
      setClassifyHints(null);
      setRecomputeNotice(`已归类 ${input.groups.length} 个 compatible，移动 ${moved} 个项目参数。`);
      goToSubView("tree");
    } catch (classifyError) {
      setError(classifyError instanceof Error ? classifyError.message : "归类 compatible 失败。");
    } finally {
      setBusy(false);
    }
  };

  const recomputeBindings = async () => {
    if (!canAdmin) return;
    setRecomputing(true);
    setError(null);
    setRecomputeResult(null);
    try {
      const result = await client.recomputeBindings();
      setRegistry(await client.getRegistry());
      await refreshDiscoveryHints();
      setRecomputeResult(result);
    } catch (recomputeError) {
      setError(
        recomputeError instanceof Error ? recomputeError.message : "重算模块归属失败。"
      );
    } finally {
      setRecomputing(false);
    }
  };

  const refreshDriverRegistry = async () => {
    const list = await client.listDriverRegistry();
    setDriverRegistry(list.items);
  };

  const registerDriver = async (input: RegisterOrClaimDriverInput) => {
    if (!canAdmin) return;
    setBusy(true);
    setError(null);
    try {
      const result = await client.registerOrClaimDriver(input);
      setRegistry(await client.getRegistry());
      await refreshDriverRegistry();
      await refreshDiscoveryHints();
      setRegisterDialogOpen(false);
      setRegisterDraft(null);
      setRecomputeNotice(
        result.mode === "claimed" ? `已认领驱动组「${result.item.name}」。` : `已登记驱动组「${result.item.name}」。`
      );
      goToSubView("tree");
    } catch (registerError) {
      setError(registerError instanceof Error ? registerError.message : "登记驱动失败。");
    } finally {
      setBusy(false);
    }
  };

  const submitOverlaySchema = async (input: CreateOrganizationDriverSchemaInput) => {
    if (!canAdmin) return;
    setBusy(true);
    setError(null);
    try {
      const created = await client.createOrganizationDriverSchema(input);
      const result = await client.activateOrganizationDriverSchema(created.id);
      await refreshDriverRegistry();
      setOverlaySchemaDraft(null);
      setOverlayLinkedSpecs([]);
      setOverlayPickerOpen(false);
      setOverlayLibrarySpecs([]);
      setRecomputeNotice(
        `已激活组织解析 schema「${result.schema.displayName}」，覆盖 compatible ${input.compatible}。`
      );
    } catch (overlayError) {
      setError(
        overlayError instanceof Error ? overlayError.message : "保存组织解析 schema 失败。"
      );
    } finally {
      setBusy(false);
    }
  };

  const openOverlaySchemaDraft = (draft: { compatible: string }) => {
    setOverlaySchemaDraft(draft);
    setOverlayLinkedSpecs([]);
    setOverlayPickerOpen(false);
  };

  const openOverlaySpecPicker = async () => {
    setOverlayPickerOpen(true);
    if (!listLibrarySpecs) {
      setOverlayLibrarySpecs([]);
      return;
    }
    setOverlayLibraryLoading(true);
    try {
      setOverlayLibrarySpecs(await listLibrarySpecs());
    } catch {
      setOverlayLibrarySpecs([]);
    } finally {
      setOverlayLibraryLoading(false);
    }
  };

  const excludedOverlaySpecIds = useMemo(() => {
    const ids = new Set<string>();
    for (const item of overlayLinkedSpecs) {
      if (item.kind === "link") ids.add(item.parameterSpecId);
    }
    return ids;
  }, [overlayLinkedSpecs]);

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
        {canAdmin && activeSubView === "tree" ? (
          <div className="parameter-module-mapping-panel__actions">
            <button
              type="button"
              className="button subtle"
              disabled={busy || recomputing}
              onClick={() => void recomputeBindings()}
              title="全量重算是运维工具；日常归类走队列预览与按范围应用。"
            >
              <RefreshCw
                className={recomputing ? "dts-status-icon dts-status-icon--spin" : undefined}
                size={14}
                strokeWidth={2}
                aria-hidden="true"
              />
              运维：全量重算
            </button>
          </div>
        ) : null}
      </header>

      <nav
        className="parameter-module-mapping-panel__subnav"
        aria-label={PARAMETER_ADMIN_UI.moduleQueueSubnavAria}
      >
        <button
          type="button"
          className={`parameter-module-mapping-panel__subnav-tab${
            activeSubView === "tree" ? " is-active" : ""
          }`}
          aria-current={activeSubView === "tree" ? "page" : undefined}
          onClick={() => goToSubView("tree")}
        >
          {PARAMETER_ADMIN_UI.moduleTreeSubnav}
        </button>
        {hasQueue ? (
          <button
            type="button"
            className={`parameter-module-mapping-panel__subnav-tab${
              activeSubView === "queue" ? " is-active" : ""
            }`}
            aria-current={activeSubView === "queue" ? "page" : undefined}
            onClick={() => goToSubView("queue")}
          >
            {PARAMETER_ADMIN_UI.moduleDiscoveryCompatible}
            <span className="parameter-module-mapping-panel__subnav-count">{queueCount}</span>
          </button>
        ) : null}
      </nav>

      {recomputeNotice ? (
        <p className="parameter-module-mapping-panel__notice" role="status">
          {recomputeNotice}
        </p>
      ) : null}

      {error ? (
        <p className="parameter-module-mapping-panel__error" role="alert">
          <AlertCircle size={15} strokeWidth={2} aria-hidden="true" /> {error}
        </p>
      ) : null}

      {activeSubView === "tree" && hasQueue ? (
        <div className="parameter-module-mapping-panel__queue-banner" role="status">
          <p>
            <strong>{PARAMETER_ADMIN_UI.moduleQueueBanner}</strong>
            <span>
              共 {queueCount} 项。主界面继续维护归属树；点上方「未登记驱动」或右侧按钮去处理。
            </span>
          </p>
          <button type="button" className="button" onClick={() => goToSubView("queue")}>
            {PARAMETER_ADMIN_UI.moduleQueueBannerAction}
          </button>
        </div>
      ) : null}

      <div className="parameter-module-mapping-panel__stack">
        {activeSubView === "queue" ? (
            <UnclassifiedCompatibleQueue
              hints={unmappedCompatibles}
              canAdmin={canAdmin}
              busy={busy}
              selectedCompatibles={selectedCompatibles}
              onSelectionChange={setSelectedCompatibles}
              onClassify={(hints) => setClassifyHints([...hints])}
              onClaim={(hint) => {
                setRegisterDraft({
                  displayName: hint.suggestedGroupName,
                  compatibles: [hint.compatible],
                });
                setRegisterDialogOpen(true);
              }}
              onDismiss={(compatible) => void dismissCompatible(compatible)}
            />
        ) : (
          <ModuleAttributionTree
            modules={registry.modules}
            mappings={registry.mappings}
            driverCoverage={driverCoverage}
            driverCoverageDetails={driverCoverageDetails}
            canAdmin={canAdmin}
            busy={busy}
            hasUnclassifiedQueue={hasQueue}
            onOpenUnclassifiedQueue={() => goToSubView("queue")}
            onAuthorOverlaySchema={(compatible) => openOverlaySchemaDraft({ compatible })}
            onUpdateModule={async (moduleId, patch) => {
              setBusy(true);
              setError(null);
              try {
                setRegistry(await client.updateModule(moduleId, patch));
              } catch (updateError) {
                setError(updateError instanceof Error ? updateError.message : "更新模块失败。");
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
                setError(moveError instanceof Error ? moveError.message : "移动模块失败。");
              } finally {
                setBusy(false);
              }
            }}
            onDelete={async (moduleId) => {
              setBusy(true);
              setError(null);
              try {
                setRegistry(await client.deleteModule(moduleId));
                await refreshDiscoveryHints();
                await refreshDriverRegistry();
              } catch (deleteError) {
                setError(deleteError instanceof Error ? deleteError.message : "删除模块失败。");
              } finally {
                setBusy(false);
              }
            }}
            onRemoveMapping={async (mappingId) => {
              setBusy(true);
              setError(null);
              try {
                const result = await client.deleteMapping(mappingId);
                setRegistry(result.registry);
                await refreshDiscoveryHints();
                await refreshDriverRegistry();
              } catch (mappingError) {
                setError(mappingError instanceof Error ? mappingError.message : "删除归属失败。");
              } finally {
                setBusy(false);
              }
            }}
            onAddCompatibleMapping={async ({ moduleId, matchValue }) => {
              setBusy(true);
              setError(null);
              try {
                const result = await client.createMapping({
                  moduleId,
                  matchKind: "compatible",
                  matchValue
                });
                setRegistry(result.registry);
                await refreshDiscoveryHints();
                await refreshDriverRegistry();
              } catch (mappingError) {
                setError(
                  mappingError instanceof Error ? mappingError.message : "添加 compatible 规则失败。"
                );
              } finally {
                setBusy(false);
              }
            }}
            onCreateModule={async (input) => {
              setBusy(true);
              setError(null);
              try {
                if (input.kind === "driver-group") {
                  if (!input.parentId) {
                    throw new Error("驱动组必须选择业务分类父级。");
                  }
                  await client.registerOrClaimDriver({
                    displayName: input.name,
                    businessCategoryId: input.parentId,
                    compatibles: input.compatibles ?? [],
                    notes: input.description
                  });
                  setRegistry(await client.getRegistry());
                  await refreshDriverRegistry();
                  await refreshDiscoveryHints();
                } else {
                  setRegistry(
                    await client.createModule({
                      name: input.name,
                      description: input.description,
                      scope: input.scope,
                      importance: input.importance,
                      parentId: input.parentId,
                      kind: input.kind ?? "business",
                      origin: "curated",
                      sourceKey: input.sourceKey
                    })
                  );
                }
              } catch (createError) {
                setError(createError instanceof Error ? createError.message : "创建模块失败。");
              } finally {
                setBusy(false);
              }
            }}
          />
        )}
      </div>

      {registerDialogOpen ? (
        <RegisterDriverDialog
          modules={registry.modules}
          busy={busy}
          initialDisplayName={registerDraft?.displayName ?? ""}
          initialCompatibles={registerDraft?.compatibles ?? []}
          onCancel={() => {
            setRegisterDialogOpen(false);
            setRegisterDraft(null);
          }}
          onConfirm={(input) => void registerDriver(input)}
        />
      ) : null}

      {overlaySchemaDraft ? (
        <OrganizationDriverSchemaDialog
          compatible={overlaySchemaDraft.compatible}
          linkedSpecs={overlayLinkedSpecs}
          busy={busy}
          suspended={overlayPickerOpen}
          onCancel={() => {
            setOverlaySchemaDraft(null);
            setOverlayLinkedSpecs([]);
            setOverlayPickerOpen(false);
            setOverlayLibrarySpecs([]);
          }}
          onAddProperty={() => void openOverlaySpecPicker()}
          onRemoveProperty={(index) =>
            setOverlayLinkedSpecs((current) => current.filter((_, rowIndex) => rowIndex !== index))
          }
          onSubmit={(input) => void submitOverlaySchema(input)}
        />
      ) : null}

      {overlaySchemaDraft && overlayPickerOpen ? (
        <OverlaySpecPickerDialog
          specs={overlayLibrarySpecs}
          loading={overlayLibraryLoading}
          busy={busy}
          excludedSpecIds={excludedOverlaySpecIds}
          onBack={() => setOverlayPickerOpen(false)}
          onConfirm={(result) => {
            if (result.kind === "link") {
              setOverlayLinkedSpecs((current) => [
                ...current,
                {
                  kind: "link",
                  parameterSpecId: result.parameterSpecId,
                  propertyKey: result.propertyKey,
                  driverModule: result.driverModule
                }
              ]);
            } else {
              setOverlayLinkedSpecs((current) => [
                ...current,
                {
                  kind: "create",
                  propertyKey: result.propertyKey,
                  valueShape: result.valueShape,
                  ...(result.units ? { units: result.units } : {}),
                  ...(result.documentation ? { documentation: result.documentation } : {})
                }
              ]);
            }
            setOverlayPickerOpen(false);
          }}
        />
      ) : null}

      {classifyHints ? (
        <ClassifyCompatibleDialog
          hints={classifyHints}
          modules={registry.modules}
          busy={busy}
          preview={classifyPreview}
          onCancel={() => setClassifyHints(null)}
          onConfirm={(input) => void classifyCompatibles(input)}
        />
      ) : null}

      {recomputeResult ? (
        <RecomputeBindingsResultDialog
          result={recomputeResult}
          onClose={() => setRecomputeResult(null)}
        />
      ) : null}
    </section>
  );
}
