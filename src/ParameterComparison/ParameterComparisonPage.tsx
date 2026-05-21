import { type Dispatch, type SetStateAction } from "react";
import type { PrototypeState } from "../mockData";
import { useTopBarActions } from "../components/layout";
import { ComparisonFilterBar } from "./components/ComparisonFilterBar";
import { ComparisonHeader } from "./components/ComparisonHeader";
import { ComparisonMatrix } from "./components/ComparisonMatrix";
import { ComparisonMetrics } from "./components/ComparisonMetrics";
import { useComparisonFilters } from "./hooks/useComparisonFilters";
import {
  fallbackComparisonProjectId,
  useParameterComparisonViewModel
} from "@/features/parameter-comparison/useParameterComparisonViewModel";
import type { ComparisonProjectSelection } from "./types";
import { exportComparisonRowsAsExcel } from "./utils/exportToExcel";

export type ParameterComparisonPageProps = {
  state: PrototypeState;
  onNavigate: (href: string) => void;
  search: string;
  comparisonSelection: ComparisonProjectSelection;
  onComparisonSelectionChange: Dispatch<SetStateAction<ComparisonProjectSelection>>;
  onSearchChange?: (search: string) => void;
};

export function ParameterComparisonPage({
  state,
  onNavigate,
  search,
  comparisonSelection,
  onComparisonSelectionChange,
  onSearchChange = () => undefined
}: ParameterComparisonPageProps) {
  const { filters, setDriftOnly, setQuery, setRisk, setModules, resetFilters } = useComparisonFilters({ search, onSearchChange });
  const { projects, baseProject, targetProject, comparisonData } = useParameterComparisonViewModel({ state, comparisonSelection, filters });

  const chooseBaseProject = (projectId: string) => {
    onComparisonSelectionChange((current) => ({
      baseProjectId: projectId,
      targetProjectId: current.targetProjectId === projectId ? fallbackComparisonProjectId(projectId) : current.targetProjectId
    }));
  };

  const chooseTargetProject = (projectId: string) => {
    onComparisonSelectionChange((current) => ({
      baseProjectId: current.baseProjectId === projectId ? fallbackComparisonProjectId(projectId) : current.baseProjectId,
      targetProjectId: projectId
    }));
  };

  const swapProjects = () => {
    onComparisonSelectionChange((current) => ({
      baseProjectId: current.targetProjectId,
      targetProjectId: current.baseProjectId
    }));
  };

  const showHighRisk = () => {
    setDriftOnly(true);
    setRisk(["High"]);
  };
  useTopBarActions(
    <ComparisonHeader
      projects={projects}
      baseProject={baseProject}
      targetProject={targetProject}
      onNavigate={onNavigate}
      onBaseProjectChange={chooseBaseProject}
      onTargetProjectChange={chooseTargetProject}
      onSwap={swapProjects}
      onExport={() => exportComparisonRowsAsExcel(comparisonData.filteredRows, baseProject.code, targetProject.code)}
    />,
    [baseProject.id, comparisonData.filteredRows, targetProject.id]
  );

  return (
    <div className="comparison-page comparison-page--v2" data-testid="comparison-page-v2">
      <ComparisonMetrics
        total={comparisonData.metrics.total}
        drift={comparisonData.metrics.drift}
        synced={comparisonData.metrics.synced}
        highRisk={comparisonData.metrics.highRisk}
        onShowDrift={() => setDriftOnly(true)}
        onShowHighRisk={showHighRisk}
      />
      <ComparisonFilterBar
        filters={filters}
        moduleOptions={comparisonData.moduleOptions}
        visibleCount={comparisonData.filteredRows.length}
        totalCount={comparisonData.rows.length}
        onQueryChange={setQuery}
        onDriftOnlyChange={setDriftOnly}
        onRiskChange={setRisk}
        onModulesChange={setModules}
        onReset={resetFilters}
      />
      <ComparisonMatrix
        rows={comparisonData.filteredRows}
        query={filters.query}
        baseProjectCode={baseProject.code}
        targetProjectCode={targetProject.code}
        totalCount={comparisonData.rows.length}
        columnFilters={[
          {
            key: "risk",
            label: "重要性",
            groupLabel: "重要性筛选",
            values: ["High", "Medium", "Low"],
            selectedValues: filters.risk,
            onToggle: (risk) =>
              setRisk(filters.risk.includes(risk as "High" | "Medium" | "Low")
                ? filters.risk.filter((item) => item !== risk)
                : [...filters.risk, risk as "High" | "Medium" | "Low"]),
            onClear: () => setRisk([])
          },
          {
            key: "module",
            label: "模块",
            groupLabel: "模块筛选",
            values: comparisonData.moduleOptions,
            selectedValues: filters.modules,
            onToggle: (module) =>
              setModules(filters.modules.includes(module)
                ? filters.modules.filter((item) => item !== module)
                : [...filters.modules, module]),
            onClear: () => setModules([])
          }
        ]}
        onResetFilters={resetFilters}
        onSync={() => undefined}
        onIgnore={() => undefined}
      />
    </div>
  );
}
