import type {
  ActivateParameterSpecInput,
  BindingDraftResult,
  CreateBindingDraftInput,
  CreateNodeEnablementDraftInput,
  NodeEnablementDraftResult,
  ParameterTopologyRepository
} from "@/application/ports/ParameterTopologyRepository";
import type {
  BindingCompareEntry,
  BindingHistoryEntry,
  IdentityMappingTask,
  ParameterSpecDetail,
  ParameterSpecSummary,
  ProjectParameterBinding,
  SpecReviewTask,
  TopologyTree,
  ValidationRun
} from "@/domain/parameter-topology/types";
import { driverFallbackModuleId } from "@/domain/parameter-topology/moduleRegistry";
import {
  withEffectiveEnablement,
  withSourceEnablement
} from "@/domain/parameter-topology/nodeEnablement";

const MOCK_NOW = "2026-07-14T10:00:00.000Z";
const DEFAULT_PROJECT_ID = "project-teaching";
const DEFAULT_CONFIG_SET_ID = "config-set-teaching";
const DEFAULT_REVISION_ID = "revision-teaching-1";
const DEFAULT_ORG_ID = "org-teaching";

type SpecFixture = ParameterSpecDetail;

type Store = {
  specs: Map<string, SpecFixture>;
  reviewTasks: SpecReviewTask[];
  bindingsByRevision: Map<string, ProjectParameterBinding[]>;
  bindingHistory: Map<string, BindingHistoryEntry[]>;
  bindingCompare: Map<string, BindingCompareEntry[]>;
  sourceTopology: TopologyTree;
  effectiveTopology: TopologyTree;
  mappingTasks: IdentityMappingTask[];
  validationRuns: Map<string, ValidationRun>;
};

function seedSpecs(): Map<string, SpecFixture> {
  const specs: SpecFixture[] = [
    {
      id: "spec-sc8562-gpio-int",
      organizationId: DEFAULT_ORG_ID,
      sourceKind: "dts",
      specificationKey: "dts/sc8562/gpio_int",
      propertyKey: "gpio_int",
      driverModule: "sc8562",
      lifecycle: "active",
      currentVersionId: "specver-sc8562-gpio-int-3",
      currentVersion: 3,
      displayName: "SC8562 GPIO interrupt",
      description: "Interrupt GPIO cells for the SC8562 charge pump.",
      valueShape: { kind: "cells", bits: 32, groups: 1, cellsPerGroup: 3 },
      schemaDefault: null,
      exampleValue: "<&gpio13 29 0>",
      schemaNamespace: "vendor,sc8562/bindings",
      units: null,
      constraints: { cellsPerGroup: 3 },
      documentation: "gpio_int is a three-cell interrupt specifier.",
      compatiblePatterns: ["vendor,sc8562"],
      policyTarget: null
    },
    {
      id: "spec-mt5788-gpio-int",
      organizationId: DEFAULT_ORG_ID,
      sourceKind: "dts",
      specificationKey: "dts/mt5788/gpio_int",
      propertyKey: "gpio_int",
      driverModule: "mt5788",
      lifecycle: "active",
      currentVersionId: "specver-mt5788-gpio-int-1",
      currentVersion: 1,
      displayName: "MT5788 GPIO interrupt",
      description: "Interrupt GPIO cells for the MT5788 wireless charger.",
      valueShape: { kind: "cells", bits: 32, groups: 1, cellsPerGroup: 3 },
      schemaDefault: null,
      exampleValue: "<&gpio6 15 0>",
      schemaNamespace: "vendor,mt5788/bindings",
      units: null,
      constraints: { cellsPerGroup: 3 },
      documentation: "gpio_int is a three-cell interrupt specifier.",
      compatiblePatterns: ["mediatek,mt5788"],
      policyTarget: null
    },
    {
      id: "spec-draft-mystery",
      organizationId: DEFAULT_ORG_ID,
      sourceKind: "manual",
      specificationKey: "manual/mystery_prop",
      propertyKey: "mystery_prop",
      driverModule: null,
      lifecycle: "draft",
      currentVersionId: "specver-draft-mystery-1",
      currentVersion: 1,
      displayName: "Mystery property (draft)",
      description: "Draft spec awaiting review activation.",
      valueShape: { kind: "strings" },
      schemaDefault: null,
      exampleValue: null,
      schemaNamespace: "manual",
      units: null,
      constraints: null,
      documentation: null,
      compatiblePatterns: null,
      policyTarget: null
    }
  ];
  return new Map(specs.map((spec) => [spec.id, spec]));
}

function seedBindings(): ProjectParameterBinding[] {
  return [
    {
      id: "binding-sc8562-gpio-int",
      parameterSpecId: "spec-sc8562-gpio-int",
      parameterSpecVersionId: "specver-sc8562-gpio-int-3",
      propertyKey: "gpio_int",
      driverModule: "sc8562",
      logicalNodeId: "logical-sc8562",
      instanceName: "sc8562@6E",
      locator: "/amba/i2c@FDF5E000/sc8562@6E",
      effectiveValue: {
        kind: "cells",
        bits: 32,
        groups: [
          [
            { kind: "phandle", label: "gpio13" },
            { kind: "integer", raw: "29", value: "29" },
            { kind: "integer", raw: "0", value: "0" }
          ]
        ]
      },
      rawValue: "<&gpio13 29 0>",
      schemaState: "valid",
      policyState: "pass",
      moduleId: driverFallbackModuleId("sc8562")
    },
    {
      id: "binding-mt5788-gpio-int",
      parameterSpecId: "spec-mt5788-gpio-int",
      parameterSpecVersionId: "specver-mt5788-gpio-int-1",
      propertyKey: "gpio_int",
      driverModule: "mt5788",
      logicalNodeId: "logical-mt5788",
      instanceName: "mt5788@55",
      locator: "/amba/i2c@FDF5E000/mt5788@55",
      effectiveValue: {
        kind: "cells",
        bits: 32,
        groups: [
          [
            { kind: "phandle", label: "gpio6" },
            { kind: "integer", raw: "15", value: "15" },
            { kind: "integer", raw: "0", value: "0" }
          ]
        ]
      },
      rawValue: "<&gpio6 15 0>",
      schemaState: "valid",
      policyState: "pass",
      moduleId: driverFallbackModuleId("mt5788")
    }
  ];
}

function seedSourceTopology(): TopologyTree {
  const nodes = withSourceEnablement(
    [
      {
        id: "src-amba",
        fileVersionId: "fv-base",
        fileName: "board.dts",
        parentOccurrenceId: null,
        name: "amba",
        labels: ["amba"],
        isOverlayRoot: false,
        nodePath: "/amba",
        startLine: 10,
        startColumn: 1,
        endLine: 200,
        endColumn: 1,
        contentHash: "hash-amba",
        sourceOrder: 1,
        properties: []
      },
      {
        id: "src-i2c",
        fileVersionId: "fv-base",
        fileName: "board.dts",
        parentOccurrenceId: "src-amba",
        name: "i2c",
        unitAddress: "FDF5E000",
        labels: [],
        isOverlayRoot: false,
        nodePath: "/amba/i2c@FDF5E000",
        startLine: 42,
        startColumn: 1,
        endLine: 120,
        endColumn: 1,
        contentHash: "hash-i2c",
        sourceOrder: 2,
        properties: [
          {
            id: "src-prop-i2c-status",
            propertyName: "status",
            startLine: 44,
            startColumn: 1,
            endLine: 44,
            endColumn: 20,
            contentHash: "hash-i2c-status",
            sourceOrder: 1,
            rawText: '"disabled"'
          }
        ]
      },
      {
        id: "src-sc8562",
        fileVersionId: "fv-overlay",
        fileName: "power.dtso",
        parentOccurrenceId: "src-i2c",
        name: "sc8562",
        unitAddress: "6E",
        labels: ["sc8562"],
        isOverlayRoot: false,
        nodePath: "/amba/i2c@FDF5E000/sc8562@6E",
        startLine: 42,
        startColumn: 1,
        endLine: 60,
        endColumn: 1,
        contentHash: "hash-sc8562",
        sourceOrder: 3,
        properties: [
          {
            id: "src-prop-gpio-int",
            propertyName: "gpio_int",
            startLine: 48,
            startColumn: 1,
            endLine: 48,
            endColumn: 30,
            contentHash: "hash-gpio-int",
            sourceOrder: 1
          },
          {
            id: "src-prop-status",
            propertyName: "status",
            startLine: 49,
            startColumn: 1,
            endLine: 49,
            endColumn: 18,
            contentHash: "hash-status",
            sourceOrder: 2,
            rawText: '"okay"'
          }
        ]
      }
    ].map((node) => ({
      ...node,
      rawStatus:
        [...node.properties].reverse().find((prop) => prop.propertyName === "status")?.rawText ?? null
    }))
  );

  return {
    view: "source",
    revisionId: DEFAULT_REVISION_ID,
    configSetId: DEFAULT_CONFIG_SET_ID,
    projectId: DEFAULT_PROJECT_ID,
    status: "resolved",
    incompleteBase: false,
    diagnostics: [],
    nodes
  };
}

function seedEffectiveTopology(): TopologyTree {
  const nodes = withEffectiveEnablement([
    {
      id: "eff-amba",
      logicalNodeId: "logical-amba",
      locator: "/amba",
      name: "amba",
      parentLogicalNodeId: null,
      rawStatus: null,
      effects: []
    },
    {
      id: "eff-i2c",
      logicalNodeId: "logical-i2c",
      locator: "/amba/i2c@FDF5E000",
      name: "i2c",
      unitAddress: "FDF5E000",
      parentLogicalNodeId: "logical-amba",
      rawStatus: '"disabled"',
      effects: []
    },
    {
      id: "eff-sc8562",
      logicalNodeId: "logical-sc8562",
      locator: "/amba/i2c@FDF5E000/sc8562@6E",
      name: "sc8562",
      unitAddress: "6E",
      compatible: "vendor,sc8562",
      parentLogicalNodeId: "logical-i2c",
      rawStatus: '"okay"',
      effects: [
        {
          id: "eff-gpio-int",
          propertyName: "gpio_int",
          effectKind: "set" as const,
          nodeOccurrenceId: "src-sc8562",
          propertyOccurrenceId: "src-prop-gpio-int",
          sourceOrder: 1
        }
      ]
    },
    {
      id: "eff-mt5788",
      logicalNodeId: "logical-mt5788",
      locator: "/amba/i2c@FDF5E000/mt5788@55",
      name: "mt5788",
      unitAddress: "55",
      compatible: "mediatek,mt5788",
      parentLogicalNodeId: "logical-i2c",
      rawStatus: '"okay"',
      effects: [
        {
          id: "eff-mt-gpio-int",
          propertyName: "gpio_int",
          effectKind: "set" as const,
          nodeOccurrenceId: null,
          propertyOccurrenceId: null,
          sourceOrder: 1
        }
      ]
    }
  ]);

  return {
    view: "effective",
    revisionId: DEFAULT_REVISION_ID,
    configSetId: DEFAULT_CONFIG_SET_ID,
    projectId: DEFAULT_PROJECT_ID,
    status: "resolved",
    incompleteBase: false,
    diagnostics: [],
    nodes
  };
}

function seedStore(): Store {
  const bindings = seedBindings();
  return {
    specs: seedSpecs(),
    reviewTasks: [
      {
        id: "review-task-gpio-int",
        status: "open",
        parameterSpecId: null,
        propertyKey: "gpio_int",
        driverModule: "unknown-ic",
        evidence: ["compatible unmatched"],
        candidates: [
          { id: "spec-sc8562-gpio-int", label: "vendor,sc8562 / gpio_int", propertyKey: "gpio_int", driverModule: "sc8562" },
          { id: "spec-mt5788-gpio-int", label: "mediatek,mt5788 / gpio_int", propertyKey: "gpio_int", driverModule: "mt5788" }
        ],
        ambiguous: true,
        projectCount: 2,
        createdAt: MOCK_NOW
      }
    ],
    bindingsByRevision: new Map([[`${DEFAULT_PROJECT_ID}:${DEFAULT_REVISION_ID}`, bindings]]),
    bindingHistory: new Map([
      [
        "binding-sc8562-gpio-int",
        [
          {
            id: "hist-1",
            changedAt: "2026-07-13T08:00:00.000Z",
            fromRawValue: "<&gpio13 28 0>",
            toRawValue: "<&gpio13 29 0>"
          }
        ]
      ]
    ]),
    bindingCompare: new Map([
      [
        "binding-sc8562-gpio-int",
        [
          {
            projectId: "project-peer",
            projectName: "Peer Board",
            rawValue: "<&gpio13 30 0>",
            moduleName: "Charge Pump",
            driverModule: "sc8562"
          }
        ]
      ]
    ]),
    sourceTopology: seedSourceTopology(),
    effectiveTopology: seedEffectiveTopology(),
    mappingTasks: [
      {
        id: "mapping-task-1",
        projectId: DEFAULT_PROJECT_ID,
        configRevisionId: DEFAULT_REVISION_ID,
        previousLogicalNodeId: "logical-sc8562-old",
        candidateLogicalNodeIds: ["logical-sc8562", "logical-mt5788"],
        evidence: {
          previousNodeLocator: "/amba/i2c@FDF5E000/sc8562@6E",
          evidence: ["unit address matched", "compatible ambiguous"],
          candidates: [
            { logicalNodeId: "logical-sc8562", nodeLocator: "/amba/i2c@FDF5E000/sc8562@6E", name: "sc8562", unitAddress: "6E" },
            { logicalNodeId: "logical-mt5788", nodeLocator: "/amba/i2c@FDF5E000/mt5788@55", name: "mt5788", unitAddress: "55" }
          ],
          risk: "high"
        },
        status: "open",
        createdAt: MOCK_NOW
      }
    ],
    validationRuns: new Map([
      [
        `${DEFAULT_PROJECT_ID}:${DEFAULT_REVISION_ID}`,
        {
          id: "validation-run-teaching-1",
          status: "passed",
          stage: "toolchain",
          artifactHashes: { dtc: "hash-dtc-teaching" },
          diagnostics: []
        }
      ]
    ])
  };
}

function toSummary(detail: SpecFixture): ParameterSpecSummary {
  return {
    id: detail.id,
    organizationId: detail.organizationId,
    sourceKind: detail.sourceKind,
    specificationKey: detail.specificationKey,
    propertyKey: detail.propertyKey,
    driverModule: detail.driverModule,
    lifecycle: detail.lifecycle,
    currentVersionId: detail.currentVersionId,
    currentVersion: detail.currentVersion,
    valueShape:
      detail.valueShape && typeof detail.valueShape === "object" && !Array.isArray(detail.valueShape)
        ? { ...(detail.valueShape as Record<string, unknown>) }
        : detail.valueShape,
    compatiblePatterns: detail.compatiblePatterns ? [...detail.compatiblePatterns] : null
  };
}

function cloneDetail(detail: SpecFixture): ParameterSpecDetail {
  return {
    ...detail,
    compatiblePatterns: detail.compatiblePatterns ? [...detail.compatiblePatterns] : null,
    constraints: detail.constraints ? { ...detail.constraints } : null,
    valueShape:
      detail.valueShape && typeof detail.valueShape === "object" && !Array.isArray(detail.valueShape)
        ? { ...(detail.valueShape as Record<string, unknown>) }
        : detail.valueShape
  };
}

/**
 * In-memory ParameterTopologyRepository for mock runtime demos and component tests.
 * Fixtures express the semantic model (specs, bindings, topology, review/mapping tasks, validation).
 * Identity is parameterSpecId / projectParameterBindingId — never path-derived flat keys.
 */
export function createMockParameterTopologyRepository(): ParameterTopologyRepository {
  const store = seedStore();
  let draftCounter = 0;

  return {
    async listSpecs(query) {
      let items = Array.from(store.specs.values()).map(toSummary);
      if (query.q) {
        const needle = query.q.toLocaleLowerCase();
        items = items.filter(
          (item) =>
            item.propertyKey?.toLocaleLowerCase().includes(needle) ||
            item.driverModule?.toLocaleLowerCase().includes(needle) ||
            item.specificationKey.toLocaleLowerCase().includes(needle) ||
            item.id.toLocaleLowerCase().includes(needle)
        );
      }
      if (query.sourceKind) {
        items = items.filter((item) => item.sourceKind === query.sourceKind);
      }
      if (query.lifecycle) {
        items = items.filter((item) => item.lifecycle === query.lifecycle);
      }
      if (query.driverModule) {
        items = items.filter((item) => item.driverModule === query.driverModule);
      }
      if (query.propertyKey) {
        items = items.filter((item) => item.propertyKey === query.propertyKey);
      }
      return items;
    },

    async getSpec(specId) {
      const detail = store.specs.get(specId);
      if (!detail) {
        throw new Error(`ParameterSpec not found: ${specId}`);
      }
      return cloneDetail(detail);
    },

    async activateParameterSpec(specId, input: ActivateParameterSpecInput) {
      const existing = store.specs.get(specId);
      if (!existing) {
        throw new Error(`ParameterSpec not found: ${specId}`);
      }
      const nextVersion = (existing.currentVersion ?? 0) + 1;
      const updated: SpecFixture = {
        ...existing,
        lifecycle: "active",
        currentVersion: nextVersion,
        currentVersionId: `specver-${specId}-${nextVersion}`,
        valueShape: input.valueShape,
        constraints: input.constraints,
        documentation: input.documentation,
        displayName: input.displayName ?? existing.displayName,
        description: input.description ?? existing.description
      };
      store.specs.set(specId, updated);
      return cloneDetail(updated);
    },

    async updateParameterSpec(specId, input) {
      const existing = store.specs.get(specId);
      if (!existing) {
        throw new Error(`ParameterSpec not found: ${specId}`);
      }
      if (existing.lifecycle === "draft") {
        throw new Error(`Draft specs must be activated, not updated: ${specId}`);
      }
      const updated: SpecFixture = {
        ...existing,
        valueShape: input.valueShape ?? existing.valueShape,
        constraints: input.constraints,
        documentation: input.documentation,
        displayName: input.displayName ?? existing.displayName,
        description: input.description ?? existing.description,
        units: input.units === undefined ? existing.units : input.units,
        exampleValue: input.exampleValue === undefined ? existing.exampleValue : input.exampleValue,
        policyTarget: input.policyTarget === undefined ? existing.policyTarget : input.policyTarget
      };
      store.specs.set(specId, updated);
      return cloneDetail(updated);
    },

    async listSpecReviewTasks(query = {}) {
      let items = store.reviewTasks.map((task) => ({
        ...task,
        evidence: [...task.evidence],
        candidates: task.candidates.map((candidate) => ({ ...candidate }))
      }));
      if (query.status) {
        items = items.filter((task) => task.status === query.status);
      }
      const limit = query.limit ?? items.length;
      return { items: items.slice(0, limit), nextCursor: null };
    },

    async resolveSpecReviewTask(taskId, input) {
      const task = store.reviewTasks.find((item) => item.id === taskId);
      if (!task) {
        throw new Error(`Spec review task not found: ${taskId}`);
      }
      task.status = input.decision;
      task.reason = input.reason;
      task.resolvedAt = MOCK_NOW;
      if (input.parameterSpecId) {
        task.parameterSpecId = input.parameterSpecId;
      }
      if (input.createSpec && task.propertyKey) {
        const newId = `spec-manual-${task.propertyKey}`;
        store.specs.set(newId, {
          id: newId,
          organizationId: DEFAULT_ORG_ID,
          sourceKind: "manual",
          specificationKey: `manual/${task.propertyKey}`,
          propertyKey: task.propertyKey,
          driverModule: task.driverModule,
          lifecycle: "draft",
          currentVersionId: `specver-${newId}-1`,
          currentVersion: 1,
          displayName: task.propertyKey,
          description: input.reason,
          valueShape: { kind: "strings" },
          schemaDefault: null,
          exampleValue: null,
          schemaNamespace: "manual",
          units: null,
          constraints: null,
          documentation: input.reason,
          compatiblePatterns: null,
          policyTarget: null
        });
        task.parameterSpecId = newId;
      }
    },

    async listBindings(projectId, revisionId) {
      const key = `${projectId}:${revisionId}`;
      const seeded = store.bindingsByRevision.get(key);
      if (seeded) {
        return seeded.map((binding) => ({ ...binding }));
      }
      // Any project/revision pair receives the teaching bindings for demo/tests.
      const fallback = store.bindingsByRevision.get(`${DEFAULT_PROJECT_ID}:${DEFAULT_REVISION_ID}`) ?? [];
      return fallback.map((binding) => ({ ...binding }));
    },

    async listBindingHistory(_projectId, bindingId) {
      return (store.bindingHistory.get(bindingId) ?? []).map((entry) => ({ ...entry }));
    },

    async listBindingCompare(_projectId, bindingId) {
      return (store.bindingCompare.get(bindingId) ?? []).map((entry) => ({ ...entry }));
    },

    async getTopology(projectId, configSetId, revisionId, view) {
      const base = view === "source" ? store.sourceTopology : store.effectiveTopology;
      if (base.view === "source") {
        return {
          ...base,
          projectId,
          configSetId,
          revisionId,
          nodes: base.nodes.map((node) => ({
            ...node,
            labels: [...node.labels],
            properties: node.properties.map((property) => ({ ...property }))
          }))
        };
      }
      return {
        ...base,
        projectId,
        configSetId,
        revisionId,
        nodes: base.nodes.map((node) => ({
          ...node,
          effects: node.effects.map((effect) => ({ ...effect }))
        }))
      };
    },

    async listMappingTasks(projectId) {
      return store.mappingTasks
        .filter((task) => !projectId || task.projectId === projectId)
        .map((task) => ({
          ...task,
          candidateLogicalNodeIds: [...task.candidateLogicalNodeIds]
        }));
    },

    async resolveMapping(taskId, input) {
      const task = store.mappingTasks.find((item) => item.id === taskId);
      if (!task) {
        throw new Error(`Identity mapping task not found: ${taskId}`);
      }
      task.status = input.decision;
      task.reason = input.reason;
      task.resolvedAt = MOCK_NOW;
    },

    async validateRevision(projectId, revisionId) {
      const key = `${projectId}:${revisionId}`;
      const existing = store.validationRuns.get(key);
      if (existing) {
        return {
          ...existing,
          artifactHashes: existing.artifactHashes ? { ...existing.artifactHashes } : undefined,
          diagnostics: existing.diagnostics ? existing.diagnostics.map((item) => ({ ...item })) : undefined
        };
      }
      const run: ValidationRun = {
        id: `validation-run-${projectId}-${revisionId}`,
        status: "passed",
        stage: "toolchain",
        artifactHashes: { dtc: "hash-dtc-mock" },
        diagnostics: []
      };
      store.validationRuns.set(key, run);
      return { ...run, diagnostics: [] };
    },

    async createBindingDraft(projectId, bindingId, input: CreateBindingDraftInput): Promise<BindingDraftResult> {
      const bindings = await this.listBindings(projectId, input.baseRevisionId);
      const binding = bindings.find((item) => item.id === bindingId);
      if (!binding) {
        throw new Error(`Binding not found: ${bindingId}`);
      }
      draftCounter += 1;
      const action = input.action ?? "set";
      const rawText =
        action === "delete"
          ? ""
          : input.targetValue
            ? JSON.stringify(input.targetValue)
            : binding.rawValue;
      return {
        draftId: `draft-mock-${draftCounter}`,
        parameterId: binding.id,
        candidateRevisionId: `rev-draft-${draftCounter}`,
        workingCandidateRevisionId: `rev-draft-${draftCounter}`,
        rawText,
        action,
        parameterSpecId: binding.parameterSpecId,
        projectParameterBindingId: binding.id,
        writeTarget: {
          role: "overlay",
          propertyKey: binding.propertyKey,
          targetRef: binding.locator
        },
        overlayFileId: "file-teaching-dts",
        overlayFileName: "power.dtso"
      };
    },

    async createNodeEnablementDraft(
      projectId,
      input: CreateNodeEnablementDraftInput
    ): Promise<NodeEnablementDraftResult> {
      void projectId;
      draftCounter += 1;
      const action = input.target === "unstated" ? "delete" : "set";
      const rawText =
        input.target === "unstated"
          ? ""
          : input.target === "force-disabled"
            ? '"disabled"'
            : `"${input.spellingOverride ?? "ok"}"`;
      return {
        draftId: `draft-enablement-mock-${draftCounter}`,
        candidateRevisionId: `rev-draft-${draftCounter}`,
        workingCandidateRevisionId: `rev-draft-${draftCounter}`,
        rawText,
        action,
        logicalNodeId: input.logicalNodeId,
        target: input.target,
        previousRaw: null,
        writeTarget: {
          role: "overlay",
          propertyKey: "status",
          targetRef: "mock-node"
        },
        overlayFileId: "file-teaching-dts",
        overlayFileName: "power.dtso"
      };
    }
  };
}
