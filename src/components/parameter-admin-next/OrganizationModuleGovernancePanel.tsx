import { useMemo } from "react";
import type {
  CreateModuleMappingInput,
  CreateOrganizationDriverSchemaInput,
  CreateParameterModuleInput,
  ParameterModuleRegistryRepository,
  UpdateParameterModuleInput
} from "@/application/ports/ParameterModuleRegistryRepository";
import { mapParameterSpecToLibraryRow } from "@/components/parameter-topology/ParameterSpecLibrary";
import { ParameterModuleMappingPanel } from "@/components/parameter-topology/ParameterModuleMappingPanel";
import { useParameterAdmin } from "./ParameterAdminProvider";
import { useRefreshParameterAdminRecentAudits } from "./useRefreshParameterAdminRecentAudits";

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
  const { application } = useParameterAdmin();
  const refreshRecentAudits = useRefreshParameterAdminRecentAudits();

  const repository = useMemo((): ParameterModuleRegistryRepository => {
    const base = application.asModuleRegistryRepository();
    return {
      getRegistry: () => base.getRegistry(),
      getDiscoveryHints: () => base.getDiscoveryHints(),
      dismissCompatible: async (input) => {
        const next = await base.dismissCompatible(input);
        await refreshRecentAudits();
        return next;
      },
      restoreDismissedCompatible: async (compatible) => {
        const next = await base.restoreDismissedCompatible(compatible);
        await refreshRecentAudits();
        return next;
      },
      async createModule(input: CreateParameterModuleInput) {
        const next = await base.createModule(input);
        await refreshRecentAudits();
        return next;
      },
      async updateModule(moduleId: string, input: UpdateParameterModuleInput) {
        const next = await base.updateModule(moduleId, input);
        if (
          input.name !== undefined ||
          input.parentId !== undefined ||
          input.description !== undefined ||
          input.scope !== undefined ||
          input.importance !== undefined
        ) {
          await refreshRecentAudits();
        }
        return next;
      },
      async deleteModule(moduleId: string) {
        const next = await base.deleteModule(moduleId);
        await refreshRecentAudits();
        return next;
      },
      previewMapping: (input) => base.previewMapping(input),
      async createMapping(input: CreateModuleMappingInput) {
        const next = await base.createMapping(input);
        await refreshRecentAudits();
        return next;
      },
      async deleteMapping(mappingId: string) {
        const next = await base.deleteMapping(mappingId);
        await refreshRecentAudits();
        return next;
      },
      async recomputeBindings(input) {
        const result = await base.recomputeBindings(input);
        await refreshRecentAudits();
        return result;
      },
      listDriverRegistry: () => base.listDriverRegistry(),
      async registerOrClaimDriver(input) {
        const result = await base.registerOrClaimDriver(input);
        await refreshRecentAudits();
        return result;
      },
      async updateDriverRegistration(moduleId, input) {
        const result = await base.updateDriverRegistration(moduleId, input);
        await refreshRecentAudits();
        return result;
      },
      async updateDriverRegistrationDefault(moduleId, input) {
        const result = await base.updateDriverRegistrationDefault(moduleId, input);
        await refreshRecentAudits();
        return result;
      },
      async replayDriverPlacement(moduleId) {
        const result = await base.replayDriverPlacement(moduleId);
        await refreshRecentAudits();
        return result;
      },
      createOrganizationDriverSchema: (input: CreateOrganizationDriverSchemaInput) =>
        base.createOrganizationDriverSchema(input),
      listOrganizationDriverSchemas: () => base.listOrganizationDriverSchemas(),
      updateOrganizationDriverSchema: (schemaId, input) =>
        base.updateOrganizationDriverSchema(schemaId, input),
      activateOrganizationDriverSchema: async (schemaId) => {
        const result = await base.activateOrganizationDriverSchema(schemaId);
        await refreshRecentAudits();
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
        await refreshRecentAudits();
        return schema;
      }
    };
  }, [application, refreshRecentAudits]);

  return (
    <ParameterModuleMappingPanel
      canAdmin
      repository={repository}
      listLibrarySpecs={async () => {
        const specs = await application.listSpecs({ view: "governance" });
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
