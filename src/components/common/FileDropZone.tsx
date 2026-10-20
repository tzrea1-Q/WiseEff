import { useId, useRef, useState, type ReactNode, type RefObject } from "react";
import { formatBytes } from "@/domain/format/formatBytes";
import { Button } from "@/components/ui/button";
import "./file-drop-zone.css";

/** The accept hint guides the picker; callers retain validation, including explicit overrides. */
export function FileDropZone({ id, label, regionLabel = "文件拖放区", browseLabel = label, hint, accept, multiple = false,
  disabled = false, required, invalid, describedBy, browseRef, files = [], listLabel = "已选文件", onSelect, onRemove, renderFileDetails, canRemove,
}: {
  id?: string; label: string; regionLabel?: string; browseLabel?: string; hint?: string; accept?: string; multiple?: boolean;
  disabled?: boolean; required?: boolean; invalid?: boolean; describedBy?: string; browseRef?: RefObject<HTMLButtonElement | null>;
  files?: File[]; listLabel?: string; onSelect: (files: File[]) => void; onRemove: (index: number) => void;
  renderFileDetails?: (index: number) => ReactNode; canRemove?: (index: number) => boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const [dragging, setDragging] = useState(false);
  const buttonLabel = !multiple && files.length ? "更换文件" : browseLabel;
  const description = [describedBy, hint ? hintId : undefined].filter(Boolean).join(" ") || undefined;
  const select = (selected: File[]) => {
    if (!disabled && selected.length) onSelect(multiple ? selected : selected.slice(0, 1));
  };
  return <div className="file-drop-zone">
    <section className="file-drop-zone__target" aria-label={regionLabel} data-dragging={dragging && !disabled || undefined}
      onDragOver={(event) => { event.preventDefault(); if (!disabled) setDragging(true); }}
      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
      onDrop={(event) => { event.preventDefault(); setDragging(false); select(Array.from(event.dataTransfer.files)); }}>
      <Button id={id} ref={browseRef} type="button" variant="ghost" className="file-drop-zone__browse" disabled={disabled}
        aria-label={buttonLabel} aria-invalid={invalid || undefined} aria-describedby={description} onClick={() => inputRef.current?.click()}>
        <span>{buttonLabel}</span><span className="file-drop-zone__hint">或将文件拖到此处</span>
      </Button>
      <input ref={inputRef} type="file" hidden aria-hidden="true" tabIndex={-1} data-testid="file-drop-zone-input" accept={accept} multiple={multiple}
        disabled={disabled} required={required}
        onChange={(event) => { select(Array.from(event.target.files ?? [])); event.target.value = ""; }} />
    </section>
    {files.length ? <ul aria-label={listLabel} className="file-drop-zone__files">{files.map((file, index) => <li key={index}>
      <div className="file-drop-zone__file"><span>{file.name} · {formatBytes(file.size)}</span>
        {canRemove?.(index) !== false ? <Button type="button" variant="ghost" size="sm" disabled={disabled} aria-label={`移除 ${file.name}`}
          onClick={() => onRemove(index)}>移除</Button> : null}</div>
      {renderFileDetails?.(index)}
    </li>)}</ul> : null}
    {hint ? <p id={hintId} className="file-drop-zone__hint">{hint}</p> : null}
  </div>;
}
