import type {
  ActivateOrganizationDriverSchemaResult,
  CreateModuleMappingInput,
  CreateOrganizationDriverSchemaInput,
  CreateParameterModuleInput,
  DriverRegistryEntry,
  MappingApplyPreview,
  ModuleDiscoveryHints,
  OrganizationDriverSchema,
  ParameterModuleRegistryRepository,
  RegisterOrClaimDriverInput,
  RecomputeBindingModulesResult,
  UpdateDriverRegistrationDefaultInput,
  UpdateDriverRegistrationInput,
  UpdateParameterModuleInput,
  UpdateOrganizationDriverSchemaInput
} from "@/application/ports/ParameterModuleRegistryRepository";
import type {
  ParameterModule,
  ParameterModuleMapping,
  ParameterModuleRegistry
} from "@/domain/parameter-topology/moduleRegistry";
import { aggregateSubtreeAttributionCounts } from "@/components/parameter-topology/moduleAttributionTreeUtils";
import { mockApiError } from "./mockApiError";

type Store = {
  modules: ParameterModule[];
  mappings: ParameterModuleMapping[];
  discovery: ModuleDiscoveryHints;
  dismissed: string[];
  recomputeResult: RecomputeBindingModulesResult;
  driverRegistry: DriverRegistryEntry[];
  organizationDriverSchemas: OrganizationDriverSchema[];
};

function cloneRegistry(store: Store): ParameterModuleRegistry {
  const modules = store.modules.map((module) => ({ ...module }));
  const subtreeCounts = aggregateSubtreeAttributionCounts(modules);
  return {
    modules: modules.map((module) => {
      const counts = subtreeCounts.get(module.id);
      return {
        ...module,
        parameterCount: counts?.parameterCount ?? 0,
        definitionCount: counts?.definitionCount ?? 0
      };
    }),
    mappings: store.mappings.map((mapping) => ({ ...mapping }))
  };
}

function emptyPreview(toModuleId: string | null = null): MappingApplyPreview {
  return {
    affectedBindings: 0,
    byProject: [],
    fromModules: [],
    toModuleId,
    emptiedModules: [],
    conflicts: []
  };
}

function cloneDiscovery(store: Store): ModuleDiscoveryHints {
  const dismissed = new Set(store.dismissed.map((value) => value.toLowerCase()));
  const compatibles = store.discovery.compatibles.filter(
    (hint) => !dismissed.has(hint.compatible.toLowerCase())
  );
  return {
    compatibles: compatibles.map((hint) => ({ ...hint })),
    dismissedCompatibles: store.discovery.compatibles
      .filter((hint) => dismissed.has(hint.compatible.toLowerCase()))
      .map((hint) => ({
        ...hint,
        reason: "",
        dismissedAt: "2026-07-30T00:00:00.000Z"
      })),
    total: compatibles.length
  };
}

function createSeedStore(): Store {
  return {
    modules: [
      {
        id: "mod-charging",
        name: "充电策略",
        parentId: null,
        sortOrder: 0,
        description: "充电相关业务分类",
        scope: "组织",
        importance: "high",
        kind: "business",
        origin: "curated",
        sourceKey: null,
        effectiveImportance: "high",
        parameterCount: 12,
        definitionCount: 12
      },
      {
        id: "mod-battery",
        name: "电池安全",
        parentId: "mod-charging",
        sortOrder: 1,
        description: "电池安全子分类",
        scope: "组织",
        importance: "medium",
        kind: "business",
        origin: "curated",
        sourceKey: null,
        effectiveImportance: "high",
        parameterCount: 4,
        definitionCount: 4
      },
      {
        id: "mod-sc8562",
        name: "SC8562",
        parentId: "mod-charging",
        sortOrder: 2,
        description: "SC8562 驱动组（身份纠错夹具）",
        scope: "组织",
        importance: "medium",
        kind: "driver-group",
        origin: "curated",
        sourceKey: "compatible:vendor,sc8562",
        effectiveImportance: "high",
        parameterCount: 0,
        definitionCount: 0,
        attributionSubjectId: "asub:driver:sc8562"
      },
      {
        id: "mod-mt5788",
        name: "MT5788",
        parentId: "mod-charging",
        sortOrder: 3,
        description: "MT5788 驱动组（身份纠错夹具）",
        scope: "组织",
        importance: "medium",
        kind: "driver-group",
        origin: "curated",
        sourceKey: "compatible:vendor,mt5788",
        effectiveImportance: "high",
        parameterCount: 0,
        definitionCount: 0,
        attributionSubjectId: "asub:driver:mt5788"
      },
      {
        id: "mod-charger-nt",
        name: "charger",
        parentId: "mod-sc8562",
        sortOrder: 4,
        description: "charger 节点类型（无 gpio_int，供成功再归属）",
        scope: "组织",
        importance: "medium",
        kind: "node-type",
        origin: "curated",
        sourceKey: "nodetype:charger",
        effectiveImportance: "high",
        parameterCount: 0,
        definitionCount: 0,
        attributionSubjectId: "asub:nodetype:charger"
      },
      {
        id: "mod-unmapped-ic",
        name: "unmapped-ic",
        parentId: "mod-battery",
        sortOrder: 5,
        description: "自动发现的驱动组（回放夹具）",
        scope: "组织",
        importance: "medium",
        kind: "driver-group",
        origin: "auto",
        sourceKey: "compatible:vendor,unmapped-ic",
        effectiveImportance: "high",
        parameterCount: 2,
        definitionCount: 2,
        attributionSubjectId: "asub:driver:unmapped-ic"
      }
    ],
    mappings: [
      {
        id: "map-sc8562-compatible",
        moduleId: "mod-charging",
        matchKind: "compatible",
        matchValue: "vendor,sc8562",
        priority: 100
      }
    ],
    discovery: {
      compatibles: [
        {
          compatible: "vendor,unmapped-ic",
          bindingCount: 2,
          projectCount: 1,
          suggestedGroupName: "unmapped-ic"
        }
      ],
      dismissedCompatibles: [],
      total: 1
    },
    dismissed: [],
    recomputeResult: { updated: 2, conflicts: [] },
    driverRegistry: [
      {
        moduleId: "mod-sc8562",
        name: "SC8562",
        origin: "curated",
        businessCategoryId: "mod-charging",
        businessCategoryName: "充电策略",
        defaultBusinessCategoryId: "mod-charging",
        compatibles: ["vendor,sc8562"],
        parameterCount: 12,
        observed: true,
        notYetObserved: false,
        driverNature: "physical-device",
        instanceCardinality: "multiple",
        parseCoverages: [
          {
            compatible: "vendor,sc8562",
            coverage: { covered: true, pattern: "vendor,sc8562", driverId: "sc8562", source: "pinned", scope: "platform" }
          }
        ]
      },
      {
        moduleId: "mod-unmapped-ic",
        name: "unmapped-ic",
        origin: "auto",
        businessCategoryId: "mod-battery",
        businessCategoryName: "电池安全",
        defaultBusinessCategoryId: "mod-charging",
        compatibles: ["vendor,unmapped-ic"],
        parameterCount: 2,
        observed: true,
        notYetObserved: false,
        driverNature: "physical-device",
        instanceCardinality: "multiple",
        parseCoverages: [
          {
            compatible: "vendor,unmapped-ic",
            coverage: { covered: false }
          }
        ]
      }
    ],
    organizationDriverSchemas: [
      {
        id: "ods-mock-seed",
        compatible: "vendor,sc8562",
        displayName: "SC8562 组织解析",
        notes: "演示用组织级解析",
        lifecycle: "active",
        version: 1,
        properties: [
          {
            id: "ods-prop-mock-seed",
            parameterSpecId: "pspec-mock-seed",
            propertyKey: "gpio-int",
            valueShape: { kind: "u32-array" as const },
            units: null,
            documentation: ""
          }
        ]
      }
    ]
  };
}

/**
 * Mock adapter for ParameterModuleRegistryRepository (ADR-0002).
 * Same semantic model as the HTTP client — fixtures, not a separate product.
 */
export function createMockParameterModuleRegistryRepository(
  seed: Partial<Store> = {}
): ParameterModuleRegistryRepository {
  const base = createSeedStore();
  const store: Store = {
    modules: seed.modules ? seed.modules.map((module) => ({ ...module })) : base.modules,
    mappings: seed.mappings ? seed.mappings.map((mapping) => ({ ...mapping })) : base.mappings,
    discovery: seed.discovery
      ? {
          compatibles: seed.discovery.compatibles.map((hint) => ({ ...hint })),
          dismissedCompatibles: seed.discovery.dismissedCompatibles.map((hint) => ({ ...hint })),
          total: seed.discovery.total
        }
      : base.discovery,
    dismissed: seed.dismissed ? [...seed.dismissed] : [],
    recomputeResult: seed.recomputeResult ?? base.recomputeResult,
    driverRegistry: seed.driverRegistry
      ? seed.driverRegistry.map((entry) => ({
          ...entry,
          compatibles: [...entry.compatibles],
          parseCoverages: entry.parseCoverages.map((row) => ({ ...row, coverage: { ...row.coverage } }))
        }))
      : base.driverRegistry,
    organizationDriverSchemas: seed.organizationDriverSchemas
      ? seed.organizationDriverSchemas.map((schema) => ({
          ...schema,
          properties: schema.properties.map((property) => ({ ...property }))
        }))
      : base.organizationDriverSchemas
  };
  let moduleSeq = 0;
  let mappingSeq = 0;

  return {
    async getRegistry() {
      return cloneRegistry(store);
    },

    async getDiscoveryHints() {
      return cloneDiscovery(store);
    },

    async dismissCompatible(input) {
      const key = input.compatible.trim().toLowerCase();
      if (!store.dismissed.some((value) => value.toLowerCase() === key)) {
        store.dismissed.push(input.compatible.trim());
      }
      return cloneDiscovery(store);
    },

    async restoreDismissedCompatible(compatible: string) {
      const key = compatible.trim().toLowerCase();
      store.dismissed = store.dismissed.filter((value) => value.toLowerCase() !== key);
      return cloneDiscovery(store);
    },

    async createModule(input: CreateParameterModuleInput) {
      moduleSeq += 1;
      const kind = input.kind ?? "business";
      const origin = input.origin ?? "curated";
      const importance = kind === "business" ? (input.importance ?? "medium") : "medium";
      const moduleId = `mod-mock-${moduleSeq}`;
      store.modules.push({
        id: moduleId,
        name: input.name,
        parentId: input.parentId ?? null,
        sortOrder: input.sortOrder ?? store.modules.length,
        description: input.description ?? "",
        scope: input.scope ?? "",
        importance,
        kind,
        origin,
        sourceKey: input.sourceKey ?? null,
        effectiveImportance: importance,
        parameterCount: 0,
        definitionCount: 0
      });
      if (kind === "driver-group" && (input.compatibles?.length ?? 0) > 0) {
        for (const compatible of input.compatibles ?? []) {
          mappingSeq += 1;
          store.mappings.push({
            id: `map-mock-${mappingSeq}`,
            moduleId,
            matchKind: "compatible",
            matchValue: compatible.trim().toLowerCase(),
            priority: 0
          });
        }
      }
      return cloneRegistry(store);
    },

    async updateModule(moduleId: string, input: UpdateParameterModuleInput) {
      const target = store.modules.find((module) => module.id === moduleId);
      if (!target) {
        throw mockApiError("NOT_FOUND", `Module not found: ${moduleId}`, { moduleId });
      }
      if (input.name !== undefined) {
        target.name = input.name;
        if (target.origin === "auto") target.origin = "curated";
      }
      if (input.description !== undefined) target.description = input.description;
      if (input.scope !== undefined) target.scope = input.scope;
      if (input.parentId !== undefined) {
        target.parentId = input.parentId;
        if (target.origin === "auto") target.origin = "curated";
      }
      if (input.sortOrder !== undefined) target.sortOrder = input.sortOrder;
      if (input.importance !== undefined) {
        target.importance = input.importance;
        target.effectiveImportance = input.importance;
        if (target.origin === "auto") target.origin = "curated";
      }
      if (input.kind !== undefined) {
        target.kind = input.kind;
        if (input.kind !== "business") {
          target.importance = "medium";
        }
        if (target.origin === "auto") target.origin = "curated";
      }
      return cloneRegistry(store);
    },

    async deleteModule(moduleId: string) {
      store.modules = store.modules.filter((module) => module.id !== moduleId);
      store.mappings = store.mappings.filter((mapping) => mapping.moduleId !== moduleId);
      return cloneRegistry(store);
    },

    async previewMapping(input: CreateModuleMappingInput) {
      return {
        ...emptyPreview(input.moduleId),
        affectedBindings: input.matchKind === "compatible" ? 2 : 1
      };
    },

    async createMapping(input: CreateModuleMappingInput) {
      mappingSeq += 1;
      store.mappings.push({
        id: `map-mock-${mappingSeq}`,
        moduleId: input.moduleId,
        matchKind: input.matchKind,
        matchValue: input.matchValue,
        priority: input.priority ?? 0
      });
      store.discovery.compatibles = store.discovery.compatibles.filter(
        (hint) => hint.compatible.toLowerCase() !== input.matchValue.trim().toLowerCase()
      );
      store.discovery.total = store.discovery.compatibles.length;
      return {
        registry: cloneRegistry(store),
        apply: {
          ...emptyPreview(input.moduleId),
          affectedBindings: 2
        }
      };
    },

    async deleteMapping(mappingId: string) {
      store.mappings = store.mappings.filter((mapping) => mapping.id !== mappingId);
      return {
        registry: cloneRegistry(store),
        apply: emptyPreview(null)
      };
    },

    async recomputeBindings(input?: { projectId?: string; dryRun?: boolean }) {
      if (input?.dryRun) {
        return {
          updated: store.recomputeResult.updated,
          conflicts: [...store.recomputeResult.conflicts],
          dryRun: true,
          preview: {
            ...emptyPreview(null),
            affectedBindings: store.recomputeResult.updated
          }
        };
      }
      return { ...store.recomputeResult, conflicts: [...store.recomputeResult.conflicts] };
    },

    async listDriverRegistry() {
      return {
        items: store.driverRegistry.map((entry) => ({
          ...entry,
          compatibles: [...entry.compatibles],
          parseCoverages: entry.parseCoverages.map((row) => ({ ...row, coverage: { ...row.coverage } }))
        })),
        total: store.driverRegistry.length
      };
    },

    async registerOrClaimDriver(input: RegisterOrClaimDriverInput) {
      moduleSeq += 1;
      const moduleId = `mod-mock-driver-${moduleSeq}`;
      const business = store.modules.find((module) => module.id === input.businessCategoryId);
      const compatibles = [...new Set(input.compatibles.map((value) => value.trim().toLowerCase()))];
      const existing = store.driverRegistry.find((entry) =>
        entry.compatibles.some((compatible) => compatibles.includes(compatible))
      );
      const mode = existing ? "claimed" : "registered";
      const targetId = existing?.moduleId ?? moduleId;
      const entry: DriverRegistryEntry = {
        moduleId: targetId,
        name: input.displayName.trim(),
        origin: "curated",
        businessCategoryId: input.businessCategoryId,
        businessCategoryName: business?.name ?? null,
        defaultBusinessCategoryId: input.businessCategoryId,
        compatibles,
        parameterCount: existing?.parameterCount ?? 0,
        observed: (existing?.parameterCount ?? 0) > 0,
        notYetObserved: (existing?.parameterCount ?? 0) === 0,
        driverNature: existing?.driverNature ?? "physical-device",
        instanceCardinality: existing?.instanceCardinality ?? "multiple",
        parseCoverages: compatibles.map((compatible) => ({
          compatible,
          coverage: { covered: false }
        }))
      };
      if (existing) {
        const index = store.driverRegistry.indexOf(existing);
        store.driverRegistry[index] = entry;
      } else {
        store.driverRegistry.push(entry);
        store.modules.push({
          id: moduleId,
          name: input.displayName.trim(),
          parentId: input.businessCategoryId,
          sortOrder: store.modules.length,
          description: input.notes ?? "",
          scope: "",
          importance: "medium",
          kind: "driver-group",
          origin: "curated",
          sourceKey: `compatible:${compatibles[0]}`,
          effectiveImportance: "medium",
          parameterCount: 0,
          definitionCount: 0
        });
        for (const compatible of compatibles) {
          mappingSeq += 1;
          store.mappings.push({
            id: `map-mock-${mappingSeq}`,
            moduleId,
            matchKind: "compatible",
            matchValue: compatible,
            priority: 0
          });
        }
      }
      return {
        mode,
        item: {
          id: targetId,
          name: entry.name,
          parentId: input.businessCategoryId,
          kind: "driver-group" as const,
          origin: "curated" as const,
          description: input.notes
        },
        apply: {
          affectedBindings: 0,
          byProject: [],
          fromModules: [],
          toModuleId: targetId,
          emptiedModules: [],
          conflicts: []
        }
      };
    },

    async updateDriverRegistration(moduleId: string, input: UpdateDriverRegistrationInput) {
      const index = store.driverRegistry.findIndex((entry) => entry.moduleId === moduleId);
      if (index < 0) {
        throw mockApiError("NOT_FOUND", `Driver registry entry not found: ${moduleId}`, { moduleId });
      }
      const existing = store.driverRegistry[index];
      const next = {
        ...existing,
        driverNature: input.driverNature ?? existing.driverNature,
        instanceCardinality: input.instanceCardinality ?? existing.instanceCardinality
      };
      store.driverRegistry[index] = next;
      return {
        moduleId,
        driverNature: next.driverNature ?? "physical-device",
        instanceCardinality: next.instanceCardinality ?? "multiple",
        attributionSubjectId: `asub:driver-registration:${moduleId}`
      };
    },

    async updateDriverRegistrationDefault(
      moduleId: string,
      input: UpdateDriverRegistrationDefaultInput
    ) {
      const entry = store.driverRegistry.find((row) => row.moduleId === moduleId);
      if (!entry) {
        throw mockApiError("NOT_FOUND", "Driver registry entry not found");
      }
      const business = store.modules.find((module) => module.id === input.defaultBusinessCategoryId);
      const moved =
        entry.origin === "auto" && entry.businessCategoryId !== input.defaultBusinessCategoryId ? 1 : 0;
      const skippedCurated = entry.origin === "curated" ? 1 : 0;
      entry.defaultBusinessCategoryId = input.defaultBusinessCategoryId;
      if (entry.origin === "auto") {
        entry.businessCategoryId = input.defaultBusinessCategoryId;
        entry.businessCategoryName = business?.name ?? null;
        const module = store.modules.find((row) => row.id === moduleId);
        if (module) module.parentId = input.defaultBusinessCategoryId;
      }
      return {
        item: {
          id: moduleId,
          name: entry.name,
          parentId: entry.businessCategoryId,
          kind: "driver-group" as const,
          origin: entry.origin
        },
        defaultBusinessCategoryId: input.defaultBusinessCategoryId,
        replay: {
          moved,
          skippedCurated,
          skippedMissingDefault: 0
        }
      };
    },

    async replayDriverPlacement(moduleId: string) {
      const entry = store.driverRegistry.find((row) => row.moduleId === moduleId);
      if (!entry) {
        throw mockApiError("NOT_FOUND", "Driver registry entry not found");
      }
      if (!entry.defaultBusinessCategoryId) {
        return {
          moduleId,
          moved: 0,
          skippedCurated: 0,
          skippedMissingDefault: 1
        };
      }
      if (entry.origin !== "auto") {
        return {
          moduleId,
          moved: 0,
          skippedCurated: 1,
          skippedMissingDefault: 0
        };
      }
      const business = store.modules.find(
        (module) => module.id === entry.defaultBusinessCategoryId
      );
      const moved = entry.businessCategoryId !== entry.defaultBusinessCategoryId ? 1 : 0;
      entry.businessCategoryId = entry.defaultBusinessCategoryId;
      entry.businessCategoryName = business?.name ?? null;
      const module = store.modules.find((row) => row.id === moduleId);
      if (module) module.parentId = entry.defaultBusinessCategoryId;
      return {
        moduleId,
        moved,
        skippedCurated: 0,
        skippedMissingDefault: 0
      };
    },

    async createOrganizationDriverSchema(input: CreateOrganizationDriverSchemaInput) {
      const schema: OrganizationDriverSchema = {
        id: `ods-mock-${store.organizationDriverSchemas.length + 1}`,
        compatible: input.compatible,
        displayName: input.displayName,
        notes: input.notes ?? "",
        lifecycle: "draft",
        version: 1,
        properties: input.properties.map((property, index) => {
          if ("parameterSpecId" in property) {
            return {
              id: `ods-prop-mock-${index + 1}`,
              parameterSpecId: property.parameterSpecId,
              propertyKey: property.propertyKey ?? `linked-${index + 1}`,
              valueShape: { kind: "unknown" as const },
              units: null,
              documentation: ""
            };
          }
          return {
            id: `ods-prop-mock-${index + 1}`,
            parameterSpecId: `pspec-mock-${index + 1}`,
            propertyKey: property.propertyKey,
            valueShape: property.valueShape,
            units: property.units ?? null,
            documentation: property.documentation ?? ""
          };
        })
      };
      store.organizationDriverSchemas.push(schema);
      return schema;
    },

    async listOrganizationDriverSchemas() {
      return store.organizationDriverSchemas.map((schema) => ({
        ...schema,
        properties: schema.properties.map((property) => ({ ...property }))
      }));
    },

    async updateOrganizationDriverSchema(
      schemaId: string,
      input: UpdateOrganizationDriverSchemaInput
    ) {
      const schema = store.organizationDriverSchemas.find((item) => item.id === schemaId);
      if (!schema) {
        throw mockApiError("NOT_FOUND", `Organization driver schema not found: ${schemaId}`, { schemaId });
      }
      if (input.displayName !== undefined) schema.displayName = input.displayName;
      if (input.notes !== undefined) schema.notes = input.notes;
      return { ...schema, properties: schema.properties.map((property) => ({ ...property })) };
    },

    async activateOrganizationDriverSchema(schemaId: string): Promise<ActivateOrganizationDriverSchemaResult> {
      const schema = store.organizationDriverSchemas.find((item) => item.id === schemaId);
      if (!schema) {
        throw mockApiError("NOT_FOUND", `Organization driver schema not found: ${schemaId}`, { schemaId });
      }
      schema.lifecycle = "active";
      for (const entry of store.driverRegistry) {
        entry.parseCoverages = entry.parseCoverages.map((row) => {
          if (row.compatible !== schema.compatible) return row;
          return {
            compatible: row.compatible,
            coverage: {
              covered: true,
              pattern: schema.compatible,
              driverId: `driver:org/mock/${schema.compatible}:v${schema.version}`,
              source: "manual",
              scope: "organization"
            }
          };
        });
      }
      return {
        schema: { ...schema, properties: schema.properties.map((property) => ({ ...property })) },
        upgradedSpecIds: [],
        resolvedReviewTaskIds: []
      };
    },

    async previewOrganizationDriverSchemaDeprecation(schemaId: string) {
      const schema = store.organizationDriverSchemas.find((item) => item.id === schemaId);
      if (!schema) throw mockApiError("NOT_FOUND", `Organization driver schema not found: ${schemaId}`, { schemaId });
      const successorSource = schema.supersededBySchemaId
        ? {
            scope: "platform" as const,
            schemaId: schema.supersededBySchemaId,
            displayName: schema.supersededBySchemaId
          }
        : null;
      return {
        schemaId,
        compatible: schema.compatible,
        coverageLoss: schema.lifecycle === "active" && successorSource === null,
        definitionCount: schema.properties.length,
        projectCount: 0,
        successorSource
      };
    },

    async deprecateOrganizationDriverSchema(
      schemaId: string,
      input: { confirmCoverageLoss?: boolean } = {}
    ) {
      const schema = store.organizationDriverSchemas.find((item) => item.id === schemaId);
      if (!schema) throw mockApiError("NOT_FOUND", `Organization driver schema not found: ${schemaId}`, { schemaId });
      if (
        schema.lifecycle === "active" &&
        !schema.supersededBySchemaId &&
        !input.confirmCoverageLoss
      ) {
        throw mockApiError("VALIDATION_FAILED", "High-risk coverage loss confirmation is required.");
      }
      schema.lifecycle = "deprecated";
      return { ...schema, properties: schema.properties.map((property) => ({ ...property })) };
    }
  };
}
