import { useCallback, useEffect, useMemo, useState } from "react";
import type { Insight } from "@/components/AgentInsightBar";
import { requestXiaozeSuggestions } from "@/infrastructure/http/xiaozeSuggestionsClient";
import { supportsXiaozeProactiveInsightPage } from "./xiaozeProactiveInsights";
import { useXiaozePageContextValue } from "./xiaozePageContext";
import { dispatchXiaozeOpenHandoff } from "./xiaozeOpenHandoff";

export function useXiaozeSuggestions(options: { enabled: boolean }) {
  const pageContext = useXiaozePageContextValue();
  const [insights, setInsights] = useState<Insight[]>([]);
  const [dismissedIds, setDismissedIds] = useState<string[]>([]);

  const pageKeySupported = pageContext?.pageKey ? supportsXiaozeProactiveInsightPage(pageContext.pageKey) : false;

  const fetchSuggestions = useCallback(async (signal: AbortSignal) => {
    if (!options.enabled || !pageContext?.projectId || !pageKeySupported) {
      if (!signal.aborted) setInsights([]);
      return;
    }

    try {
      const suggestions = await requestXiaozeSuggestions({
        path: pageContext.path,
        pageKey: pageContext.pageKey,
        projectId: pageContext.projectId,
        projectName: pageContext.projectName
      }, undefined, signal);
      if (signal.aborted) return;
      setInsights(
        suggestions.map((item) => ({
          id: item.id,
          variant: item.tone,
          headline: item.headline,
          meta: item.meta,
          actions: [
            {
              id: `${item.id}-ask`,
              label: "问小泽",
              variant: "primary",
              onClick: () => {
                dispatchXiaozeOpenHandoff(item.headline);
              }
            }
          ]
        }))
      );
    } catch (error) {
      // DOMException is not always an Error subclass, so check the name directly.
      if (signal.aborted || (error as { name?: unknown } | null)?.name === "AbortError") return;
      setInsights([]);
      console.error("Failed to load Xiaoze suggestions.", error);
    }
  }, [
    options.enabled,
    pageContext?.path,
    pageContext?.pageKey,
    pageContext?.projectId,
    pageContext?.projectName,
    pageKeySupported
  ]);

  useEffect(() => {
    const controller = new AbortController();
    // A full page unload (reload or link navigation) never unmounts the hook, and the browser then rejects the
    // in-flight fetch with a TypeError; abort on pagehide so that is treated as cancellation, not a failure.
    const abort = () => controller.abort();
    window.addEventListener("pagehide", abort);
    void fetchSuggestions(controller.signal);
    return () => {
      window.removeEventListener("pagehide", abort);
      controller.abort();
    };
  }, [fetchSuggestions]);

  const visibleInsights = useMemo(
    () => insights.filter((item) => !dismissedIds.includes(item.id)),
    [dismissedIds, insights]
  );

  return {
    insights: visibleInsights,
    dismissedIds,
    dismiss: (id: string) => setDismissedIds((previous) => [...previous, id])
  };
}
