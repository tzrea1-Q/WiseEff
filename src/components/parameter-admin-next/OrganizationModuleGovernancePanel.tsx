import { useMemo } from "react";
import type { CatalogActorKind } from "@/application/parameter-catalog/authority";
import type {
  CreateModuleMappingInput,
  CreateOrganizationDriverSchemaInput,
  CreateParameterModuleInput,
  ParameterModuleRegistryRepository,
  UpdateParameterModuleInput
} from "@/application/ports/ParameterModuleRegistryRepository";
import type { ParameterCatalogRepository } from "@/application/ports/ParameterCatalogRepository";
import type { ParameterCatalogGovernanceRepository } from "@/application/ports/ParameterCatalogGovernanceRepository";
import type { ParameterAdminApplication } from "@/application/parameters/parameterAdminApplication";
import {
  listAllCanonicalPages,
} from "./CanonicalSubjectPlacementPanel";
import {
  mapParameterSpecToLibraryRow,
  type ParameterSpecLibraryRow
} from "@/components/parameter-topology/ParameterSpecLibrary";
import { ParameterModuleMappingPanel } from "@/components/parameter-topology/ParameterModuleMappingPanel";
import { useParameterAdmin } from "./ParameterAdminProvider";
import { useRefreshParameterAdminRecentAudits } from "./useRefreshParameterAdminRecentAudits";

/**
 * Overlay spec library for linking DTS coverage properties.
 * Catalog `listDefinitions` is canonical current. Default/effective `listSpecs`
 * is mock/no-catalog only. Never `view=governance`.
 */
export async function listModuleOverlayLibrarySpecs(input: {
  catalog?: Pick<ParameterCatalogRepository, "listDefinitions"> | null;
  listSpecs: ParameterAdminApplication["listSpecs"];
  catalogReleaseId?: string;
}): Promise<ParameterSpecLibraryRow[]> {
  if (input.catalog) {
    const definitions = await listAllCanonicalPages(
      (query) => input.catalog!.listDefinitions(query),
      {
        lifecycle: "active",
        registration: "active",
        limit: 50,
        ...(input.catalogReleaseId ? { catalogReleaseId: input.catalogReleaseId } : {})
      }
    );
    return definitions.map((definition) =>
      mapParameterSpecToLibraryRow({
        id: definition.id,
        propertyKey: definition.propertyKey,
        lifecycle: definition.lifecycle,
        currentVersion: definition.currentRevision.revisionNumber,
        valueShape: definition.currentRevision.valueShape,
        declaredPlacement:
          definition.registration.status === "active" &&
          definition.registration.placement?.moduleId
            ? {
                moduleId: definition.registration.placement.moduleId,
                moduleName: definition.registration.placement.displayName,
                categoryId: null,
                categoryName: null
              }
            : null
      })
    );
  }
  const specs = await input.listSpecs();
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
      declaredPlacement: spec.declaredPlacement ?? null
    })
  );
}

/**
 * Organization-scoped module tree + driver mapping, composed over the admin facade.
 */
export function OrganizationModuleGovernancePanel({
  pathname = "/parameter-admin/modules",
  search = "",
  onNavigate,
  catalog,
  governance,
  organizationId,
  actor = "user",
  sessionPermissions,
  canonicalEnabled = false
}: {
  pathname?: string;
  search?: string;
  onNavigate?: (path: string) => void;
  catalog?: ParameterCatalogRepository | null;
  governance?: ParameterCatalogGovernanceRepository | null;
  organizationId?: string;
  actor?: CatalogActorKind;
  sessionPermissions?: readonly string[] | null;
  canonicalEnabled?: boolean;
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
      listLibrarySpecs={() =>
        listModuleOverlayLibrarySpecs({
          catalog,
          listSpecs: application.listSpecs
        })
      }
      pathname={pathname}
      search={search}
      onNavigate={onNavigate}
      canonicalCatalog={canonicalEnabled ? catalog ?? undefined : undefined}
      canonicalGovernance={canonicalEnabled ? governance ?? undefined : undefined}
      canonicalOrganizationId={canonicalEnabled ? organizationId : undefined}
      canonicalActor={actor}
      canonicalSessionPermissions={sessionPermissions}
      canonicalEnabled={canonicalEnabled}
    />
  );
}
