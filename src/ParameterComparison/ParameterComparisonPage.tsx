import { useMemo, type Dispatch, type SetStateAction } from "react";
import { projects, type PrototypeState } from "../mockData";
import { useTopBarActions } from "../components/layout";
import { ComparisonFilterBar } from "./components/ComparisonFilterBar";
import { ComparisonHeader } from "./components/ComparisonHeader";
import { ComparisonMatrix } from "./components/ComparisonMatrix";
import { ComparisonMetrics } from "./components/ComparisonMetrics";
import { useComparisonData } from "./hooks/useComparisonData";
import { useComparisonFilters } from "./hooks/useComparisonFilters";
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

function fallbackProjectId(projectId: string) {
  return projects.find((project) => project.id !== projectId)?.id ?? projectId;
}

export function ParameterComparisonPage({
  state,
  onNavigate,
  search,
  comparisonSelection,
  onComparisonSelectionChange,
  onSearchChange = () => undefined
}: ParameterComparisonPageProps) {
  const baseProject = projects.find((project) => project.id === comparisonSelection.baseProjectId) ?? projects[0];
  const targetProject = projects.find((project) => project.id === comparisonSelection.targetProjectId) ?? projects[1] ?? projects[0];
  const { filters, setDriftOnly, setQuery, setRisk, setModules, resetFilters } = useComparisonFilters({ search, onSearchChange });
  const comparisonData = useMemo(
    () =>
      useComparisonData({
        state,
        baseProjectId: baseProject.id,
        targetProjectId: targetProject.id,
        filters
      }),
    [baseProject.id, filters.driftOnly, filters.modules, filters.query, filters.risk, state.parameters, targetProject.id]
  );

  const chooseBaseProject = (projectId: string) => {
    onComparisonSelectionChange((current) => ({
      baseProjectId: projectId,
      targetProjectId: current.targetProjectId === projectId ? fallbackProjectId(projectId) : current.targetProjectId
    }));
  };

  const chooseTargetProject = (projectId: string) => {
    onComparisonSelectionChange((current) => ({
      baseProjectId: current.baseProjectId === projectId ? fallbackProjectId(projectId) : current.baseProjectId,
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
        onResetFilters={resetFilters}
        onSync={() => undefined}
        onIgnore={() => undefined}
      />
    </div>
  );
}
