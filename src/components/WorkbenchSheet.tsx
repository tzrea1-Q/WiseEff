import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

type WorkbenchSheetProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
};

export function WorkbenchSheet({ open, onClose, title, description, children, footer }: WorkbenchSheetProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      closeButtonRef.current?.focus();
    }
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <aside className="workbench-sheet" role="dialog" aria-modal="false" aria-label={title}>
      <header className="workbench-sheet-head">
        <div>
          <h2>{title}</h2>
          {description ? <p>{description}</p> : null}
        </div>
        <button ref={closeButtonRef} type="button" className="icon-button" aria-label="关闭草稿" onClick={onClose}>
          <X aria-hidden="true" />
        </button>
      </header>
      <div className="workbench-sheet-body">{children}</div>
      {footer ? <footer className="workbench-sheet-foot">{footer}</footer> : null}
    </aside>
  );
}
