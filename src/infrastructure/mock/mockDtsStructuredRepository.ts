import type {
  AddConfigSetFileInput,
  CreateBaselineInput,
  CreateConfigSetInput,
  DtsConfigSet,
  DtsConfigSetFile,
  DtsExportConfigSetResult,
  DtsReleaseBaseline,
  DtsSearchBy,
  DtsSearchHit,
  DtsStructuralNode,
  DtsStructuredRepository,
  DtsSubmitStructuredEditsInput
} from "@/application/ports/DtsStructuredRepository";

const MOCK_NOW = "2026-07-14T10:00:00.000Z";
const DEFAULT_PROJECT_ID = "project-teaching";
const DEFAULT_FILE_ID = "file-teaching-dts";
const DEFAULT_FILE_NAME = "teaching-sample.dts";
const DEFAULT_VERSION_ID = "version-teaching-1";
const DEFAULT_ORG_ID = "org-teaching";

/** Teaching-fixture-derived structured nodes (frontend-owned; does not import server fixtures). */
export function createTeachingStructureNodes(): DtsStructuralNode[] {
  return [
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
  ];
}

function cloneNodes(nodes: DtsStructuralNode[]): DtsStructuralNode[] {
  return nodes.map((node) => ({
    ...node,
    labels: [...node.labels],
    properties: node.properties.map((property) => ({ ...property })),
    phandleRefs: node.phandleRefs.map((ref) => ({ ...ref }))
  }));
}

function includesIgnoreCase(haystack: string, needle: string) {
  return haystack.toLocaleLowerCase().includes(needle.toLocaleLowerCase());
}

function searchNodes(
  nodes: DtsStructuralNode[],
  q: string,
  by: DtsSearchBy,
  meta: { fileId: string; fileName: string; versionId: string }
): DtsSearchHit[] {
  if (!q.trim()) {
    return [];
  }

  const hits: DtsSearchHit[] = [];
  const base = { fileId: meta.fileId, fileName: meta.fileName, versionId: meta.versionId };

  for (const node of nodes) {
    if (by === "path" && includesIgnoreCase(node.nodePath, q)) {
      hits.push({ ...base, nodePath: node.nodePath, snippet: node.nodePath });
      continue;
    }

    if (
      by === "address" &&
      ((node.unitAddress && includesIgnoreCase(node.unitAddress, q)) ||
        includesIgnoreCase(node.nodePath, `@${q}`) ||
        (node.nodePath.includes("@") && includesIgnoreCase(node.nodePath.split("@").pop() ?? "", q)))
    ) {
      hits.push({
        ...base,
        nodePath: node.nodePath,
        snippet: node.unitAddress ? `@${node.unitAddress}` : node.nodePath
      });
      continue;
    }

    if (by === "label" && node.labels.some((label) => includesIgnoreCase(label, q))) {
      hits.push({ ...base, nodePath: node.nodePath, snippet: node.labels.join(", ") });
      continue;
    }

    if (by === "compatible" && node.compatible && includesIgnoreCase(node.compatible, q)) {
      hits.push({ ...base, nodePath: node.nodePath, snippet: node.compatible });
      continue;
    }

    if (by === "value") {
      for (const property of node.properties) {
        if (includesIgnoreCase(property.normalizedValue, q) || includesIgnoreCase(property.name, q)) {
          hits.push({
            ...base,
            nodePath: node.nodePath,
            propertyName: property.name,
            snippet: `${property.name}=${property.normalizedValue}`
          });
          break;
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
    projectId?: string;
    fileId?: string;
    versionId?: string;
  } = {}
): DtsStructuredRepository {
  const projectId = options.projectId ?? DEFAULT_PROJECT_ID;
  const fileId = options.fileId ?? DEFAULT_FILE_ID;
  const versionId = options.versionId ?? DEFAULT_VERSION_ID;
  const state = createInitialState(options.nodes ?? createTeachingStructureNodes());

  function nextId(prefix: string) {
    state.counter += 1;
    return `${prefix}-${state.counter}`;
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
    async getStructure(_requestedProjectId, _requestedFileId, _requestedVersionId) {
      // Teaching convenience: return the fixture-derived structure for any / default ids
      // so structure browse can open from unrelated project manage-files dialogs.
      return { nodes: cloneNodes(state.nodes) };
    },

    async search(requestedProjectId, query) {
      if (requestedProjectId !== projectId) {
        return { hits: [] };
      }
      const by = query.by ?? "path";
      return {
        hits: searchNodes(state.nodes, query.q, by, {
          fileId,
          fileName: DEFAULT_FILE_NAME,
          versionId
        })
      };
    },

    async listConfigSets(requestedProjectId) {
      return state.configSets.filter((item) => item.projectId === requestedProjectId).map((item) => ({ ...item }));
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

    async createBaseline(_requestedProjectId, configSetId, input: CreateBaselineInput) {
      requireConfigSet(configSetId);
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

    async compareBaseline(_requestedProjectId, baselineId) {
      const baseline = requireBaseline(baselineId);
      const members = state.memberships
        .filter((membership) => membership.configSetId === baseline.configSetId)
        .map((membership) => ({
          fileId: membership.fileId,
          fileName: membership.fileId === fileId ? "teaching-sample.dts" : membership.fileId,
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
        members:
          members.length > 0
            ? members
            : [
                {
                  fileId,
                  fileName: "teaching-sample.dts",
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

    async rollbackBaseline(_requestedProjectId, baselineId) {
      const baseline = requireBaseline(baselineId);
      const restored = state.memberships.filter((item) => item.configSetId === baseline.configSetId).length || 1;
      return { baselineId: baseline.id, restored };
    },

    async releaseBaseline(_requestedProjectId, baselineId) {
      const baseline = requireBaseline(baselineId);
      const released: DtsReleaseBaseline = { ...baseline, status: "released" };
      state.baselines = state.baselines.map((item) => (item.id === baselineId ? released : item));
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
            fileName: member.fileId === fileId ? "teaching-sample.dts" : member.fileId,
            role: member.role,
            sortOrder: member.sortOrder,
            versionNumber: 1,
            format: "dts"
          }))
        },
        files: members.map((member) => ({
          name: member.fileId === fileId ? "teaching-sample.dts" : member.fileId,
          format: "dts" as const,
          content: "/* mock export derived from teaching structure */\n/dts-v1/;\n"
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
