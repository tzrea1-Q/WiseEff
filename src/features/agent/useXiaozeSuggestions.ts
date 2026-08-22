import { useCallback, useEffect, useMemo, useState } from "react";
import type { Insight } from "@/components/AgentInsightBar";
import { resolveXiaozeAuthorizationHeader } from "./xiaozeHttpAgent";
import { supportsXiaozeProactiveInsightPage } from "./xiaozeProactiveInsights";
import { useXiaozePageContextValue } from "./xiaozePageContext";
import { resolveWiseEffApiBaseUrl } from "@/infrastructure/http/runtimeMode";
import { parseContractDto } from "@/infrastructure/http/parseContractDto";
import { xiaozeSuggestResponseSchema } from "@wiseeff/dto-schemas";

export function useXiaozeSuggestions(options: { enabled: boolean }) {
  const pageContext = useXiaozePageContextValue();
  const [insights, setInsights] = useState<Insight[]>([]);
  const [dismissedIds, setDismissedIds] = useState<string[]>([]);

  const pageKeySupported = pageContext?.pageKey ? supportsXiaozeProactiveInsightPage(pageContext.pageKey) : false;

  const fetchSuggestions = useCallback(async () => {
    if (!options.enabled || !pageContext?.projectId || !pageKeySupported) {
      setInsights([]);
      return;
    }

    try {
      const authorization = await resolveXiaozeAuthorizationHeader();
      const response = await fetch(`${resolveWiseEffApiBaseUrl().replace(/\/+$/, "")}/api/v1/agent/xiaoze/suggest`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(authorization ? { Authorization: authorization } : {})
        },
        body: JSON.stringify({
          context: {
            path: pageContext.path,
            pageKey: pageContext.pageKey,
            projectId: pageContext.projectId,
            projectName: pageContext.projectName
          }
        })
      });

      if (!response.ok) {
        setInsights([]);
        return;
      }

      const payload = parseContractDto(
        xiaozeSuggestResponseSchema,
        await response.json(),
        "XiaozeSuggestResponse"
      );
      setInsights(
        payload.suggestions.map((item) => ({
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
                document.querySelector<HTMLButtonElement>('[aria-label="打开小泽"]')?.click();
              }
            }
          ]
        }))
      );
    } catch (error) {
      setInsights([]);
      console.error("Failed to load Xiaoze suggestions.", error);
    }
  }, [options.enabled, pageContext?.path, pageContext?.pageKey, pageContext?.projectId, pageKeySupported]);

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
