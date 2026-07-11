import { useEffect, useRef, useState } from "react";

export type ModuleManagementRowActionsProps = {
  moduleName: string;
  itemCount: number;
  viewItemsLabel: string;
  canDelete: boolean;
  deleteDisabledReason?: string;
  onEdit: () => void;
  onViewItems: () => void;
  onAddChild: () => void;
  onMove: () => void;
  onDelete: () => void;
};

export function ModuleManagementRowActions({
  moduleName,
  itemCount,
  viewItemsLabel,
  canDelete,
  deleteDisabledReason,
  onEdit,
  onViewItems,
  onAddChild,
  onMove,
  onDelete
}: ModuleManagementRowActionsProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) {
      return undefined;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };

    window.addEventListener("mousedown", handlePointerDown);
    return () => window.removeEventListener("mousedown", handlePointerDown);
  }, [menuOpen]);

  const runMenuAction = (action: () => void) => {
    action();
    setMenuOpen(false);
  };

  return (
    <div className="param-admin-module-row-actions">
      <button className="button subtle" type="button" onClick={onEdit}>
        修改
      </button>
      {itemCount > 0 ? (
        <button className="button subtle" type="button" onClick={onViewItems}>
          {viewItemsLabel}
        </button>
      ) : null}
      <div className="dropdown-root param-admin-module-more-menu" ref={menuRef}>
        <button
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          aria-label={`${moduleName} 更多操作`}
          className="button subtle"
          type="button"
          onClick={() => setMenuOpen((current) => !current)}
        >
          更多 <span aria-hidden="true">▾</span>
        </button>
        {menuOpen ? (
          <div className="dropdown-menu param-admin-module-more-menu-list" role="menu">
            <button className="dropdown-item" role="menuitem" type="button" onClick={() => runMenuAction(onAddChild)}>
              添加子模块
            </button>
            <button className="dropdown-item" role="menuitem" type="button" onClick={() => runMenuAction(onMove)}>
              移动
            </button>
            <button
              className="dropdown-item dropdown-item--danger"
              disabled={!canDelete}
              role="menuitem"
              title={!canDelete ? deleteDisabledReason : undefined}
              type="button"
              onClick={() => runMenuAction(onDelete)}
            >
              删除
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
