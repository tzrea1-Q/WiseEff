import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

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

type MenuPosition = {
  top: number;
  left: number;
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
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const updateMenuPosition = () => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const menuWidth = 148;
    const menuHeight = 128;
    const gutter = 8;
    const left = Math.min(
      Math.max(gutter, rect.right - menuWidth),
      window.innerWidth - menuWidth - gutter
    );
    const top =
      rect.bottom + 4 + menuHeight <= window.innerHeight - gutter
        ? rect.bottom + 4
        : Math.max(gutter, rect.top - menuHeight - 4);
    setMenuPosition({ top, left });
  };

  useLayoutEffect(() => {
    if (!menuOpen) {
      return;
    }
    updateMenuPosition();
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) {
      return undefined;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setMenuOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };

    const handleScroll = () => setMenuOpen(false);

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", handleScroll, true);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [menuOpen]);

  const runMenuAction = (action: () => void) => {
    action();
    setMenuOpen(false);
  };

  const menu =
    menuOpen && menuPosition
      ? createPortal(
          <div
            ref={menuRef}
            className="dropdown-menu param-admin-module-more-menu-list"
            role="menu"
            style={{ top: menuPosition.top, left: menuPosition.left }}
          >
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
          </div>,
          document.body
        )
      : null;

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
      <div className="dropdown-root param-admin-module-more-menu">
        <button
          ref={triggerRef}
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          aria-label={`${moduleName} 更多操作`}
          className="button subtle"
          type="button"
          onClick={() => setMenuOpen((current) => !current)}
        >
          更多 <span aria-hidden="true">▾</span>
        </button>
        {menu}
      </div>
    </div>
  );
}
