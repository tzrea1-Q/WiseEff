import type { PowerManagementConfig, PowerManagementProjectId } from "../../powerManagementConfig";
import type { ParameterRecord } from "./types";
import { buildParameterLibraryFromRecords } from "../../parameterAdminLibrary";
import type {
  ProjectParameterInitializationDraft,
  ProjectParameterInitializationSnapshotItem,
  RiskLevel
} from "./types";

type CandidateInput = {
  primarySourceProjectId: string;
  supplementSourceProjectIds: string[];
  selectedModules: string[];
  selectedRisks: RiskLevel[];
};

type DraftInput = CandidateInput & {
  id: string;
  projectId: string;
  projectName: string;
  projectCode: string;
  ownerUserId: string;
  createdBy: string;
  now: string;
  sourceProjectIds: string[];
  selectedParameterIds: string[];
  notes?: string;
};

export function resolveInitializationConfig(
  configDraft: PowerManagementConfig,
  parameters: readonly ParameterRecord[] = []
): PowerManagementConfig {
  if (parameters.length === 0) {
    return configDraft;
  }

  return {
    ...configDraft,
    parameterLibrary: buildParameterLibraryFromRecords(parameters, configDraft.projects)
  };
}

function hasProjectValue(values: Record<string, unknown>, projectId: string) {
  return Object.prototype.hasOwnProperty.call(values, projectId);
}

function getProjectValue(
  values: PowerManagementConfig["parameterLibrary"][number]["values"],
  projectId: string
) {
  return values[projectId as PowerManagementProjectId];
}

function resolveDefinitionRecommendedValue(
  parameter: PowerManagementConfig["parameterLibrary"][number]
) {
  for (const value of Object.values(parameter.values)) {
    const recommended = value?.recommendedValue?.trim();
    if (recommended) {
      return recommended;
    }
  }

  return "";
}

function createLibraryScopeCandidate(
  parameter: PowerManagementConfig["parameterLibrary"][number]
): ProjectParameterInitializationSnapshotItem {
  const recommendedValue = resolveDefinitionRecommendedValue(parameter);

  return {
    parameterId: parameter.id,
    sourceProjectId: "",
    sourceRole: "library",
    module: parameter.module,
    risk: parameter.risk,
    recommendedValue,
    currentValueState: "pending_project_confirmation",
    alternativeSourceProjectIds: [],
    needsRecommendedValueConfirmation: !recommendedValue
  };
}

export function getInitializationScopeParameters(
  config: PowerManagementConfig,
  input: Pick<CandidateInput, "primarySourceProjectId" | "supplementSourceProjectIds">
): ProjectParameterInitializationSnapshotItem[] {
  const sourceCandidates = input.primarySourceProjectId
    ? getInitializationCandidateParameters(config, {
        primarySourceProjectId: input.primarySourceProjectId,
        supplementSourceProjectIds: input.supplementSourceProjectIds,
        selectedModules: [],
        selectedRisks: []
      })
    : [];
  const sourceCandidateById = new Map(sourceCandidates.map((candidate) => [candidate.parameterId, candidate]));

  return config.parameterLibrary.map((parameter) => {
    return sourceCandidateById.get(parameter.id) ?? createLibraryScopeCandidate(parameter);
  });
}

export function getInitializationCandidateParameters(
  config: PowerManagementConfig,
  input: CandidateInput
): ProjectParameterInitializationSnapshotItem[] {
  const selectedModuleSet = new Set(input.selectedModules);
  const selectedRiskSet = new Set<RiskLevel>(input.selectedRisks);
  const sourcePriority = [input.primarySourceProjectId, ...input.supplementSourceProjectIds];

  return config.parameterLibrary
    .filter((parameter) => selectedModuleSet.size === 0 || selectedModuleSet.has(parameter.module))
    .filter((parameter) => selectedRiskSet.size === 0 || selectedRiskSet.has(parameter.risk))
    .flatMap((parameter) => {
      const sourceProjectId = sourcePriority.find((projectId) => hasProjectValue(parameter.values, projectId));
      if (!sourceProjectId) {
        return [];
      }

      const value = getProjectValue(parameter.values, sourceProjectId);
      const alternatives = sourcePriority.filter(
        (projectId) => projectId !== sourceProjectId && hasProjectValue(parameter.values, projectId)
      );

      return [
        {
          parameterId: parameter.id,
          sourceProjectId,
          sourceRole: sourceProjectId === input.primarySourceProjectId ? "primary" : "supplement",
          module: parameter.module,
          risk: parameter.risk,
          recommendedValue: value?.recommendedValue ?? "",
          currentValueState: "pending_project_confirmation",
          alternativeSourceProjectIds: alternatives,
          needsRecommendedValueConfirmation: !value?.recommendedValue?.trim()
        }
      ];
    });
}

export function buildInitializationDraft(
  config: PowerManagementConfig,
  input: DraftInput
): ProjectParameterInitializationDraft {
  const selectedIds = new Set(input.selectedParameterIds);
  const candidates = getInitializationScopeParameters(config, input);

  return {
    id: input.id,
    projectId: input.projectId,
    projectName: input.projectName,
    projectCode: input.projectCode,
    ownerUserId: input.ownerUserId,
    sourceProjectIds: input.sourceProjectIds,
    primarySourceProjectId: input.primarySourceProjectId,
    supplementSourceProjectIds: input.supplementSourceProjectIds,
    selectedModules: input.selectedModules,
    selectedRisks: input.selectedRisks,
    selectedParameterIds: input.selectedParameterIds,
    parameterSnapshots: candidates.filter((candidate) => selectedIds.has(candidate.parameterId)),
    notes: input.notes ?? "",
    createdBy: input.createdBy,
    createdAt: input.now,
    updatedAt: input.now
  };
}

export function canSubmitInitializationDraft(draft: ProjectParameterInitializationDraft) {
  const isEmptyInitialization = draft.sourceProjectIds.length === 0;

  if (draft.parameterSnapshots.length === 0 && !isEmptyInitialization) {
    return {
      ok: false as const,
      reason: "请至少选择一个参数后再提交初始化审阅。"
    };
  }

  if (!draft.primarySourceProjectId && draft.sourceProjectIds.length > 0) {
    return {
      ok: false as const,
      reason: "请先选择主来源项目后再提交初始化审阅。"
    };
  }

  return { ok: true as const };
}

export function applyInitializationDraftToConfig(
  config: PowerManagementConfig,
  draft: ProjectParameterInitializationDraft
): PowerManagementConfig {
  const existingProject = config.projects.some((project) => project.id === draft.projectId);
  const snapshotByParameterId = new Map(draft.parameterSnapshots.map((item) => [item.parameterId, item]));

  return {
    ...config,
    projects: existingProject
      ? config.projects
      : [...config.projects, { id: draft.projectId, name: draft.projectName, code: draft.projectCode }],
    parameterLibrary: config.parameterLibrary.map((parameter) => {
      const snapshot = snapshotByParameterId.get(parameter.id);
      if (!snapshot) {
        return parameter;
      }

      return {
        ...parameter,
        values: {
          ...parameter.values,
          [draft.projectId]: {
            currentValue: "待项目确认",
            recommendedValue: snapshot.recommendedValue,
            updatedAt: "just now"
          }
        }
      };
    })
  };
}
