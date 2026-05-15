import { ArrowLeftRight, Download } from "lucide-react";
import type { Project } from "../../mockData";
import { ProjectChip } from "./ProjectChip";

export type ComparisonHeaderProps = {
  projects: Project[];
  baseProject: Project;
  targetProject: Project;
  onNavigate: (href: string) => void;
  onBaseProjectChange: (projectId: string) => void;
  onTargetProjectChange: (projectId: string) => void;
  onSwap: () => void;
  onExport: () => void;
};

export function ComparisonHeader({
  projects,
  baseProject,
  targetProject,
  onNavigate,
  onBaseProjectChange,
  onTargetProjectChange,
  onSwap,
  onExport
}: ComparisonHeaderProps) {
  return (
    <div className="comparison-topbar-controls">
      <button className="button subtle" type="button" onClick={() => onNavigate("/parameters")}>
        参数
      </button>
      <ProjectChip
        label="基准项目"
        tone="base"
        projects={projects}
        selectedProjectId={baseProject.id}
        disabledProjectId={targetProject.id}
        onSelect={onBaseProjectChange}
      />
      <button className="comparison-header--v2__swap" type="button" aria-label="交换基准和对比项目" onClick={onSwap}>
        <ArrowLeftRight size={16} aria-hidden="true" />
      </button>
      <ProjectChip
        label="对比项目"
        tone="target"
        projects={projects}
        selectedProjectId={targetProject.id}
        disabledProjectId={baseProject.id}
        onSelect={onTargetProjectChange}
      />
      <button className="button subtle" type="button" aria-label="导出对比结果" onClick={onExport}>
        <Download size={16} aria-hidden="true" />
        导出
      </button>
    </div>
  );
}
