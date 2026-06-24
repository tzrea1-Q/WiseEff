import type { ReactNode } from "react";
import { CopilotKit, CopilotPopup } from "@copilotkit/react-core/v2";
import "@copilotkit/react-core/v2/styles.css";
import { AgentInsightBar } from "@/components/AgentInsightBar";
import { xiaozeProactiveEnabled } from "@/infrastructure/http/runtimeMode";
import { createXiaozeHttpAgent } from "./xiaozeHttpAgent";
import { XiaozeApprovalCard } from "./XiaozeApprovalCard";
import { useXiaozeFrontendTools } from "./xiaozeFrontendTools";
import { useXiaozeSuggestions } from "./useXiaozeSuggestions";

export type XiaozeProviderProps = {
  children: ReactNode;
  agentUrl?: string;
  enabled?: boolean;
  proactiveEnabled?: boolean;
};

function XiaozeRuntimeTools() {
  useXiaozeFrontendTools();
  return <XiaozeApprovalCard />;
}

function XiaozeProactiveInsights({ enabled }: { enabled: boolean }) {
  const { insights, dismissedIds, dismiss } = useXiaozeSuggestions({ enabled });
  return (
    <AgentInsightBar
      items={insights}
      persistKey="xiaoze-proactive-insights"
      dismissedIds={dismissedIds}
      onDismiss={dismiss}
    />
  );
}

export function XiaozeProvider({
  children,
  agentUrl,
  enabled = true,
  proactiveEnabled = xiaozeProactiveEnabled
}: XiaozeProviderProps) {
  if (!enabled) {
    return children;
  }

  const xiaozeAgent = createXiaozeHttpAgent({ agentUrl });

  return (
    <CopilotKit selfManagedAgents={{ default: xiaozeAgent }}>
      {children}
      <XiaozeProactiveInsights enabled={proactiveEnabled} />
      <XiaozeRuntimeTools />
      <CopilotPopup
        agentId="default"
        labels={{
          modalHeaderTitle: "小泽",
          welcomeMessageText: "我是小泽，可以基于当前页面和您有权限的数据答疑，并在您批准后协助提交参数变更。",
          chatToggleOpenLabel: "打开小泽"
        }}
      />
    </CopilotKit>
  );
}
