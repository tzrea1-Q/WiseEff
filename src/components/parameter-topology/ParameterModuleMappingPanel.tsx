import { useEffect, useMemo, useState } from "react";
import { AlertCircle, LoaderCircle, RefreshCw } from "lucide-react";

import { PARAMETER_ADMIN_UI } from "@/application/parameters/parameterAdminUiCopy";
import type {
  MappingApplyPreview,
  ParameterModuleRegistryRepository
} from "@/application/ports/ParameterModuleRegistryRepository";
import { ClassifyCompatibleDialog } from "@/components/parameter-topology/ClassifyCompatibleDialog";
import { ModuleAttributionTree } from "@/components/parameter-topology/ModuleAttributionTree";
import { UnclassifiedCompatibleQueue } from "@/components/parameter-topology/UnclassifiedCompatibleQueue";
import {
  filterUnmappedCompatibles,
  toUnmappedCompatibleHint,
  type UnmappedCompatibleHint
} from "@/domain/parameter-topology/moduleDiscovery";
import {
  EMPTY_PARAMETER_MODULE_REGISTRY,
  type ParameterModuleRegistry
} from "@/domain/parameter-topology/moduleRegistry";
import { createHttpParameterModuleRegistryRepository } from "@/infrastructure/http/parameterModuleRegistryClient";

export type { UnmappedCompatibleHint };

export type ParameterModuleMappingPanelProps = {
  canAdmin?: boolean;
  repository?: ParameterModuleRegistryRepository;
};

/**
 * Organization module attribution: queue-first classify + kind-scoped tree.
 */
export function ParameterModuleMappingPanel({
  canAdmin = false,
  repository
}: ParameterModuleMappingPanelProps) {
  const client = useMemo(
    () => repository ?? createHttpParameterModuleRegistryRepository(),
    [repository]
  );
  const [registry, setRegistry] = useState<ParameterModuleRegistry>(EMPTY_PARAMETER_MODULE_REGISTRY);
  const [observedCompatibles, setObservedCompatibles] = useState<UnmappedCompatibleHint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [recomputing, setRecomputing] = useState(false);
  const [recomputeNotice, setRecomputeNotice] = useState<string | null>(null);
  const [selectedCompatibles, setSelectedCompatibles] = useState<string[]>([]);
  const [classifyHints, setClassifyHints] = useState<UnmappedCompatibleHint[] | null>(null);

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
    Promise.all([client.getRegistry(), client.getDiscoveryHints()])
      .then(([nextRegistry, hints]) => {
        if (cancelled) return;
        setRegistry(nextRegistry);
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
        nextRegistry = await client.createModule({
          name: group.driverGroupName,
          parentId
        });
        const groupModule =
          nextRegistry.modules.find(
            (module) => module.name === group.driverGroupName && module.parentId === parentId
          ) ?? nextRegistry.modules.find((module) => module.name === group.driverGroupName);
        if (!groupModule) {
          throw new Error(`创建驱动组「${group.driverGroupName}」后未能定位到新模块。`);
        }
        const mapped = await client.createMapping({
          moduleId: groupModule.id,
          matchKind: "compatible",
          matchValue: group.compatible,
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
    setRecomputeNotice(null);
    try {
      const result = await client.recomputeBindings();
      setRecomputeNotice(`已重算模块归属，更新 ${result.updated} 个项目参数。`);
    } catch (recomputeError) {
      setError(
        recomputeError instanceof Error ? recomputeError.message : "重算模块归属失败。"
      );
    } finally {
      setRecomputing(false);
    }
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
      <header>
        <h3>{PARAMETER_ADMIN_UI.moduleMapping}</h3>
        <p>{PARAMETER_ADMIN_UI.moduleMappingBlurb}</p>
        {canAdmin ? (
          <div className="parameter-module-mapping-panel__actions">
            <button
              type="button"
              className="button"
              disabled={busy || recomputing}
              onClick={() => void recomputeBindings()}
            >
              <RefreshCw
                className={recomputing ? "dts-status-icon dts-status-icon--spin" : undefined}
                size={14}
                strokeWidth={2}
                aria-hidden="true"
              />
              重算模块归属
            </button>
            <small>全量重算是运维工具；日常归类走队列预览与按范围应用。</small>
          </div>
        ) : null}
      </header>

      {recomputeNotice ? <p role="status">{recomputeNotice}</p> : null}

      {error ? (
        <p role="alert">
          <AlertCircle size={15} strokeWidth={2} aria-hidden="true" /> {error}
        </p>
      ) : null}

      <div className="parameter-module-mapping-panel__stack">
        <UnclassifiedCompatibleQueue
          hints={unmappedCompatibles}
          canAdmin={canAdmin}
          busy={busy}
          selectedCompatibles={selectedCompatibles}
          onSelectionChange={setSelectedCompatibles}
          onClassify={(hints) => setClassifyHints([...hints])}
          onDismiss={(compatible) => void dismissCompatible(compatible)}
        />

        <ModuleAttributionTree
          modules={registry.modules}
          mappings={registry.mappings}
          canAdmin={canAdmin}
          busy={busy}
          onRename={async (moduleId, name) => {
            setBusy(true);
            setError(null);
            try {
              setRegistry(await client.updateModule(moduleId, { name }));
            } catch (renameError) {
              setError(renameError instanceof Error ? renameError.message : "重命名模块失败。");
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
            } catch (deleteError) {
              setError(deleteError instanceof Error ? deleteError.message : "删除模块失败。");
            } finally {
              setBusy(false);
            }
          }}
          onImportanceChange={async (moduleId, importance) => {
            setBusy(true);
            setError(null);
            try {
              setRegistry(await client.updateModule(moduleId, { importance }));
            } catch (importanceError) {
              setError(
                importanceError instanceof Error ? importanceError.message : "更新重要性失败。"
              );
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
            } catch (mappingError) {
              setError(mappingError instanceof Error ? mappingError.message : "删除归属失败。");
            } finally {
              setBusy(false);
            }
          }}
          onCreateBusinessModule={async (input) => {
            setBusy(true);
            setError(null);
            try {
              setRegistry(
                await client.createModule({
                  name: input.name,
                  importance: input.importance
                })
              );
            } catch (createError) {
              setError(createError instanceof Error ? createError.message : "创建模块失败。");
            } finally {
              setBusy(false);
            }
          }}
        />
      </div>

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
    </section>
  );
}
