import type { ParamAdminSearch } from "./hooks/useParamAdminSearch";
import { getCoverage, type ParameterCoverage } from "./parameterAdminAnalytics";
import type { PowerManagementParameterTemplate, PowerManagementProject } from "./powerManagementConfig";
import { collectSubtreeModuleIds, type FlatModuleNode } from "@/domain/modules/moduleTree";
import { templateModuleId } from "./parameterAdminLibrary";

export const PARAMETER_COVERAGE_LABEL: Record<ParameterCoverage | "all", string> = {
  all: "全部",
  full: "3 个项目都有",
  partial: "缺某个项目",
  orphan: "闲置参数"
};

export function filterParameterLibrary(
  parameters: readonly PowerManagementParameterTemplate[],
  projects: readonly PowerManagementProject[],
  search: ParamAdminSearch,
  moduleNodes: readonly FlatModuleNode[] = []
) {
  const riskToFilter = {
    High: "high",
    Medium: "medium",
    Low: "low"
  } as const;

  const allowedModuleIds =
    search.modules.length > 0 ? collectSubtreeModuleIds(moduleNodes, search.modules) : null;

  return parameters.filter((parameter) => {
    if (search.q) {
      const needle = search.q.toLowerCase();
      const haystack = `${parameter.name} ${parameter.module} ${parameter.description} ${parameter.explanation}`.toLowerCase();
      if (!haystack.includes(needle)) {
        return false;
      }
    }

    if (search.risk !== "all" && riskToFilter[parameter.risk] !== search.risk) {
      return false;
    }

    if (allowedModuleIds && !allowedModuleIds.has(templateModuleId(parameter, moduleNodes))) {
      return false;
    }

    if (search.coverage !== "all" && getCoverage(parameter, projects) !== search.coverage) {
      return false;
    }

    return true;
  });
}

export function sortParameterLibrary(parameters: readonly PowerManagementParameterTemplate[], sort: string) {
  const sorted = [...parameters];
  switch (sort) {
    case "name-asc":
      sorted.sort((a, b) => a.name.localeCompare(b.name));
      break;
    case "risk-desc":
      sorted.sort((a, b) => riskWeight(b.risk) - riskWeight(a.risk) || a.name.localeCompare(b.name));
      break;
    case "updatedAt-desc":
    default:
      sorted.sort((a, b) => latestUpdatedAt(b) - latestUpdatedAt(a) || a.name.localeCompare(b.name));
      break;
  }
  return sorted;
}

export function getParameterRecommendedValue(parameter: PowerManagementParameterTemplate, projects: readonly PowerManagementProject[]) {
  const firstProjectId = projects[0]?.id;
  if (!firstProjectId) {
    return "";
  }
  return parameter.values[firstProjectId]?.recommendedValue ?? "";
}

function riskWeight(risk: PowerManagementParameterTemplate["risk"]) {
  return risk === "High" ? 3 : risk === "Medium" ? 2 : 1;
}

function latestUpdatedAt(parameter: PowerManagementParameterTemplate) {
  return Math.max(
    ...Object.values(parameter.values).map((value) => {
      if (!value) {
        return 0;
      }
      const parsed = new Date(value.updatedAt).getTime();
      return Number.isFinite(parsed) ? parsed : 0;
    }),
    0
  );
}
