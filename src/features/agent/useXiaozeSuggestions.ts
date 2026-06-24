import { useCallback, useEffect, useMemo, useState } from "react";
import type { Insight } from "@/components/AgentInsightBar";
import { resolveXiaozeAuthorizationHeader } from "./xiaozeHttpAgent";
import { useXiaozePageContextValue } from "./xiaozePageContext";
import { wiseEffApiBaseUrl } from "@/infrastructure/http/runtimeMode";

type SuggestResponse = {
  suggestions: Array<{
    id: string;
    tone: Insight["tone"];
    headline: string;
    meta?: string;
  }>;
};

export function useXiaozeSuggestions(options: { enabled: boolean }) {
  const pageContext = useXiaozePageContextValue();
  const [insights, setInsights] = useState<Insight[]>([]);
  const [dismissedIds, setDismissedIds] = useState<string[]>([]);

  const fetchSuggestions = useCallback(async () => {
    if (!options.enabled || !pageContext?.projectId) {
      setInsights([]);
      return;
    }

    const authorization = await resolveXiaozeAuthorizationHeader();
    const response = await fetch(`${wiseEffApiBaseUrl.replace(/\/+$/, "")}/api/v1/agent/xiaoze/suggest`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authorization ? { Authorization: authorization } : {})
      },
      body: JSON.stringify({
        context: {
          path: pageContext.path,
          pageKey: pageContext.pageKey,
          projectId: pageContext.projectId
        }
      })
    });

    if (!response.ok) {
      setInsights([]);
      return;
    }

    const payload = (await response.json()) as SuggestResponse;
    setInsights(
      payload.suggestions.map((item) => ({
        id: item.id,
        tone: item.tone,
        headline: item.headline,
        meta: item.meta,
        actions: [
          {
            id: `${item.id}-ask`,
            label: "Ask Xiaoze",
            onClick: () => {
              document.querySelector<HTMLButtonElement>('[aria-label="打开小泽"]')?.click();
            }
          }
        ]
      }))
    );
  }, [options.enabled, pageContext?.path, pageContext?.pageKey, pageContext?.projectId]);

  useEffect(() => {
    void fetchSuggestions();
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
