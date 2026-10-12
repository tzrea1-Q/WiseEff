import { ConfirmDialog } from "@/components/common/ConfirmDialog";

export function projectDeleteConfirmation(project: { name: string; code: string; parameterCount: number; moduleCount: number }) {
  return {
    title: `删除项目 ${project.name}`,
    description: <>确认删除项目 <code>{project.code}</code>？此操作不可撤销，将移除项目基础信息
      {project.parameterCount > 0 ? `及其 ${project.parameterCount} 个参数值` : ""}
      {project.moduleCount > 0 ? `和 ${project.moduleCount} 个模块` : ""}。
      共享参数库中的参数定义会保留。</>,
    confirmLabel: "确认删除"
  };
}

export function DeleteProjectDialog({
  open,
  projectName,
  projectCode,
  parameterCount = 0,
  moduleCount = 0,
  loading = false,
  onConfirm,
  onCancel
}: {
  open: boolean;
  projectName: string;
  projectCode: string;
  parameterCount?: number;
  moduleCount?: number;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <ConfirmDialog open={open} {...projectDeleteConfirmation({ name: projectName, code: projectCode, parameterCount, moduleCount })}
      className="delete-project-dialog" tone="danger" pending={loading} pendingLabel="删除中…" onConfirm={onConfirm} onCancel={onCancel} />
  );
}
