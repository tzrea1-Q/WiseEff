import type { UserMessage } from "@ag-ui/core";
import { CopilotChatUserMessage } from "@copilotkit/react-core/v2";

type XiaozeUserMessageProps = {
  message: UserMessage;
  className?: string;
};

export function XiaozeUserMessage({ message, className }: XiaozeUserMessageProps) {
  return (
    <div className="xiaoze-user-message-block">
      <CopilotChatUserMessage
        message={message}
        className={["xiaoze-user-message", className].filter(Boolean).join(" ")}
        messageRenderer={{ className: "xiaoze-user-message__bubble" }}
      />
    </div>
  );
}
