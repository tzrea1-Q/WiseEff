import { RowActionMenu } from "@/components/common/RowActionMenu";

export type ModuleManagementRowActionsProps = {
  moduleName: string;
  itemCount: number;
  viewItemsLabel: string;
  canEdit?: boolean;
  withinModal?: boolean;
  canDelete: boolean;
  deleteDisabledReason?: string;
  onEdit: () => void;
  onViewItems: () => void;
  onAddChild: () => void;
  onMove: () => void;
  onDelete: () => void | Promise<void>;
};

export function ModuleManagementRowActions({
  moduleName, itemCount, viewItemsLabel, canEdit = true, withinModal = false,
  canDelete, deleteDisabledReason, onEdit, onViewItems, onAddChild, onMove, onDelete
}: ModuleManagementRowActionsProps) {
  return (
    <RowActionMenu
      label={`${moduleName} 操作`}
      triggerLabel={`${moduleName} 更多操作`}
      withinModal={withinModal}
      primaryAction={{ id: "edit", label: "编辑", disabled: !canEdit, onSelect: onEdit }}
      items={[
        { id: "view", label: viewItemsLabel, disabled: itemCount === 0, onSelect: onViewItems },
        { id: "add-child", label: "添加子模块", disabled: !canEdit, onSelect: onAddChild },
        { id: "move", label: "移动", disabled: !canEdit, onSelect: onMove },
        {
          id: "delete", label: "删除", destructive: true,
          disabled: !canEdit || !canDelete,
          title: !canEdit ? "没有编辑权限" : !canDelete ? deleteDisabledReason : undefined,
          confirmation: {
            title: `删除模块「${moduleName}」？`,
            description: "此操作将永久删除这个空模块。包含子模块或节点的模块不能删除。",
            confirmLabel: "删除模块"
          },
          onSelect: onDelete
        }
      ]}
    />
  );
}
