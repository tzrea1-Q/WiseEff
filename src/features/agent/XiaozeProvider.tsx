import type { ReactNode } from "react";
import { HttpAgent } from "@ag-ui/client";
import { CopilotKit, CopilotPopup } from "@copilotkit/react-core/v2";
import "@copilotkit/react-core/v2/styles.css";
import { wiseEffApiAuthorization, wiseEffApiBaseUrl } from "@/infrastructure/http/runtimeMode";

export type XiaozeProviderProps = {
  children: ReactNode;
  agentUrl?: string;
  enabled?: boolean;
};

function resolveAgentUrl(agentUrl?: string) {
  if (agentUrl) {
    return agentUrl;
  }
  const base = wiseEffApiBaseUrl.replace(/\/+$/, "");
  return `${base}/api/v1/agent/xiaoze`;
}

function buildAuthHeaders(): Record<string, string> {
  return wiseEffApiAuthorization ? { Authorization: wiseEffApiAuthorization } : {};
}

export function XiaozeProvider({ children, agentUrl, enabled = true }: XiaozeProviderProps) {
  if (!enabled) {
    return children;
  }

  const url = resolveAgentUrl(agentUrl);
  const headers = buildAuthHeaders();
  const xiaozeAgent = new HttpAgent({ agentId: "default", url, headers });

  return (
    <CopilotKit selfManagedAgents={{ default: xiaozeAgent }}>
      {children}
      <CopilotPopup
        agentId="default"
        labels={{
          modalHeaderTitle: "小泽",
          welcomeMessageText: "我是小泽，可以基于当前页面和您有权限的数据只读答疑。",
          chatToggleOpenLabel: "打开小泽"
        }}
      />
    </CopilotKit>
  );
}
