import { useEffect, type RefObject } from "react";
import { shouldIgnoreAppShortcut } from "@/app/keyboardShortcuts";

export function useReviewQueueKeyboard({
  enabled,
  rowIds,
  selectedId,
  onSelect,
  onOpenSelected,
  queueRef,
  detailRef
}: {
  enabled: boolean;
  rowIds: readonly string[];
  selectedId: string;
  onSelect: (id: string) => void;
  onOpenSelected: () => void;
  queueRef: RefObject<HTMLElement | null>;
  detailRef: RefObject<HTMLElement | null>;
}): void {
  useEffect(() => {
    if (!enabled) {
      return undefined;
    }

    const focusRow = (id: string) => {
      queueRef.current?.querySelector<HTMLElement>(`[data-review-row-id="${CSS.escape(id)}"]`)?.focus();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (document.querySelector('[role="dialog"], [data-slot="alert-dialog-content"]')) {
        return;
      }
      if (event.altKey && event.key === "1") {
        event.preventDefault();
        const selectedRow = queueRef.current?.querySelector<HTMLElement>('[data-review-row-id][tabindex="0"]');
        (selectedRow ?? queueRef.current)?.focus();
        return;
      }
      if (event.altKey && event.key === "2") {
        event.preventDefault();
        detailRef.current?.focus();
        return;
      }
      if (shouldIgnoreAppShortcut(event)) {
        return;
      }

      const currentIndex = rowIds.indexOf(selectedId);
      if (event.key === "j" || event.key === "ArrowDown") {
        if (currentIndex < 0 || currentIndex >= rowIds.length - 1) {
          return;
        }
        event.preventDefault();
        const nextId = rowIds[currentIndex + 1];
        onSelect(nextId);
        focusRow(nextId);
        return;
      }
      if (event.key === "k" || event.key === "ArrowUp") {
        if (currentIndex <= 0) {
          return;
        }
        event.preventDefault();
        const nextId = rowIds[currentIndex - 1];
        onSelect(nextId);
        focusRow(nextId);
        return;
      }
      if (event.key === "Enter") {
        const tag = (event.target as HTMLElement | null)?.tagName;
        if (tag === "BUTTON" || tag === "A" || tag === "INPUT" || tag === "TEXTAREA") {
          return;
        }
        event.preventDefault();
        onOpenSelected();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [detailRef, enabled, onOpenSelected, onSelect, queueRef, rowIds, selectedId]);
}
