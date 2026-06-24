import type { UserMessage } from "@ag-ui/core";
import { CopilotChatUserMessage } from "@copilotkit/react-core/v2";
import { xiaozePromptDebugEnabled } from "@/infrastructure/http/runtimeMode";
import { useXiaozePromptDebugSnapshotForTurn } from "./XiaozePromptDebugContext";
import { XiaozePromptDebugPanel } from "./XiaozePromptDebugPanel";

type XiaozeUserMessageProps = {
  message: UserMessage;
  className?: string;
};

export function XiaozeUserMessage({ message, className }: XiaozeUserMessageProps) {
  const userMessage = typeof message.content === "string" ? message.content : "";
  const snapshot = useXiaozePromptDebugSnapshotForTurn(userMessage, undefined);

  return (
    <div className="xiaoze-user-message-block">
      <CopilotChatUserMessage
        message={message}
        className={["xiaoze-user-message", className].filter(Boolean).join(" ")}
        messageRenderer={{ className: "xiaoze-user-message__bubble" }}
      />
      {xiaozePromptDebugEnabled && snapshot ? (
        <div className="xiaoze-prompt-debug-anchor">
          <XiaozePromptDebugPanel snapshot={snapshot} />
        </div>
      ) : null}
    </div>
  );
}
