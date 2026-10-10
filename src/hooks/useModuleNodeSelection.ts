import { useCallback, useEffect, useRef, useState, type SetStateAction } from "react";

export function useModuleNodeSelection(isAvailable?: (nodeId: string) => boolean) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(
    () => new URLSearchParams(window.location.search).get("moduleNode") || null
  );

  useEffect(() => {
    const restoreSelection = () => setSelectedNodeId(new URLSearchParams(window.location.search).get("moduleNode") || null);
    window.addEventListener("popstate", restoreSelection);
    return () => window.removeEventListener("popstate", restoreSelection);
  }, []);

  const updateSelection = useCallback((next: SetStateAction<string | null>) => {
    setSelectedNodeId((current) => {
      const selection = typeof next === "function" ? next(current) : next;
      const url = new URL(window.location.href);
      if (selection) url.searchParams.set("moduleNode", selection);
      else url.searchParams.delete("moduleNode");
      const href = `${url.pathname}${url.search}${url.hash}`;
      if (href !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
        window.history.pushState(window.history.state, "", href);
      }
      return selection;
    });
  }, []);

  const resolution = useRef({ id: selectedNodeId, resolved: false });
  useEffect(() => {
    if (resolution.current.id !== selectedNodeId) {
      resolution.current = { id: selectedNodeId, resolved: false };
    }
    if (!selectedNodeId || !isAvailable) return;
    if (isAvailable(selectedNodeId)) resolution.current.resolved = true;
    else if (resolution.current.resolved) updateSelection(null);
  }, [selectedNodeId, isAvailable, updateSelection]);

  return [selectedNodeId, updateSelection] as const;
}
