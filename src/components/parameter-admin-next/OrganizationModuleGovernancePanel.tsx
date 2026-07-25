import { useEffect, useMemo, useState } from "react";
import type {
  CreateModuleMappingInput,
  CreateParameterModuleInput,
  ParameterModuleRegistryRepository,
  UpdateParameterModuleInput
} from "@/application/ports/ParameterModuleRegistryRepository";
import type { ParameterAdminAuditHint } from "@/application/parameters/parameterAdminState";
import { ParameterModuleMappingPanel } from "@/components/parameter-topology/ParameterModuleMappingPanel";
import { useParameterAdmin } from "./ParameterAdminProvider";

function pushModuleAudit(
  dispatch: ReturnType<typeof useParameterAdmin>["dispatch"],
  kind: ParameterAdminAuditHint["kind"],
  summary: string,
  reason = ""
) {
  dispatch({
    type: "PUSH_AUDIT_HINT",
    hint: {
      kind,
      summary,
      reason,
      recordedAt: new Date().toISOString()
    }
  });
}

/**
 * Organization-scoped module tree + driver mapping, composed over the admin facade.
 */
export function OrganizationModuleGovernancePanel() {
  const { application, dispatch } = useParameterAdmin();
  const [observedDrivers, setObservedDrivers] = useState<
    Array<{ driverModule: string; bindingCount: number }>
  >([]);

  useEffect(() => {
    let cancelled = false;
    application
      .listSpecs({})
      .then((specs) => {
        if (cancelled) return;
        const counts = new Map<string, number>();
        for (const spec of specs) {
          const driver = spec.driverModule?.trim();
          if (!driver) continue;
          counts.set(driver, (counts.get(driver) ?? 0) + 1);
        }
        setObservedDrivers(
          Array.from(counts.entries()).map(([driverModule, bindingCount]) => ({
            driverModule,
            bindingCount
          }))
        );
      })
      .catch(() => {
        if (!cancelled) setObservedDrivers([]);
      });
    return () => {
      cancelled = true;
    };
  }, [application]);

  const repository = useMemo((): ParameterModuleRegistryRepository => {
    const base = application.asModuleRegistryRepository();
    return {
      getRegistry: () => base.getRegistry(),
      getDiscoveryHints: () => base.getDiscoveryHints(),
      async createModule(input: CreateParameterModuleInput) {
        const next = await base.createModule(input);
        pushModuleAudit(dispatch, "module-created", `已创建业务模块「${input.name}」`);
        return next;
      },
      async updateModule(moduleId: string, input: UpdateParameterModuleInput) {
        const next = await base.updateModule(moduleId, input);
        if (input.name !== undefined) {
          pushModuleAudit(dispatch, "module-renamed", `已重命名业务模块为「${input.name}」`);
        } else if (input.parentId !== undefined) {
          pushModuleAudit(dispatch, "module-moved", `已移动业务模块 ${moduleId}`);
        }
        return next;
      },
      async deleteModule(moduleId: string) {
        const next = await base.deleteModule(moduleId);
        pushModuleAudit(dispatch, "module-deleted", `已删除业务模块 ${moduleId}`);
        return next;
      },
      async createMapping(input: CreateModuleMappingInput) {
        const next = await base.createMapping(input);
        pushModuleAudit(
          dispatch,
          "module-mapping-created",
          `已创建映射 ${input.matchKind}:${input.matchValue}`
        );
        return next;
      },
      async deleteMapping(mappingId: string) {
        const next = await base.deleteMapping(mappingId);
        pushModuleAudit(dispatch, "module-mapping-deleted", `已删除映射 ${mappingId}`);
        return next;
      },
      async recomputeBindings(input) {
        const result = await base.recomputeBindings(input);
        pushModuleAudit(
          dispatch,
          "module-bindings-recomputed",
          `已重算模块归属，更新 ${result.updated} 个参数绑定`
        );
        return result;
      }
    };
  }, [application, dispatch]);

  return (
    <ParameterModuleMappingPanel
      canAdmin
      repository={repository}
      observedDrivers={observedDrivers}
    />
  );
}
