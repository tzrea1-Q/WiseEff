import { useCopilotChatConfiguration } from "@copilotkit/react-core/v2";
import { Sparkles, X } from "lucide-react";
import { writeXiaozePopupOpenSession } from "./xiaozePopupOpenState";
import { XiaozeToggleHint } from "./XiaozeToggleHint";

export function XiaozeChatToggleButton() {
  const configuration = useCopilotChatConfiguration();
  const isOpen = configuration?.isModalOpen ?? false;
  const setModalOpen = configuration?.setModalOpen;
  const labels = configuration?.labels;

  const openLabel = labels?.chatToggleOpenLabel ?? "打开小泽";
  const closeLabel = labels?.chatToggleCloseLabel ?? "关闭小泽";

  return (
    <div className="xiaoze-chat-toggle-anchor">
      <XiaozeToggleHint
        visible={!isOpen}
        onOpen={() => {
          writeXiaozePopupOpenSession(true);
          setModalOpen?.(true);
        }}
      />
      <button
        type="button"
        data-copilotkit=""
        data-testid="copilot-chat-toggle"
        data-slot="chat-toggle-button"
        data-state={isOpen ? "open" : "closed"}
        className="xiaoze-chat-toggle"
        aria-label={isOpen ? closeLabel : openLabel}
        aria-pressed={isOpen}
        onClick={() => {
          const next = !isOpen;
          writeXiaozePopupOpenSession(next);
          setModalOpen?.(next);
        }}
      >
        <span className="xiaoze-chat-toggle__halo" aria-hidden="true" />
        <span className="xiaoze-chat-toggle__surface" aria-hidden="true" />
        <span className="xiaoze-chat-toggle__icon xiaoze-chat-toggle__icon--open" aria-hidden="true">
          <Sparkles size={22} strokeWidth={2.15} />
        </span>
        <span className="xiaoze-chat-toggle__icon xiaoze-chat-toggle__icon--close" aria-hidden="true">
          <X size={22} strokeWidth={2.35} />
        </span>
      </button>
    </div>
  );
}
