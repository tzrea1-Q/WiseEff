import { useEffect, type RefObject } from "react";

export type UseWorkbenchKeyboardShortcutsParams = {
  searchInputRef: RefObject<HTMLInputElement | null>;
  treeRegionRef: RefObject<HTMLElement | null>;
  sourceRegionRef: RefObject<HTMLElement | null>;
  onFindNext: () => void;
  onGotoLine: (line: number) => void;
};

/** Alt+F/N/G/1/2 and "/" focus shortcuts for the workbench shell. */
export function useWorkbenchKeyboardShortcuts(params: UseWorkbenchKeyboardShortcutsParams): void {
  const { searchInputRef, treeRegionRef, sourceRegionRef, onFindNext, onGotoLine } = params;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const typing = tag === "input" || tag === "textarea" || target?.isContentEditable;

      if (event.metaKey || event.ctrlKey) return;

      if (event.altKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        searchInputRef.current?.focus();
        return;
      }
      if (event.altKey && event.key.toLowerCase() === "n") {
        event.preventDefault();
        onFindNext();
        return;
      }
      if (event.altKey && event.key.toLowerCase() === "g") {
        event.preventDefault();
        const line = Number(window.prompt("跳转到行号") || "");
        if (Number.isFinite(line) && line >= 1) {
          onGotoLine(line);
        }
        return;
      }
      if (event.altKey && event.key === "1") {
        event.preventDefault();
        treeRegionRef.current?.focus();
        return;
      }
      if (event.altKey && event.key === "2") {
        event.preventDefault();
        sourceRegionRef.current?.querySelector<HTMLElement>('[aria-label="DTS 源码"]')?.focus();
        return;
      }
      if (!typing && event.key === "/") {
        event.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onFindNext, onGotoLine, searchInputRef, sourceRegionRef, treeRegionRef]);
}
