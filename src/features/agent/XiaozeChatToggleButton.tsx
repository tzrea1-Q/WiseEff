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
    <div className="xiaoze-chat-toggle-anchor" data-xiaoze-launcher-anchor="">
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
        data-xiaoze-launcher-drag-handle=""
        data-state={isOpen ? "open" : "closed"}
        className="xiaoze-chat-toggle"
        aria-label={isOpen ? closeLabel : openLabel}
        aria-describedby="xiaoze-launcher-drag-instructions"
        aria-pressed={isOpen}
        title="点击打开或关闭小泽；拖动可移动小泽"
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
      <span id="xiaoze-launcher-drag-instructions" className="sr-only">
        拖动悬浮球可移动小泽；展开后悬浮球会带着窗口一起移动。方向键每次移动 8 像素，按住 Shift 每次移动 32 像素，Home 恢复默认位置。
      </span>
    </div>
  );
}
