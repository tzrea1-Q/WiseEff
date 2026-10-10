import type {
  BindingDraftResult,
  CreateBindingDraftInput,
  CreateNodeEnablementDraftInput,
  NodeEnablementDraftResult,
  ParameterTopologyRepository
} from "@/application/ports/ParameterTopologyRepository";
import type {
  BindingCompareEntry,
  BindingHistoryEntry,
  ConfigRevisionSummary,
  ProjectParameterBinding,
  TopologyTree,
  ValidationRun
} from "@/domain/parameter-topology/types";
import { driverFallbackModuleId } from "@/domain/parameter-topology/moduleRegistry";
import {
  withEffectiveEnablement,
  withSourceEnablement
} from "@/domain/parameter-topology/nodeEnablement";
import { mockApiError } from "./mockApiError";

const MOCK_NOW = "2026-07-14T10:00:00.000Z";
const DEFAULT_PROJECT_ID = "project-teaching";
const DEFAULT_CONFIG_SET_ID = "config-set-teaching";
const DEFAULT_REVISION_ID = "revision-teaching-1";
const CURRENT_REVISION_ALIASES = new Set(["current", "latest", "head"]);

type Store = {
  bindingsByRevision: Map<string, ProjectParameterBinding[]>;
  bindingHistory: Map<string, BindingHistoryEntry[]>;
  bindingCompare: Map<string, BindingCompareEntry[]>;
  sourceTopology: TopologyTree;
  effectiveTopology: TopologyTree;
  validationRuns: Map<string, ValidationRun>;
  configRevisions: Map<string, ConfigRevisionSummary[]>;
};

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
    ]),
    configRevisions: new Map([
      [
        `${DEFAULT_PROJECT_ID}:${DEFAULT_CONFIG_SET_ID}`,
        [
          {
            id: DEFAULT_REVISION_ID,
            configSetId: DEFAULT_CONFIG_SET_ID,
            revisionNumber: 1,
            status: "validated",
            createdAt: MOCK_NOW
          }
        ]
      ]
    ])
  };
}

function revisionStoreKey(projectId: string, configSetId: string): string {
  return `${projectId}:${configSetId}`;
}

function cloneRevision(item: ConfigRevisionSummary): ConfigRevisionSummary {
  return { ...item };
}

function latestListedRevision(items: ConfigRevisionSummary[]): ConfigRevisionSummary | null {
  if (items.length === 0) return null;
  return [...items].sort((left, right) => right.revisionNumber - left.revisionNumber)[0] ?? null;
}

function ensureListedRevisions(
  store: Store,
  projectId: string,
  configSetId: string
): ConfigRevisionSummary[] {
  const key = revisionStoreKey(projectId, configSetId);
  const existing = store.configRevisions.get(key);
  if (existing && existing.length > 0) {
    return existing;
  }
  const seeded: ConfigRevisionSummary[] =
    projectId === DEFAULT_PROJECT_ID && configSetId === DEFAULT_CONFIG_SET_ID
      ? [
          {
            id: DEFAULT_REVISION_ID,
            configSetId,
            revisionNumber: 1,
            status: "validated",
            createdAt: MOCK_NOW
          }
        ]
      : [
          {
            id: `rev-${configSetId}-head`,
            configSetId,
            revisionNumber: 1,
            status: "resolved",
            createdAt: MOCK_NOW
          }
        ];
  store.configRevisions.set(key, seeded);
  return seeded;
}

function findListedRevision(
  store: Store,
  projectId: string,
  revisionId: string
): ConfigRevisionSummary | undefined {
  for (const [key, items] of store.configRevisions) {
    if (!key.startsWith(`${projectId}:`)) continue;
    const found = items.find((item) => item.id === revisionId);
    if (found) return found;
  }
  if (projectId === DEFAULT_PROJECT_ID && revisionId === DEFAULT_REVISION_ID) {
    return ensureListedRevisions(store, DEFAULT_PROJECT_ID, DEFAULT_CONFIG_SET_ID).find(
      (item) => item.id === DEFAULT_REVISION_ID
    );
  }
  return undefined;
}

function resolveListedRevisionId(
  store: Store,
  projectId: string,
  configSetId: string,
  revisionId: string
): string {
  const listed = ensureListedRevisions(store, projectId, configSetId);
  const resolvedId = CURRENT_REVISION_ALIASES.has(revisionId)
    ? latestListedRevision(listed)?.id
    : revisionId;
  if (!resolvedId || !listed.some((item) => item.id === resolvedId)) {
    throw mockApiError("NOT_FOUND", "Config revision was not found.", {
      projectId,
      configSetId,
      revisionId
    });
  }
  return resolvedId;
}

/**
 * In-memory ParameterTopologyRepository for mock runtime demos and component tests.
 * Fixtures retain bindings, structural topology, node enablement, revisions and validation.
 * Identity is parameterSpecId / projectParameterBindingId — never path-derived flat keys.
 */
export function createMockParameterTopologyRepository(): ParameterTopologyRepository {
  const store = seedStore();
  let draftCounter = 0;

  return {
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

    async listConfigRevisions(projectId, configSetId) {
      return ensureListedRevisions(store, projectId, configSetId).map(cloneRevision);
    },

    async getTopology(projectId, configSetId, revisionId, view) {
      const resolvedRevisionId = resolveListedRevisionId(store, projectId, configSetId, revisionId);
      const base = view === "source" ? store.sourceTopology : store.effectiveTopology;
      if (base.view === "source") {
        return {
          ...base,
          projectId,
          configSetId,
          revisionId: resolvedRevisionId,
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
        revisionId: resolvedRevisionId,
        nodes: base.nodes.map((node) => ({
          ...node,
          effects: node.effects.map((effect) => ({ ...effect }))
        }))
      };
    },

    async listMappingTasks() {
      return [];
    },

    async validateRevision(projectId, revisionId) {
      const listed = findListedRevision(store, projectId, revisionId);
      if (!listed) {
        throw mockApiError("NOT_FOUND", "Config revision was not found.", { projectId, revisionId });
      }
      const key = `${projectId}:${revisionId}`;
      const existing = store.validationRuns.get(key);
      if (existing) {
        return {
          ...existing,
          artifactHashes: existing.artifactHashes ? { ...existing.artifactHashes } : undefined,
          diagnostics: existing.diagnostics ? existing.diagnostics.map((item) => ({ ...item })) : undefined
        };
      }
      const requiresConfirmation = listed.status !== "validated" && listed.status !== "compiled";
      const run: ValidationRun = {
        id: `validation-run-${projectId}-${revisionId}`,
        status: "passed",
        stage: "toolchain",
        artifactHashes: { dtc: "hash-dtc-mock" },
        diagnostics: [],
        ...(requiresConfirmation ? { requiresConfirmation: true } : {})
      };
      store.validationRuns.set(key, run);
      return {
        ...run,
        diagnostics: [],
        artifactHashes: run.artifactHashes ? { ...run.artifactHashes } : undefined
      };
    },

    async createBindingDraft(projectId, bindingId, input: CreateBindingDraftInput): Promise<BindingDraftResult> {
      const bindings = await this.listBindings(projectId, input.baseRevisionId);
      const binding = bindings.find((item) => item.id === bindingId);
      if (!binding) {
        throw mockApiError("NOT_FOUND", `Binding not found: ${bindingId}`, { bindingId });
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

    async listNodeEnablementDrafts() {
      return [];
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
