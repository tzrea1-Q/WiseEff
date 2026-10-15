import { useRef, useState } from "react";
import { DropdownMenu } from "radix-ui";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { presentError } from "@/infrastructure/http/presentError";
import { ConfirmDialog, type ConfirmDialogProps } from "./ConfirmDialog";
import "./row-action-menu.css";

type RowAction = {
  id: string;
  label: string;
  ariaLabel?: string;
  descriptionId?: string;
  description?: string;
  title?: string;
  disabled?: boolean;
  onSelect: () => void | Promise<void>;
};

type DestructiveRowAction = RowAction & {
  destructive: true;
  confirmation: Pick<ConfirmDialogProps, "title" | "description" | "confirmLabel" | "acknowledgement">;
};

type ConfirmedElsewhereRowAction = Omit<RowAction, "onSelect"> & {
  destructive: true;
  onRequestConfirmation: () => void;
};

export type RowActionMenuProps = {
  label: string;
  triggerLabel?: string;
  triggerText?: string;
  /** Portaled menus opened inside a modal must share its overlay layer. */
  withinModal?: boolean;
  primaryAction?: RowAction & { destructive?: false };
  items: readonly (RowAction & { destructive?: false } | DestructiveRowAction | ConfirmedElsewhereRowAction)[];
};

export function RowActionMenu({ label, triggerLabel, triggerText = "更多", withinModal = false, primaryAction, items }: RowActionMenuProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [selected, setSelected] = useState<DestructiveRowAction | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function confirm() {
    if (!selected || pending) return;
    setPending(true);
    setError("");
    try {
      await selected.onSelect();
      setSelected(null);
    } catch (failure) {
      setError(presentError(failure, "操作失败，请重试。"));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="row-action-menu" role="group" aria-label={label}>
      {primaryAction && <Button type="button" size="sm" variant="outline" title={primaryAction.title} aria-label={primaryAction.ariaLabel} disabled={primaryAction.disabled} onClick={primaryAction.onSelect}>
        {primaryAction.label}
      </Button>}
      {items.length > 0 && <DropdownMenu.Root modal={false}>
        <DropdownMenu.Trigger asChild>
          <Button ref={triggerRef} type="button" size="sm" variant="outline" aria-label={triggerLabel ?? `${label}：${triggerText}`}>{triggerText}<ChevronDown aria-hidden="true" className="size-3" /></Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className={`row-action-menu__content${withinModal ? " row-action-menu__content--modal" : ""}`} align="end" onClick={(event) => event.stopPropagation()}
            onCloseAutoFocus={(event) => { if (selected) event.preventDefault(); }}>
            {items.map((item) => <DropdownMenu.Item key={item.id} className="row-action-menu__item button-size-sm" title={item.title} aria-label={item.ariaLabel} aria-describedby={item.descriptionId} data-destructive={item.destructive || undefined} disabled={item.disabled} onSelect={() => {
              if ("onRequestConfirmation" in item) {
                triggerRef.current?.focus();
                item.onRequestConfirmation();
              } else if (item.destructive) {
                triggerRef.current?.focus();
                setError("");
                setSelected(item);
              } else {
                triggerRef.current?.focus();
                item.onSelect();
              }
            }}>
              <span>{item.label}</span>
              {item.description ? <span className="row-action-menu__description">{item.description}</span> : null}
            </DropdownMenu.Item>)}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>}
      {selected && <ConfirmDialog open {...selected.confirmation} tone="danger" pending={pending} error={error}
        onCancel={() => setSelected(null)} onConfirm={() => { void confirm(); }} />}
    </div>
  );
}
