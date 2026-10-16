import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { useBodyScrollLock } from "@/hooks/useBodyScrollLock";

type WorkbenchSheetProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  /** Close-button label; callers name the thing being closed. */
  closeLabel?: string;
};

export function WorkbenchSheet({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  closeLabel = "关闭草稿"
}: WorkbenchSheetProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      const owner = event.target instanceof Element ? event.target.closest('[role="dialog"], [role="alertdialog"]') : null;
      if (owner && owner !== sheetRef.current) return;
      if (event.key === "Escape" && !event.defaultPrevented && !document.querySelector('[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]')) {
        event.preventDefault();
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, open]);

  useBodyScrollLock(open);

  useEffect(() => {
    if (open) {
      const activeElement = document.activeElement;
      // StrictMode replays this effect after focus has already entered the sheet.
      if (activeElement instanceof HTMLElement && !sheetRef.current?.contains(activeElement)) {
        returnFocusRef.current = activeElement;
      }
      const trigger = returnFocusRef.current;
      closeButtonRef.current?.focus();
      return () => {
        queueMicrotask(() => {
          if (!document.querySelector(".workbench-sheet") && trigger?.isConnected) trigger.focus();
        });
      };
    }
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <aside ref={sheetRef} className="workbench-sheet" role="dialog" aria-modal="false" aria-label={title}>
      <header className="workbench-sheet-head">
        <div>
          <h2>{title}</h2>
          {description ? <p>{description}</p> : null}
        </div>
        <button ref={closeButtonRef} type="button" className="icon-button" aria-label={closeLabel} onClick={onClose}>
          <X aria-hidden="true" />
        </button>
      </header>
      <div className="workbench-sheet-body">{children}</div>
      {footer ? <footer className="workbench-sheet-foot">{footer}</footer> : null}
    </aside>
  );
}
