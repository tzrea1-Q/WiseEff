import { Eye, Pencil } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { ParameterModule } from "@/domain/parameter-topology/moduleRegistry";
import {
  addChildModuleDecision,
  canEditModuleDetails,
  canViewUnclassifiedRoot,
  deleteActionLabel,
  deleteModuleDecision,
  moveModuleDecision,
  sortOrderSwapUpdates
} from "./moduleAttributionTreeUtils";

export type ModuleAttributionRowActionsProps = {
  module: ParameterModule;
  modules: readonly ParameterModule[];
  busy?: boolean;
  canAdmin?: boolean;
  onView?: () => void;
  onEdit: () => void;
  onAddChild: () => void;
  onMove: () => void;
  onDelete: () => void;
  onReorder?: (direction: "up" | "down") => void;
};

type MenuPosition = {
  top: number;
  left: number;
};

/**
 * Always-visible primary edit + overflow menu for secondary actions.
 * Menu is portaled to avoid clipping by the tree scroll container.
 */
export function ModuleAttributionRowActions({
  module,
  modules,
  busy = false,
  canAdmin = false,
  onView,
  onEdit,
  onAddChild,
  onMove,
  onDelete,
  onReorder
}: ModuleAttributionRowActionsProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const showView = canViewUnclassifiedRoot(module) && Boolean(onView);
  const showEdit = canAdmin && canEditModuleDetails(module);
  const addChildDecision = addChildModuleDecision(module);
  const moveDecision = moveModuleDecision(module);
  const deleteDecision = deleteModuleDecision(module);
  const canMoveUp = Boolean(
    onReorder && module.kind !== "unclassified" && sortOrderSwapUpdates(module, "up", modules)
  );
  const canMoveDown = Boolean(
    onReorder && module.kind !== "unclassified" && sortOrderSwapUpdates(module, "down", modules)
  );
  const hasMore = canAdmin;

  const updateMenuPosition = () => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const menuWidth = 160;
    const menuHeight = onReorder ? 184 : 112;
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
      setMenuPosition(null);
      return;
    }
    updateMenuPosition();
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return undefined;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) {
        return;
      }
      setMenuOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };

    const handleReposition = () => {
      updateMenuPosition();
    };

    const handleScroll = () => {
      setMenuOpen(false);
    };

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleReposition);
    // Close on any scroll — position would otherwise drift relative to the clipped tree.
    window.addEventListener("scroll", handleScroll, true);

    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleReposition);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [menuOpen]);

  if (!showView && !showEdit && !hasMore) {
    return <span className="module-attribution-tree__actions is-spacer" aria-hidden="true" />;
  }

  const runMenuAction = (action: () => void) => {
    action();
    setMenuOpen(false);
  };

  const disabledItem = (label: string, reason: string, ariaLabel: string, danger = false) => (
    <button
      type="button"
      className={`dropdown-item${danger ? " dropdown-item--danger" : ""}`}
      role="menuitem"
      disabled
      aria-disabled="true"
      aria-label={ariaLabel}
      title={reason}
    >
      {label}
    </button>
  );

  const menu =
    menuOpen && menuPosition
      ? createPortal(
          <div
            ref={menuRef}
            className="dropdown-menu module-attribution-tree__more-menu"
            role="menu"
            style={{ top: menuPosition.top, left: menuPosition.left }}
          >
            {onReorder ? (
              <>
                {canMoveUp ? (
                  <button
                    type="button"
                    className="dropdown-item"
                    role="menuitem"
                    aria-label={`上移 ${module.name}`}
                    onClick={() => runMenuAction(() => onReorder("up"))}
                  >
                    上移
                  </button>
                ) : disabledItem("上移", "已在同级最前。", `上移 ${module.name}`)}
                {canMoveDown ? (
                  <button
                    type="button"
                    className="dropdown-item"
                    role="menuitem"
                    aria-label={`下移 ${module.name}`}
                    onClick={() => runMenuAction(() => onReorder("down"))}
                  >
                    下移
                  </button>
                ) : disabledItem("下移", "已在同级最后。", `下移 ${module.name}`)}
              </>
            ) : null}
            {addChildDecision.allowed ? (
              <button
                type="button"
                className="dropdown-item"
                role="menuitem"
                aria-label={`添加子模块到 ${module.name}`}
                onClick={() => runMenuAction(onAddChild)}
              >
                添加子模块
              </button>
            ) : disabledItem("添加子模块", addChildDecision.reason, `添加子模块到 ${module.name}`)}
            {moveDecision.allowed ? (
              <button
                type="button"
                className="dropdown-item"
                role="menuitem"
                aria-label={`移动模块 ${module.name}`}
                onClick={() => runMenuAction(onMove)}
              >
                移动
              </button>
            ) : disabledItem("移动", moveDecision.reason, `移动模块 ${module.name}`)}
            {deleteDecision.allowed ? (
              <button
                type="button"
                className="dropdown-item dropdown-item--danger"
                role="menuitem"
                aria-label={`${deleteActionLabel(module)} ${module.name}`}
                onClick={() => runMenuAction(onDelete)}
              >
                {module.kind === "driver-group" ? "解散" : "删除"}
              </button>
            ) : disabledItem(
              module.kind === "driver-group" ? "解散" : "删除",
              deleteDecision.reason,
              `${deleteActionLabel(module)} ${module.name}`,
              true
            )}
          </div>,
          document.body
        )
      : null;

  return (
    <div className="module-attribution-tree__actions">
      {showView ? (
        <button
          type="button"
          className="button ghost"
          disabled={busy}
          aria-label={`查看 ${module.name}`}
          onClick={onView}
        >
          <Eye size={14} strokeWidth={2} aria-hidden="true" />
          查看
        </button>
      ) : null}

      {showEdit ? (
        <button
          type="button"
          className="button ghost"
          disabled={busy}
          aria-label={`修改模块 ${module.name}`}
          onClick={onEdit}
        >
          <Pencil size={14} strokeWidth={2} aria-hidden="true" />
          修改
        </button>
      ) : null}

      {hasMore ? (
        <div className="dropdown-root module-attribution-tree__more">
          <button
            ref={triggerRef}
            type="button"
            className="button ghost"
            disabled={busy}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            aria-label={`${module.name} 更多操作`}
            onClick={() => setMenuOpen((current) => !current)}
          >
            更多 <span aria-hidden="true">▾</span>
          </button>
          {menu}
        </div>
      ) : null}
    </div>
  );
}
