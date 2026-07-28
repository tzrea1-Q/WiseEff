import { useMemo } from "react";
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

  const repository = useMemo((): ParameterModuleRegistryRepository => {
    const base = application.asModuleRegistryRepository();
    return {
      getRegistry: () => base.getRegistry(),
      getDiscoveryHints: () => base.getDiscoveryHints(),
      dismissCompatible: async (input) => {
        const next = await base.dismissCompatible(input);
        pushModuleAudit(dispatch, "module-mapping-deleted", `已忽略 compatible ${input.compatible}`);
        return next;
      },
      restoreDismissedCompatible: async (compatible) => {
        const next = await base.restoreDismissedCompatible(compatible);
        pushModuleAudit(dispatch, "module-mapping-created", `已恢复 compatible ${compatible}`);
        return next;
      },
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
      previewMapping: (input) => base.previewMapping(input),
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
          `已重算模块归属，更新 ${result.updated} 个项目参数`
        );
        return result;
      }
    };
  }, [application, dispatch]);

  return <ParameterModuleMappingPanel canAdmin repository={repository} />;
}
