import { Clipboard, Download, Eye } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export function ExportMenu({
  onDownload,
  onCopy,
  onViewDiff
}: {
  onDownload: () => void;
  onCopy: () => void;
  onViewDiff: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    window.addEventListener("mousedown", handlePointerDown);
    return () => window.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  const runAction = (action: () => void) => {
    action();
    setOpen(false);
  };

  return (
    <div className="dropdown-root export-menu" ref={rootRef}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        className="button subtle"
        type="button"
        onClick={() => setOpen((current) => !current)}
      >
        <Download aria-hidden="true" size={16} />
        导出 JSON
        <span aria-hidden="true">▾</span>
      </button>
      {open ? (
        <div className="dropdown-menu export-menu-list" role="menu">
          <button className="dropdown-item" role="menuitem" type="button" onClick={() => runAction(onDownload)}>
            <Download aria-hidden="true" size={15} />
            下载 JSON 文件
          </button>
          <button className="dropdown-item" role="menuitem" type="button" onClick={() => runAction(onCopy)}>
            <Clipboard aria-hidden="true" size={15} />
            复制到剪贴板
          </button>
          <button className="dropdown-item" role="menuitem" type="button" onClick={() => runAction(onViewDiff)}>
            <Eye aria-hidden="true" size={15} />
            查看导出 diff
          </button>
        </div>
      ) : null}
    </div>
  );
}
