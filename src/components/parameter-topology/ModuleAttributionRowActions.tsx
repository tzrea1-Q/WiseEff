import { Eye, Pencil, Trash2 } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { PARAMETER_ADMIN_UI } from "@/application/parameters/parameterAdminUiCopy";
import type { ParameterModule } from "@/domain/parameter-topology/moduleRegistry";
import {
  addChildModuleDecision,
  canViewUnclassifiedRoot,
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
  tabIndex?: number;
};

type MenuPosition = {
  top: number;
  left: number;
};

function disabledMenuItem(
  label: string,
  reason: string,
  ariaLabel: string,
  danger = false
) {
  return (
    <button
      type="button"
      className={`dropdown-item${danger ? " dropdown-item--danger" : ""}`}
      role="menuitem"
      disabled
      aria-disabled="true"
      aria-label={ariaLabel}
      title={reason}
      onClick={(event) => event.preventDefault()}
    >
      {label}
    </button>
  );
}

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
  onReorder,
  tabIndex
}: ModuleAttributionRowActionsProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const focusLast = useRef(false);

  const showView = canViewUnclassifiedRoot(module) && Boolean(onView);
  const detailsReadOnly = !canAdmin;
  const showEdit = !showView && !detailsReadOnly;
  const showDetails = !showView && detailsReadOnly;
  const addChildDecision = addChildModuleDecision(module);
  const moveDecision = moveModuleDecision(module);
  const deleteDecision = deleteModuleDecision(module, modules);
  const canMoveUp = Boolean(onReorder && sortOrderSwapUpdates(module, "up", modules));
  const canMoveDown = Boolean(onReorder && sortOrderSwapUpdates(module, "down", modules));
  const canManageTaxonomy = canAdmin && !canViewUnclassifiedRoot(module);
  const showReorder = canManageTaxonomy && Boolean(onReorder);
  const showAddChild = canManageTaxonomy && module.kind === "business";
  const showMove = canManageTaxonomy;
  const showDelete = canAdmin;
  const hasMore =
    showReorder || showAddChild || showMove;

  const updateMenuPosition = useCallback(() => {
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
  }, [onReorder]);

  useLayoutEffect(() => {
    if (!menuOpen) {
      setMenuPosition(null);
      return;
    }
    updateMenuPosition();
  }, [menuOpen, updateMenuPosition]);

  useEffect(() => {
    if (busy && menuOpen) {
      setMenuOpen(false);
      triggerRef.current?.closest<HTMLElement>('[role="treeitem"]')?.focus({ preventScroll: true });
    }
  }, [busy, menuOpen]);

  useEffect(() => {
    if (!menuOpen || !menuPosition) return;
    const items = menuRef.current?.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)');
    items?.[focusLast.current ? items.length - 1 : 0]?.focus({ preventScroll: true });
  }, [menuOpen, menuPosition]);

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
      if (event.key === "Escape") {
        setMenuOpen(false);
        triggerRef.current?.focus();
      }
    };

    const handleReposition = () => {
      updateMenuPosition();
    };

    const handleScroll = () => {
      setMenuOpen(false);
      triggerRef.current?.focus({ preventScroll: true });
    };

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleReposition);
    window.addEventListener("scroll", handleScroll, true);

    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleReposition);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [menuOpen, updateMenuPosition]);

  if (!showView && !showEdit && !showDetails && !hasMore) {
    return <span className="module-attribution-tree__actions is-spacer" aria-hidden="true" />;
  }

  const runMenuAction = (action: () => void) => {
    if (busy) return;
    triggerRef.current?.focus();
    action();
    setMenuOpen(false);
  };

  const menu =
    menuOpen && menuPosition
      ? createPortal(
          <div
            ref={menuRef}
            className="dropdown-menu module-attribution-tree__more-menu"
            role="menu"
            tabIndex={-1}
            aria-label={`${module.name} 操作`}
            onKeyDown={(event) => {
              const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)') ?? [])];
              const index = items.indexOf(document.activeElement as HTMLButtonElement);
              if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
                event.preventDefault();
                const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
                  : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
                items[next]?.focus({ preventScroll: true });
              } else if (event.key === "Escape" || event.key === "Tab") {
                if (event.key === "Escape") event.preventDefault();
                event.stopPropagation();
                setMenuOpen(false);
                triggerRef.current?.focus();
              }
            }}
            style={{ top: menuPosition.top, left: menuPosition.left }}
          >
            {showReorder ? (
              <>
                {canMoveUp ? (
                  <button
                    type="button"
                    className="dropdown-item"
                    role="menuitem"
                    aria-label={`${PARAMETER_ADMIN_UI.moduleAttributionMoveUp} ${module.name}`}
                    onClick={() => runMenuAction(() => onReorder!("up"))}
                  >
                    {PARAMETER_ADMIN_UI.moduleAttributionMoveUp}
                  </button>
                ) : (
                  disabledMenuItem(
                    PARAMETER_ADMIN_UI.moduleAttributionMoveUp,
                    "已在同级最前。",
                    `${PARAMETER_ADMIN_UI.moduleAttributionMoveUp} ${module.name}`
                  )
                )}
                {canMoveDown ? (
                  <button
                    type="button"
                    className="dropdown-item"
                    role="menuitem"
                    aria-label={`${PARAMETER_ADMIN_UI.moduleAttributionMoveDown} ${module.name}`}
                    onClick={() => runMenuAction(() => onReorder!("down"))}
                  >
                    {PARAMETER_ADMIN_UI.moduleAttributionMoveDown}
                  </button>
                ) : (
                  disabledMenuItem(
                    PARAMETER_ADMIN_UI.moduleAttributionMoveDown,
                    "已在同级最后。",
                    `${PARAMETER_ADMIN_UI.moduleAttributionMoveDown} ${module.name}`
                  )
                )}
              </>
            ) : null}
            {showAddChild ? (
              addChildDecision.allowed ? (
                <button
                  type="button"
                  className="dropdown-item"
                  role="menuitem"
                  aria-label={`添加子模块到 ${module.name}`}
                  onClick={() => runMenuAction(onAddChild)}
                >
                  添加子模块
                </button>
              ) : (
                disabledMenuItem(
                  "添加子模块",
                  addChildDecision.reason,
                  `添加子模块到 ${module.name}`
                )
              )
            ) : null}
            {showMove ? (
              moveDecision.allowed ? (
                <button
                  type="button"
                  className="dropdown-item"
                  role="menuitem"
                  aria-label={`调整上级模块 ${module.name}`}
                  onClick={() => runMenuAction(onMove)}
                >
                  调整上级模块
                </button>
              ) : (
                disabledMenuItem("调整上级模块", moveDecision.reason, `调整上级模块 ${module.name}`)
              )
            ) : null}
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
          tabIndex={tabIndex}
          aria-label={`查看 ${module.name}`}
          onClick={onView}
        >
          <Eye size={14} strokeWidth={2} aria-hidden="true" />
          查看
        </button>
      ) : null}

      {showDetails ? <button type="button" className="button ghost" disabled={busy} tabIndex={tabIndex}
        aria-label={`查看模块 ${module.name}`} onClick={onEdit}><Eye size={14} aria-hidden="true" />查看</button> : null}

      {showEdit ? (
        <button
          type="button"
          className="button ghost"
          disabled={busy}
          tabIndex={tabIndex}
          aria-label={`修改模块 ${module.name}`}
          onClick={onEdit}
        >
          <Pencil size={14} strokeWidth={2} aria-hidden="true" />
          修改
        </button>
      ) : null}

      {showDelete ? <button type="button" className="button ghost danger" tabIndex={tabIndex}
        disabled={busy || !deleteDecision.allowed} aria-label={`删除模块 ${module.name}`}
        title={deleteDecision.allowed ? "删除模块，保留参数并清空模块归属" : deleteDecision.reason}
        onClick={onDelete}><Trash2 size={14} aria-hidden="true" />删除</button> : null}

      {hasMore ? (
        <div className="dropdown-root module-attribution-tree__more">
          <button
            ref={triggerRef}
            type="button"
            className="button ghost"
            disabled={busy}
            tabIndex={tabIndex}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            aria-label={`${module.name} 更多操作`}
            onClick={() => { focusLast.current = false; setMenuOpen((current) => !current); }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                focusLast.current = event.key === "ArrowUp";
                setMenuOpen(true);
              }
            }}
          >
            更多 <span aria-hidden="true">▾</span>
          </button>
          {menu}
        </div>
      ) : null}
    </div>
  );
}
