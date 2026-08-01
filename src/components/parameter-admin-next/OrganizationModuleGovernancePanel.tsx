import { useMemo } from "react";
import type {
  CreateModuleMappingInput,
  CreateOrganizationDriverSchemaInput,
  CreateParameterModuleInput,
  ParameterModuleRegistryRepository,
  UpdateParameterModuleInput
} from "@/application/ports/ParameterModuleRegistryRepository";
import type { ParameterAdminAuditHint } from "@/application/parameters/parameterAdminState";
import { mapParameterSpecToLibraryRow } from "@/components/parameter-topology/ParameterSpecLibrary";
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
export function OrganizationModuleGovernancePanel({
  pathname = "/parameter-admin/modules",
  search = "",
  onNavigate
}: {
  pathname?: string;
  search?: string;
  onNavigate?: (path: string) => void;
}) {
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
        const kindLabel =
          input.kind === "driver-group"
            ? "驱动组"
            : input.kind === "node-type"
              ? "节点类型"
              : "业务模块";
        pushModuleAudit(dispatch, "module-created", `已创建${kindLabel}「${input.name}」`);
        return next;
      },
      async updateModule(moduleId: string, input: UpdateParameterModuleInput) {
        const next = await base.updateModule(moduleId, input);
        if (input.name !== undefined) {
          pushModuleAudit(dispatch, "module-renamed", `已更新业务模块「${input.name}」`);
        } else if (input.parentId !== undefined) {
          pushModuleAudit(dispatch, "module-moved", `已移动业务模块 ${moduleId}`);
        } else if (
          input.description !== undefined ||
          input.scope !== undefined ||
          input.importance !== undefined
        ) {
          pushModuleAudit(dispatch, "module-renamed", `已更新业务模块 ${moduleId}`);
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
      },
      listDriverRegistry: () => base.listDriverRegistry(),
      async registerOrClaimDriver(input) {
        const result = await base.registerOrClaimDriver(input);
        pushModuleAudit(
          dispatch,
          "module-created",
          result.mode === "claimed"
            ? `已认领驱动组「${result.item.name}」`
            : `已登记驱动组「${result.item.name}」`
        );
        return result;
      },
      async updateDriverRegistration(moduleId, input) {
        const result = await base.updateDriverRegistration(moduleId, input);
        pushModuleAudit(
          dispatch,
          "module-renamed",
          `已更新驱动登记 ${moduleId}`
        );
        return result;
      },
      createOrganizationDriverSchema: (input: CreateOrganizationDriverSchemaInput) =>
        base.createOrganizationDriverSchema(input),
      listOrganizationDriverSchemas: () => base.listOrganizationDriverSchemas(),
      updateOrganizationDriverSchema: (schemaId, input) =>
        base.updateOrganizationDriverSchema(schemaId, input),
      activateOrganizationDriverSchema: async (schemaId) => {
        const result = await base.activateOrganizationDriverSchema(schemaId);
        pushModuleAudit(
          dispatch,
          "module-created",
          `已激活组织解析 schema「${result.schema.displayName}」`
        );
        return result;
      },
      previewOrganizationDriverSchemaDeprecation: (schemaId) =>
        base.previewOrganizationDriverSchemaDeprecation?.(schemaId) ??
        Promise.reject(new Error("Overlay deprecation preview is unavailable.")),
      deprecateOrganizationDriverSchema: async (schemaId, input) => {
        if (!base.deprecateOrganizationDriverSchema) {
          throw new Error("Overlay deprecation is unavailable.");
        }
        const schema = await base.deprecateOrganizationDriverSchema(schemaId, input);
        pushModuleAudit(
          dispatch,
          "module-mapping-deleted",
          `已停用解析「${schema.displayName}」（${schema.compatible}）`
        );
        return schema;
      }
    };
  }, [application, dispatch]);

  return (
    <ParameterModuleMappingPanel
      canAdmin
      repository={repository}
      listLibrarySpecs={async () => {
        const specs = await application.listSpecs({});
        return specs.map((spec) =>
          mapParameterSpecToLibraryRow({
            id: spec.id,
            organizationId: spec.organizationId ?? null,
            propertyKey: spec.propertyKey,
            specificationKey: spec.specificationKey,
            driverModule: spec.driverModule,
            lifecycle: spec.lifecycle,
            currentVersion: spec.currentVersion,
            compatiblePatterns: spec.compatiblePatterns,
            valueShape: spec.valueShape,
            attributionModules: spec.attributionModules,
          })
        );
      }}
      pathname={pathname}
      search={search}
      onNavigate={onNavigate}
    />
  );
}
