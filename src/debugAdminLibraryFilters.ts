import {
  bindingForProtocol,
  coverageLabel,
  isArchivedDebugParameter
} from "@/debugAdminDraft";
import type { DebugParameter, DebugParameterNodeBinding } from "@/domain/debugging/types";
import type { RiskLevel } from "@/domain/parameters/types";
import type { DebugNormalizationMode, DebugValueFormat, DebugValueKind } from "@/debugValueKind";

export { bindingForProtocol, coverageLabel, isArchivedDebugParameter };

export type DebugAdminSearch = {
  q: string;
  risk: "all" | "high" | "medium" | "low";
  modules: string[];
  coverage: "all" | "dual" | "hdc-only" | "adb-only" | "missing-binding" | "archived" | "disabled";
  sort: "name-asc" | "risk-desc" | string;
  id?: string;
};

export type DebugParameterLibraryRow = {
  id: string;
  name: string;
  key: string;
  module: string;
  description?: string;
  risk: RiskLevel;
  bindings?: DebugParameterNodeBinding[];
  enabled?: boolean;
  archivedAt?: string | null;
  valueKind?: DebugValueKind;
  valueFormat?: DebugValueFormat;
  normalizationMode?: DebugNormalizationMode;
};

const riskToFilter = {
  High: "high",
  Medium: "medium",
  Low: "low"
} as const;

function getDebugParameterCoverage(row: DebugParameterLibraryRow): Exclude<DebugAdminSearch["coverage"], "all"> {
  if (isArchivedDebugParameter(row as DebugParameter)) {
    return "archived";
  }
  if (row.enabled === false) {
    return "disabled";
  }
  const hdc = bindingForProtocol(row.bindings, "hdc").enabled;
  const adb = bindingForProtocol(row.bindings, "adb").enabled;
  if (hdc && adb) {
    return "dual";
  }
  if (hdc) {
    return "hdc-only";
  }
  if (adb) {
    return "adb-only";
  }
  return "missing-binding";
}

export function filterDebugParameterLibrary(rows: readonly DebugParameterLibraryRow[], search: DebugAdminSearch) {
  return rows.filter((row) => {
    if (search.q) {
      const needle = search.q.toLowerCase();
      const haystack = `${row.name} ${row.key} ${row.module} ${row.description ?? ""}`.toLowerCase();
      if (!haystack.includes(needle)) {
        return false;
      }
    }

    if (search.risk !== "all" && riskToFilter[row.risk] !== search.risk) {
      return false;
    }

    if (search.modules.length > 0 && !search.modules.includes(row.module)) {
      return false;
    }

    if (search.coverage !== "all" && getDebugParameterCoverage(row) !== search.coverage) {
      return false;
    }

    return true;
  });
}

export function sortDebugParameterLibrary(rows: readonly DebugParameterLibraryRow[], sort: string) {
  const sorted = [...rows];
  switch (sort) {
    case "name-asc":
      sorted.sort((a, b) => a.name.localeCompare(b.name));
      break;
    case "risk-desc":
      sorted.sort((a, b) => riskWeight(b.risk) - riskWeight(a.risk) || a.name.localeCompare(b.name));
      break;
    default:
      sorted.sort((a, b) => a.name.localeCompare(b.name));
      break;
  }
  return sorted;
}

function riskWeight(risk: RiskLevel) {
  return risk === "High" ? 3 : risk === "Medium" ? 2 : 1;
}
