import type { ComponentProps, ReactNode } from "react";
import { useMemo } from "react";
import {
  CopilotChatConfigurationProvider,
  CopilotChatMessageView,
  CopilotChatView,
  CopilotKit
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
import { XiaozeCopilotPopup } from "./XiaozeCopilotPopup";
import { readStoredXiaozePopupSize } from "./xiaozePopupLayout";
import { XiaozeOpenHandoffListener } from "./XiaozeOpenHandoffListener";
import { XiaozePopupOpenPolicy } from "./XiaozePopupOpenPolicy";
import { XiaozeMessageView } from "./XiaozeMessageView";
import { XiaozeRunTimingCapture } from "./XiaozeRunTimingCapture";
import { XiaozeRunTimingProvider } from "./XiaozeRunTimingContext";
import { XiaozeRunStepsCapture } from "./XiaozeRunStepsCapture";
import { XiaozeRunStepsProvider } from "./XiaozeRunStepsContext";
import { XiaozeTurnReplyCapture } from "./XiaozeTurnReplyCapture";
import { XiaozeTurnReplyProvider } from "./XiaozeTurnReplyContext";
import { XiaozeTurnStateProvider } from "./XiaozeTurnStateContext";
import { XiaozeTurnStateCapture } from "./XiaozeTurnStateCapture";
import { XiaozePromptDebugCapture } from "./XiaozePromptDebugCapture";
import { XiaozePromptDebugProvider } from "./XiaozePromptDebugContext";
import { XiaozePromptDebugRequestRegistrar } from "./XiaozePromptDebugRegistrar";
import { XiaozeThreadController } from "./XiaozeThreadController";
import { useXiaozeThreads, XiaozeThreadProvider } from "./XiaozeThreadContext";

const XIAOZE_POPUP_LABELS = {
  modalHeaderTitle: "小泽",
  welcomeMessageText:
    "我是小泽，可以基于当前页面和您有权限的平台数据答疑；涉及变更、提交或设备写入等操作，会在您批准后再协助执行。",
  chatToggleOpenLabel: "打开小泽",
  chatToggleCloseLabel: "关闭小泽",
  chatInputPlaceholder: "",
  chatDisclaimerText: "AI 可能会出错，重要决策请自行核实。"
} as const;

function renderXiaozePopupHeader(headerProps: ComponentProps<typeof XiaozeChatHeader>) {
  return <XiaozeChatHeader {...headerProps} />;
}

const XIAOZE_POPUP_HEADER = {
  children: renderXiaozePopupHeader
} as const;

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

function XiaozeCopilotPopupHost() {
  const { activeThreadId } = useXiaozeThreads();
  const popupSize = useMemo(() => readStoredXiaozePopupSize(), []);
  return (
    <CopilotChatConfigurationProvider threadId={activeThreadId} hasExplicitThreadId isModalDefaultOpen={false}>
      <XiaozePopupOpenPolicy />
      <XiaozeOpenHandoffListener />
      <XiaozeCopilotPopup
        agentId="default"
        throttleMs={16}
        defaultOpen={false}
        width={popupSize.width}
        height={popupSize.height}
        header={XIAOZE_POPUP_HEADER}
        labels={XIAOZE_POPUP_LABELS}
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
            <XiaozeRunStepsProvider>
              <XiaozeTurnReplyProvider>
                <XiaozeTurnStateProvider>
                  {children}
                  <XiaozeRuntimeTools />
                  <XiaozeThreadController />
                  <XiaozePromptDebugRequestRegistrar />
                  <XiaozePromptDebugCapture enabled={xiaozePromptDebugEnabled} />
                  <XiaozeRunTimingCapture />
                  <XiaozeRunStepsCapture />
                  <XiaozeTurnReplyCapture />
                  <XiaozeTurnStateCapture />
                  <XiaozeCopilotPopupHost />
                </XiaozeTurnStateProvider>
              </XiaozeTurnReplyProvider>
            </XiaozeRunStepsProvider>
          </XiaozeRunTimingProvider>
        </XiaozeThreadProvider>
      </CopilotKit>
    </XiaozePromptDebugProvider>
  );
}
