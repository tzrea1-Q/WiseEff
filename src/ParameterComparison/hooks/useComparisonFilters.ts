import { useCallback, useEffect, useMemo, useState } from "react";
import type { RiskLevel } from "../../mockData";
import type { ComparisonFilters } from "../types";

const riskValues: RiskLevel[] = ["High", "Medium", "Low"];

const defaultFilters: ComparisonFilters = {
  driftOnly: true,
  risk: [],
  modules: [],
  query: ""
};

export type UseComparisonFiltersOptions = {
  search: string;
  onSearchChange: (search: string) => void;
};

function parseList(value: string | null) {
  return value ? value.split(",").map((item) => item.trim()).filter(Boolean) : [];
}

function parseFilters(search: string): ComparisonFilters {
  const params = new URLSearchParams(search);
  const parsedRisk = parseList(params.get("risk")).filter((risk): risk is RiskLevel => riskValues.includes(risk as RiskLevel));

  return {
    driftOnly: params.get("driftOnly") !== "0",
    risk: parsedRisk,
    modules: parseList(params.get("module")),
    query: params.get("q") ?? ""
  };
}

function serializeFilters(filters: ComparisonFilters) {
  const params = new URLSearchParams();

  if (!filters.driftOnly) {
    params.set("driftOnly", "0");
  }
  if (filters.risk.length > 0) {
    params.set("risk", filters.risk.join(","));
  }
  if (filters.modules.length > 0) {
    params.set("module", filters.modules.join(","));
  }
  if (filters.query.trim()) {
    params.set("q", filters.query.trim());
  }

  const serialized = params.toString();
  return serialized ? `?${serialized}` : "";
}

export function useComparisonFilters({ search, onSearchChange }: UseComparisonFiltersOptions) {
  const [filters, setFilters] = useState<ComparisonFilters>(() => parseFilters(search));

  useEffect(() => {
    setFilters(parseFilters(search));
  }, [search]);

  const updateFilters = useCallback(
    (updater: (current: ComparisonFilters) => ComparisonFilters) => {
      setFilters((current) => {
        const next = updater(current);
        onSearchChange(serializeFilters(next));
        return next;
      });
    },
    [onSearchChange]
  );

  return useMemo(
    () => ({
      filters,
      setDriftOnly: (driftOnly: boolean) => updateFilters((current) => ({ ...current, driftOnly })),
      setQuery: (query: string) => updateFilters((current) => ({ ...current, query })),
      setRisk: (risk: RiskLevel[]) => updateFilters((current) => ({ ...current, risk })),
      setModules: (modules: string[]) => updateFilters((current) => ({ ...current, modules })),
      resetFilters: () => updateFilters(() => defaultFilters)
    }),
    [filters, updateFilters]
  );
}
