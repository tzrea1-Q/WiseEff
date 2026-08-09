import { Activity, FolderTree, PanelRight, Rows3 } from "lucide-react";

import type { InspectorLevel } from "./workbenchInspectorModel";

export type WorkbenchShellChromeProps = {
  opsError: string | null;
  opsMessage: string | null;
  canAdmin: boolean;
  narrowViewport: boolean;
  treeOpen: boolean;
  onTreeToggle: () => void;
  inspectorOpen: boolean;
  inspectorLevel: InspectorLevel;
  onOpenActivity: () => void;
  onInspectorToggle: () => void;
  tasksOpen: boolean;
  onTasksToggle: () => void;
};

export function WorkbenchShellChrome({
  opsError,
  opsMessage,
  canAdmin,
  narrowViewport,
  treeOpen,
  onTreeToggle,
  inspectorOpen,
  inspectorLevel,
  onOpenActivity,
  onInspectorToggle,
  tasksOpen,
  onTasksToggle
}: WorkbenchShellChromeProps) {
  return (
    <>
      {opsError ? (
        <p className="configuration-workbench__ops-banner" role="alert">
          {opsError}
        </p>
      ) : null}
      {opsMessage ? (
        <p className="configuration-workbench__ops-banner" role="status">
          {opsMessage}
        </p>
      ) : null}
      {!canAdmin ? (
        <p className="configuration-workbench__ops-banner" role="note">
          仅管理员可变更配置集成员、同步或导出。只读上下文仍可查看。
        </p>
      ) : null}

      {narrowViewport ? (
        <nav className="configuration-workbench__mobile-tools" aria-label="工作台区域">
          <button
            className="button subtle configuration-workbench__mobile-tool"
            type="button"
            aria-label="源结构"
            aria-expanded={treeOpen}
            onClick={onTreeToggle}
          >
            <FolderTree size={16} aria-hidden="true" />
            源结构
          </button>
          <button
            className="button subtle configuration-workbench__mobile-tool"
            type="button"
            aria-label="活动"
            aria-pressed={inspectorOpen && inspectorLevel === "activity"}
            onClick={onOpenActivity}
          >
            <Activity size={16} aria-hidden="true" />
            活动
          </button>
          <button
            className="button subtle configuration-workbench__mobile-tool"
            type="button"
            aria-label="检查器"
            aria-expanded={inspectorOpen}
            onClick={onInspectorToggle}
          >
            <PanelRight size={16} aria-hidden="true" />
            检查器
          </button>
          <button
            className="button subtle configuration-workbench__mobile-tool"
            type="button"
            aria-label="任务面板"
            aria-expanded={tasksOpen}
            onClick={onTasksToggle}
          >
            <Rows3 size={16} aria-hidden="true" />
            任务
          </button>
        </nav>
      ) : null}
    </>
  );
}
