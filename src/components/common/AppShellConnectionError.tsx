import { WifiOff } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Full-screen bootstrap error shown when the `/api/v1/me` probe fails at the
 * network level (service unreachable). Sits at the same level as
 * `AppShellSkeleton`: a transient API outage must not drop the user to the
 * login form (ui-design-system §Loading, empty, error).
 */
export function AppShellConnectionError({ onRetry }: { onRetry: () => void }) {
  return (
    <main className="app-shell-connection-error" aria-labelledby="app-connection-error-title">
      <div role="alert" className="app-shell-connection-error__card">
        <WifiOff size={32} aria-hidden="true" />
        <h1 id="app-connection-error-title">无法连接服务</h1>
        <p>网络连接失败或服务暂不可用，登录状态已保留。</p>
        <Button type="button" variant="outline" onClick={onRetry}>
          重试
        </Button>
      </div>
    </main>
  );
}
