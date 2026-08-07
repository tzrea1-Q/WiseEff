import type {
  AddConfigSetFileInput,
  CompareBaselineOptions,
  CreateBaselineInput,
  CreateConfigSetInput,
  DtsConfigSet,
  DtsConfigSetFile,
  DtsExportConfigSetResult,
  DtsReleaseBaseline,
  DtsReleaseReadiness,
  DtsSearchBy,
  DtsSearchHit,
  DtsSourceLocator,
  DtsStructuralNode,
  DtsStructuredRepository,
  DtsSubmitStructuredEditsInput,
  ReleaseBaselineInput
} from "@/application/ports/DtsStructuredRepository";

const MOCK_NOW = "2026-07-14T10:00:00.000Z";
const DEFAULT_PROJECT_ID = "project-teaching";
const DEFAULT_FILE_ID = "file-teaching-dts";
const DEFAULT_FILE_NAME = "atlas-board.dts";
const DEFAULT_VERSION_ID = "version-teaching-1";
const DEFAULT_ORG_ID = "org-teaching";


function loc(
  startOffset: number,
  endOffset: number,
  startLine: number,
  startColumn: number,
  endLine: number,
  endColumn: number
): DtsSourceLocator {
  return { startOffset, endOffset, startLine, startColumn, endLine, endColumn };
}

function assignTeachingSpans(nodes: DtsStructuralNode[]): DtsStructuralNode[] {
  let cursor = 1;
  return nodes.map((node, nodeIndex) => {
    const nodeStart = cursor;
    cursor += 40 + nodeIndex;
    const nodeEnd = cursor;
    const source = loc(nodeStart, nodeEnd, nodeIndex + 1, 1, nodeIndex + 1, 20);
    const properties = node.properties.map((property, propIndex) => {
      const start = nodeEnd + propIndex * 8 + 1;
      const end = start + 6;
      return {
        ...property,
        source: loc(start, end, nodeIndex + 1, 3 + propIndex, nodeIndex + 1, 9 + propIndex)
      };
    });
    return { ...node, source, properties };
  });
}

/** Teaching-fixture-derived structured nodes (frontend-owned; does not import server fixtures). */
export function createTeachingStructureNodes(): DtsStructuralNode[] {
  return assignTeachingSpans([
    {
      nodePath: "amba",
      name: "amba",
      labels: ["amba"],
      compatible: "arm,amba-bus",
      properties: [
        { name: "compatible", valueType: "string-list", rawText: '"arm,amba-bus"', normalizedValue: "arm,amba-bus" },
        { name: "#address-cells", valueType: "u32-array", rawText: "<2>", normalizedValue: "2" }
      ],
      phandleRefs: []
    },
    {
      nodePath: "amba/i2c@XXXX0000",
      name: "i2c",
      unitAddress: "XXXX0000",
      labels: [],
      status: "ok",
      properties: [{ name: "status", valueType: "string-list", rawText: '"ok"', normalizedValue: "ok" }],
      phandleRefs: []
    },
    {
      nodePath: "amba/i2c@XXXX0000/chip@6E",
      name: "chip",
      unitAddress: "6E",
      labels: [],
      compatible: "vendor,chip123",
      properties: [
        { name: "compatible", valueType: "string-list", rawText: '"vendor,chip123"', normalizedValue: "vendor,chip123" },
        { name: "reg", valueType: "u32-array", rawText: "<0x6e>", normalizedValue: "110" }
      ],
      phandleRefs: [{ fromProperty: "vdd-supply", targetLabel: "demo_regulator", resolvedTargetPath: "demo_regulator" }]
    },
    {
      nodePath: "demo_multi_instance",
      name: "demo_multi_instance",
      labels: ["demo_multi_instance"],
      status: "ok",
      properties: [{ name: "status", valueType: "string-list", rawText: '"ok"', normalizedValue: "ok" }],
      phandleRefs: []
    },
    {
      nodePath: "demo_multi_instance/battery_checker@0",
      name: "battery_checker",
      unitAddress: "0",
      labels: [],
      status: "ok",
      properties: [
        { name: "spare-cycles", valueType: "u32-array", rawText: "<150>", normalizedValue: "150" },
        { name: "status", valueType: "string-list", rawText: '"ok"', normalizedValue: "ok" }
      ],
      phandleRefs: [
        { fromProperty: "matchable", targetLabel: "demo_ic_a", resolvedTargetPath: "demo_ic_a" },
        { fromProperty: "matchable", targetLabel: "demo_ic_b" }
      ]
    },
    {
      nodePath: "demo_bool",
      name: "demo_bool",
      labels: ["demo_bool"],
      properties: [
        { name: "weak_source_sleep_enabled", valueType: "bool", rawText: "", normalizedValue: "true" },
        { name: "charge_done_sleep_enabled", valueType: "bool", rawText: "", normalizedValue: "true" }
      ],
      phandleRefs: []
    },
    {
      nodePath: "demo_phandle_list",
      name: "demo_phandle_list",
      labels: ["demo_phandle_list"],
      properties: [
        {
          name: "matchable",
          valueType: "phandle-list",
          rawText: "<&demo_ic_a &demo_ic_b>",
          normalizedValue: "demo_ic_a demo_ic_b"
        }
      ],
      phandleRefs: [
        { fromProperty: "matchable", targetLabel: "demo_ic_a", resolvedTargetPath: "demo_ic_a" },
        { fromProperty: "matchable", targetLabel: "demo_ic_b" }
      ]
    },
    {
      nodePath: "demo_ic_a",
      name: "demo_ic_a",
      labels: ["demo_ic_a"],
      status: "ok",
      properties: [{ name: "status", valueType: "string-list", rawText: '"ok"', normalizedValue: "ok" }],
      phandleRefs: []
    },
    {
      nodePath: "demo_regulator",
      name: "demo_regulator",
      labels: ["demo_regulator"],
      properties: [
        {
          name: "regulator-min-microvolt",
          valueType: "u32-array",
          rawText: "<1000000>",
          normalizedValue: "1000000"
        }
      ],
      phandleRefs: []
    }
  ]);
}

function cloneNodes(nodes: DtsStructuralNode[]): DtsStructuralNode[] {
  return nodes.map((node) => ({
    ...node,
    labels: [...node.labels],
    properties: node.properties.map((property) => ({
      ...property,
      ...(property.source ? { source: { ...property.source } } : {})
    })),
    phandleRefs: node.phandleRefs.map((ref) => ({ ...ref })),
    ...(node.source ? { source: { ...node.source } } : {})
  }));
}

function includesIgnoreCase(haystack: string, needle: string) {
  return haystack.toLocaleLowerCase().includes(needle.toLocaleLowerCase());
}

function searchNodes(
  nodes: DtsStructuralNode[],
  q: string,
  by: DtsSearchBy | undefined,
  meta: { fileId: string; fileName: string; versionId: string }
): DtsSearchHit[] {
  if (!q.trim()) {
    return [];
  }

  const dimensions: DtsSearchBy[] = by
    ? [by]
    : ["file", "path", "address", "label", "compatible", "value"];
  const hits: DtsSearchHit[] = [];
  const seen = new Set<string>();
  const base = { fileId: meta.fileId, fileName: meta.fileName, versionId: meta.versionId };

  const push = (hit: DtsSearchHit) => {
    const key = `${hit.nodePath}\0${hit.propertyName ?? ""}\0${hit.snippet ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    hits.push(hit);
  };

  for (const dimension of dimensions) {
    if (dimension === "file") {
      if (includesIgnoreCase(meta.fileName, q)) {
        const root = nodes.find((node) => !node.nodePath.includes("/")) ?? nodes[0];
        if (root) {
          push({
            ...base,
            nodePath: root.nodePath,
            snippet: meta.fileName,
            ...(root.source ? { source: root.source } : {})
          });
        }
      }
      continue;
    }

    for (const node of nodes) {
      if (dimension === "path" && includesIgnoreCase(node.nodePath, q)) {
        push({
          ...base,
          nodePath: node.nodePath,
          snippet: node.nodePath,
          ...(node.source ? { source: node.source } : {})
        });
        continue;
      }

      if (
        dimension === "address" &&
        ((node.unitAddress && includesIgnoreCase(node.unitAddress, q)) ||
          includesIgnoreCase(node.nodePath, `@${q}`) ||
          (node.nodePath.includes("@") && includesIgnoreCase(node.nodePath.split("@").pop() ?? "", q)))
      ) {
        push({
          ...base,
          nodePath: node.nodePath,
          snippet: node.unitAddress ? `@${node.unitAddress}` : node.nodePath,
          ...(node.source ? { source: node.source } : {})
        });
        continue;
      }

      if (dimension === "label" && node.labels.some((label) => includesIgnoreCase(label, q))) {
        push({
          ...base,
          nodePath: node.nodePath,
          snippet: node.labels.join(", "),
          ...(node.source ? { source: node.source } : {})
        });
        continue;
      }

      if (dimension === "compatible" && node.compatible && includesIgnoreCase(node.compatible, q)) {
        push({
          ...base,
          nodePath: node.nodePath,
          snippet: node.compatible,
          ...(node.source ? { source: node.source } : {})
        });
        continue;
      }

      if (dimension === "value") {
        for (const property of node.properties) {
          if (includesIgnoreCase(property.normalizedValue, q) || includesIgnoreCase(property.name, q)) {
            push({
              ...base,
              nodePath: node.nodePath,
              propertyName: property.name,
              snippet: `${property.name}=${property.normalizedValue}`,
              ...(property.source ? { source: property.source } : {})
            });
            break;
          }
        }
      }
    }
  }

  return hits;
}

type StoredMembership = DtsConfigSetFile;

type MockDtsStructuredState = {
  nodes: DtsStructuralNode[];
  configSets: DtsConfigSet[];
  memberships: StoredMembership[];
  baselines: DtsReleaseBaseline[];
  counter: number;
};

function createInitialState(nodes: DtsStructuralNode[]): MockDtsStructuredState {
  return {
    nodes: cloneNodes(nodes),
    configSets: [],
    memberships: [],
    baselines: [],
    counter: 0
  };
}

export function createMockDtsStructuredRepository(
  options: {
    nodes?: DtsStructuralNode[];
    fileId?: string;
    versionId?: string;
  } = {}
): DtsStructuredRepository {
  const fileId = options.fileId ?? DEFAULT_FILE_ID;
  const versionId = options.versionId ?? DEFAULT_VERSION_ID;
  const state = createInitialState(options.nodes ?? createTeachingStructureNodes());

  function nextId(prefix: string) {
    state.counter += 1;
    return `${prefix}-${state.counter}`;
  }

  function fileIdentityForProject(projectId: string) {
    if (projectId === DEFAULT_PROJECT_ID) {
      return { fileId, versionId };
    }
    return { fileId: `${fileId}-${projectId}`, versionId: `${versionId}-${projectId}` };
  }

  function ensureDefaultConfigSet(projectId: string) {
    const existing = state.configSets.find(
      (item) => item.projectId === projectId && item.name === "default"
    );
    if (existing) {
      return existing;
    }
    const created: DtsConfigSet = {
      id: `mock-cs-default-${projectId}`,
      organizationId: DEFAULT_ORG_ID,
      projectId,
      name: "default",
      description: "Default working configuration.",
      createdAt: MOCK_NOW,
      updatedAt: MOCK_NOW
    };
    const identity = fileIdentityForProject(projectId);
    state.configSets.push(created);
    state.memberships.push({
      configSetId: created.id,
      fileId: identity.fileId,
      role: "base",
      sortOrder: 0
    });
    return created;
  }

  function requireConfigSet(configSetId: string) {
    const configSet = state.configSets.find((item) => item.id === configSetId);
    if (!configSet) {
      throw new Error(`Config set not found: ${configSetId}`);
    }
    return configSet;
  }

  function requireBaseline(baselineId: string) {
    const baseline = state.baselines.find((item) => item.id === baselineId);
    if (!baseline) {
      throw new Error(`Baseline not found: ${baselineId}`);
    }
    return baseline;
  }

  return {
    /**
     * The mock owns a single fixture dataset and serves it for any project, so browse and
     * search always describe the same tree. Scoping one of them by project id (as `search`
     * used to) made the two views of the same data contradict each other.
     */
    async getStructure(_requestedProjectId, _requestedFileId, _requestedVersionId) {
      return { nodes: cloneNodes(state.nodes) };
    },

    async search(_requestedProjectId, query) {
      return {
        hits: searchNodes(state.nodes, query.q, query.by, {
          fileId,
          fileName: DEFAULT_FILE_NAME,
          versionId
        })
      };
    },

    async listConfigSets(requestedProjectId) {
      ensureDefaultConfigSet(requestedProjectId);
      return state.configSets.filter((item) => item.projectId === requestedProjectId).map((item) => ({ ...item }));
    },

    async listConfigSetFiles(requestedProjectId, configSetId) {
      const configSet = requireConfigSet(configSetId);
      if (configSet.projectId !== requestedProjectId) {
        throw new Error(`Config set not found: ${configSetId}`);
      }
      const identity = fileIdentityForProject(requestedProjectId);
      return state.memberships
        .filter((item) => item.configSetId === configSetId)
        .sort((left, right) => left.sortOrder - right.sortOrder)
        .map((item) => ({
          ...item,
          fileName: item.fileId === identity.fileId ? DEFAULT_FILE_NAME : item.fileId,
          format: item.fileId.endsWith(".json") ? ("json" as const) : ("dts" as const),
          ...(item.fileId === identity.fileId
            ? { currentVersionId: identity.versionId, currentVersionNumber: 1 }
            : {})
        }));
    },

    async createConfigSet(requestedProjectId, input: CreateConfigSetInput) {
      const created: DtsConfigSet = {
        id: nextId("mock-cs"),
        organizationId: DEFAULT_ORG_ID,
        projectId: requestedProjectId,
        name: input.name,
        description: input.description,
        derivedFromId: input.derivedFromId,
        createdAt: MOCK_NOW,
        updatedAt: MOCK_NOW
      };
      state.configSets = [created, ...state.configSets];
      return { ...created };
    },

    async addConfigSetFile(_requestedProjectId, configSetId, input: AddConfigSetFileInput) {
      requireConfigSet(configSetId);
      const membership: StoredMembership = {
        configSetId,
        fileId: input.fileId,
        role: input.role,
        sortOrder: input.sortOrder ?? 0
      };
      state.memberships = [
        ...state.memberships.filter((item) => !(item.configSetId === configSetId && item.fileId === input.fileId)),
        membership
      ];
      return { ...membership };
    },

    async removeConfigSetFile(_requestedProjectId, configSetId, requestedFileId) {
      requireConfigSet(configSetId);
      state.memberships = state.memberships.filter(
        (item) => !(item.configSetId === configSetId && item.fileId === requestedFileId)
      );
    },

    async listBaselines(_requestedProjectId, configSetId) {
      requireConfigSet(configSetId);
      return state.baselines.filter((item) => item.configSetId === configSetId).map((item) => ({ ...item }));
    },

    async getBaseline(_requestedProjectId, baselineId) {
      const baseline = requireBaseline(baselineId);
      const members = state.memberships
        .filter((item) => item.configSetId === baseline.configSetId)
        .map((item, index) => ({
          baselineId: baseline.id,
          fileId: item.fileId,
          fileVersionId: versionId,
          versionNumber: index + 1
        }));
      return { item: { ...baseline }, members };
    },

    async getReleaseReadiness(_requestedProjectId, configSetId, options) {
      requireConfigSet(configSetId);
      const members = state.memberships.filter((item) => item.configSetId === configSetId);
      const blockers = members.length === 0
        ? [
            {
              id: `missing-primary-version:${configSetId}`,
              severity: "blocker" as const,
              code: "missing-primary-version",
              message: "Config set has no primary (base) member version to snapshot.",
              remediation: {
                kind: "assign-member-version" as const,
                label: "Assign a base member with an active version"
              }
            }
          ]
        : [];
      const warnings = (options?.acknowledgedWarningIds ?? []).includes("mock-toolchain-warning")
        ? [
            {
              id: "mock-toolchain-warning",
              severity: "warning" as const,
              code: "toolchain-warning",
              message: "Mock toolchain warning acknowledged.",
              remediation: { kind: "acknowledge-warning" as const, label: "Review and acknowledge this warning" },
              acknowledgementRequired: true,
              acknowledged: true
            }
          ]
        : [];
      const level = blockers.length > 0 ? "blocked" : warnings.length > 0 ? "ready" : "ready";
      const readiness: DtsReleaseReadiness = {
        available: true,
        level,
        blockers,
        warnings,
        gateToken: `mock-gate:${configSetId}:${blockers.length}:${warnings.map((item) => item.id).join(",")}`,
        evaluatedAt: MOCK_NOW,
        configSetId,
        projectId: DEFAULT_PROJECT_ID,
        canCreateBaseline: blockers.length === 0,
        canRelease: blockers.length === 0
      };
      return readiness;
    },

    async createBaseline(_requestedProjectId, configSetId, input: CreateBaselineInput) {
      requireConfigSet(configSetId);
      if (!input.gateToken) {
        throw new Error("Release readiness gate token is required.");
      }
      const readiness = await this.getReleaseReadiness(_requestedProjectId, configSetId, {
        acknowledgedWarningIds: input.acknowledgedWarningIds
      });
      if (readiness.gateToken !== input.gateToken) {
        throw new Error("Release readiness gate token is stale.");
      }
      if (!readiness.canCreateBaseline) {
        throw new Error("Baseline creation is blocked by release readiness.");
      }
      const baseline: DtsReleaseBaseline = {
        id: nextId("mock-bl"),
        organizationId: DEFAULT_ORG_ID,
        configSetId,
        name: input.name,
        notes: input.notes,
        status: "draft",
        createdAt: MOCK_NOW
      };
      state.baselines = [baseline, ...state.baselines];
      return { ...baseline };
    },

    async compareBaseline(_requestedProjectId, baselineId, options?: CompareBaselineOptions) {
      const baseline = requireBaseline(baselineId);
      const against = options?.against ?? "working";
      const tip = state.baselines.find(
        (item) => item.configSetId === baseline.configSetId && item.status === "released"
      );
      const members = state.memberships
        .filter((membership) => membership.configSetId === baseline.configSetId)
        .map((membership) => ({
          fileId: membership.fileId,
          fileName: membership.fileId === fileId ? "atlas-board.dts" : membership.fileId,
          status: "version_changed" as const,
          baselineVersionId: versionId,
          currentVersionId: `${versionId}-current`,
          structuralDiff: [
            {
              kind: "prop_changed" as const,
              nodePath: "demo_bool",
              prop: "weak_source_sleep_enabled",
              before: "true",
              after: "false"
            }
          ]
        }));

      return {
        baselineId: baseline.id,
        against,
        againstBaselineId: against === "released" ? tip?.id : undefined,
        members:
          members.length > 0
            ? members
            : [
                {
                  fileId,
                  fileName: "atlas-board.dts",
                  status: "unchanged" as const,
                  baselineVersionId: versionId,
                  currentVersionId: versionId,
                  structuralDiff: [
                    {
                      kind: "node_added" as const,
                      nodePath: "amba/i2c@XXXX0000/chip@6E"
                    }
                  ]
                }
              ]
      };
    },

    async previewRestoreBaseline(_requestedProjectId, baselineId) {
      const baseline = requireBaseline(baselineId);
      const tip = state.baselines.find(
        (item) => item.configSetId === baseline.configSetId && item.status === "released"
      );
      const members = state.memberships
        .filter((item) => item.configSetId === baseline.configSetId)
        .map((item, index) => ({
          fileId: item.fileId,
          fileName: item.fileId === fileId ? DEFAULT_FILE_NAME : item.fileId,
          fromVersionId: `${versionId}-current`,
          fromVersionNumber: index + 2,
          toVersionId: versionId,
          toVersionNumber: index + 1,
          action: "rollback-pointer" as const
        }));
      return {
        baselineId: baseline.id,
        configSetId: baseline.configSetId,
        releasedBaselineId: tip?.id,
        releasedBaselineUnchanged: true as const,
        members,
        driftedCount: members.length
      };
    },

    async rollbackBaseline(_requestedProjectId, baselineId) {
      const baseline = requireBaseline(baselineId);
      const restored = state.memberships.filter((item) => item.configSetId === baseline.configSetId).length || 1;
      return { baselineId: baseline.id, restored };
    },

    async releaseBaseline(_requestedProjectId, baselineId, input: ReleaseBaselineInput) {
      const baseline = requireBaseline(baselineId);
      if (!input.gateToken) {
        throw new Error("Release readiness gate token is required.");
      }
      const readiness = await this.getReleaseReadiness(_requestedProjectId, baseline.configSetId, {
        acknowledgedWarningIds: input.acknowledgedWarningIds
      });
      if (readiness.gateToken !== input.gateToken) {
        throw new Error("Release readiness gate token is stale.");
      }
      if (!readiness.canRelease) {
        throw new Error("Baseline release is blocked by release readiness.");
      }
      const released: DtsReleaseBaseline = { ...baseline, status: "released" };
      state.baselines = state.baselines.map((item) => {
        if (item.id === baselineId) return released;
        if (item.configSetId === baseline.configSetId && item.status === "released") {
          return { ...item, status: "historical" };
        }
        return item;
      });
      return {
        item: { ...released },
        gate: {
          ok: true,
          mode: "block",
          requiresConfirmation: false,
          diagnostics: [],
          compiler: "dtc"
        }
      };
    },

    async exportConfigSet(requestedProjectId, configSetId) {
      const configSet = requireConfigSet(configSetId);
      const members = state.memberships.filter((item) => item.configSetId === configSetId);
      const result: DtsExportConfigSetResult = {
        manifest: {
          configSetId: configSet.id,
          name: configSet.name,
          projectId: requestedProjectId,
          exportedAt: MOCK_NOW,
          validation: {
            ok: true,
            mode: "block",
            compiler: "dtc",
            requiresConfirmation: false
          },
          members: members.map((member) => ({
            fileId: member.fileId,
            fileName: member.fileId === fileId ? "atlas-board.dts" : member.fileId,
            role: member.role,
            sortOrder: member.sortOrder,
            versionNumber: 1,
            format: "dts"
          }))
        },
        files: members.map((member) => ({
          name: member.fileId === fileId ? "atlas-board.dts" : member.fileId,
          format: "dts" as const,
          content: "/* mock export derived from the fixture structure */\n/dts-v1/;\n"
        }))
      };
      return result;
    },

    async submitStructuredEdits(requestedProjectId, input: DtsSubmitStructuredEditsInput) {
      if (input.edits.length === 0) {
        throw new Error("At least one structured edit is required.");
      }
      const roundId = nextId("mock-round");
      return {
        id: roundId,
        projectId: requestedProjectId,
        status: "submitted",
        summary: input.reason?.trim() || "Structured edits submitted.",
        createdAt: MOCK_NOW,
        items: input.edits.map((edit, index) => {
          const sourceNodePath = edit.nodePath.trim()
            ? `${edit.nodePath.trim()}/${edit.propertyName.trim()}`
            : edit.propertyName.trim();
          return {
            requestId: `${roundId}-cr-${index + 1}`,
            parameterId: `mock-ppv-${edit.fileId}-${sourceNodePath.replace(/\//g, "-")}`,
            targetValue: edit.rawText,
            reason: edit.reason?.trim() || `Structured edit: ${sourceNodePath}`,
            name: edit.propertyName,
            module: edit.nodePath
          };
        })
      };
    }
  };
}
