import type { ReactNode } from "react";
import { CopilotKit, CopilotPopup } from "@copilotkit/react-core/v2";
import "@copilotkit/react-core/v2/styles.css";
import { createXiaozeHttpAgent } from "./xiaozeHttpAgent";
import { XiaozeApprovalCard } from "./XiaozeApprovalCard";
import { useXiaozeFrontendTools } from "./xiaozeFrontendTools";

export type XiaozeProviderProps = {
  children: ReactNode;
  agentUrl?: string;
  enabled?: boolean;
};

function XiaozeRuntimeTools() {
  useXiaozeFrontendTools();
  return <XiaozeApprovalCard />;
}

export function XiaozeProvider({ children, agentUrl, enabled = true }: XiaozeProviderProps) {
  if (!enabled) {
    return children;
  }

  const xiaozeAgent = createXiaozeHttpAgent({ agentUrl });

  return (
    <CopilotKit selfManagedAgents={{ default: xiaozeAgent }}>
      {children}
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
