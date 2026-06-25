import type { ReactNode } from "react";
import {
  CopilotChatConfigurationProvider,
  CopilotChatMessageView,
  CopilotChatView,
  CopilotKit,
  CopilotPopup
} from "@copilotkit/react-core/v2";
import "@copilotkit/react-core/v2/styles.css";
import { AgentInsightBar } from "@/components/AgentInsightBar";
import { xiaozePromptDebugEnabled } from "@/infrastructure/http/runtimeMode";
import { createXiaozeHttpAgent } from "./xiaozeHttpAgent";
import { XiaozeApprovalCard } from "./XiaozeApprovalCard";
import { useXiaozeFrontendTools } from "./xiaozeFrontendTools";
import { useXiaozeSuggestions } from "./useXiaozeSuggestions";
import { XiaozeChatHeader } from "./XiaozeChatHeader";
import { XiaozeChatScrollView } from "./XiaozeChatScrollView";
import { XiaozeMessageView } from "./XiaozeMessageView";
import { XiaozeRunTimingCapture } from "./XiaozeRunTimingCapture";
import { XiaozeRunTimingProvider } from "./XiaozeRunTimingContext";
import { XiaozePromptDebugCapture } from "./XiaozePromptDebugCapture";
import { XiaozePromptDebugProvider } from "./XiaozePromptDebugContext";
import { XiaozePromptDebugRequestRegistrar } from "./XiaozePromptDebugRegistrar";
import { XiaozeThreadController } from "./XiaozeThreadController";
import { useXiaozeThreads, XiaozeThreadProvider } from "./XiaozeThreadContext";

export type XiaozeProviderProps = {
  children: ReactNode;
  agentUrl?: string;
  enabled?: boolean;
  /** CopilotKit AG-UI inspector; off by default and gated to admin in AppShell. */
  enableInspector?: boolean;
};

function XiaozeRuntimeTools() {
  useXiaozeFrontendTools();
  return <XiaozeApprovalCard />;
}

function XiaozeCopilotPopup() {
  const { activeThreadId } = useXiaozeThreads();

  return (
    <CopilotChatConfigurationProvider threadId={activeThreadId} hasExplicitThreadId>
      <CopilotPopup
        agentId="default"
        throttleMs={16}
        width={420}
        height={680}
        header={{
          children: (headerProps) => <XiaozeChatHeader {...headerProps} />
        }}
        labels={{
          modalHeaderTitle: "小泽",
          welcomeMessageText: "我是小泽，可以基于当前页面和您有权限的平台数据答疑；涉及变更、提交或设备写入等操作，会在您批准后再协助执行。",
          chatToggleOpenLabel: "打开小泽",
          chatToggleCloseLabel: "关闭小泽",
          chatInputPlaceholder: "",
          chatDisclaimerText: "AI 可能会出错，重要决策请自行核实。"
        }}
        messageView={XiaozeMessageView as typeof CopilotChatMessageView}
        scrollView={XiaozeChatScrollView as typeof CopilotChatView.ScrollView}
      />
    </CopilotChatConfigurationProvider>
  );
}

export function XiaozeProactiveInsights({ enabled }: { enabled: boolean }) {
  const { insights, dismissedIds, dismiss } = useXiaozeSuggestions({ enabled });
  return (
    <AgentInsightBar
      eyebrow="小泽建议"
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
  enableInspector = false
}: XiaozeProviderProps) {
  if (!enabled) {
    return children;
  }

  const xiaozeAgent = createXiaozeHttpAgent({ agentUrl });

  return (
    <XiaozePromptDebugProvider>
      <CopilotKit enableInspector={enableInspector} selfManagedAgents={{ default: xiaozeAgent }}>
        <XiaozeThreadProvider>
          <XiaozeRunTimingProvider>
            {children}
            <XiaozeRuntimeTools />
            <XiaozeThreadController />
            <XiaozePromptDebugRequestRegistrar />
            <XiaozePromptDebugCapture enabled={xiaozePromptDebugEnabled} />
            <XiaozeRunTimingCapture />
            <XiaozeCopilotPopup />
          </XiaozeRunTimingProvider>
        </XiaozeThreadProvider>
      </CopilotKit>
    </XiaozePromptDebugProvider>
  );
}
