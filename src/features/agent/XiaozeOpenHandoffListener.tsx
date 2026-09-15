import { useCopilotChatConfiguration } from "@copilotkit/react-core/v2";
import { useEffect } from "react";
import { XIAOZE_OPEN_HANDOFF_EVENT, type XiaozeOpenHandoffDetail } from "./xiaozeOpenHandoff";
import { writeXiaozePopupOpenSession } from "./xiaozePopupOpenState";

export function XiaozeOpenHandoffListener() {
  const configuration = useCopilotChatConfiguration();

  useEffect(() => {
    const handler = (event: Event) => {
      writeXiaozePopupOpenSession(true);
      configuration?.setModalOpen?.(true);

      const customEvent = event as CustomEvent<XiaozeOpenHandoffDetail>;
      const detail = customEvent.detail;
      let promptText = "";

      if (detail?.text) {
        promptText = detail.text;
      } else if (detail?.preset) {
        if (detail.preset === "knowledge-ask") {
          promptText = "请问当前知识库中有哪些相关规约或排查经验？";
        } else if (detail.preset === "log-domain-governance") {
          promptText = "请协助排查并治理当前日志领域的未分类模式。";
        } else {
          promptText = detail.preset;
        }
      }

      if (promptText) {
        window.requestAnimationFrame(() => {
          setTimeout(() => {
            const textarea = document.querySelector<HTMLTextAreaElement>('[data-testid="copilot-chat-textarea"]');
            if (textarea) {
              const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
              valueSetter?.call(textarea, promptText);
              textarea.dispatchEvent(new Event("input", { bubbles: true }));
              textarea.focus();
            }
          }, 120);
        });
      }
    };

    window.addEventListener(XIAOZE_OPEN_HANDOFF_EVENT, handler);
    return () => window.removeEventListener(XIAOZE_OPEN_HANDOFF_EVENT, handler);
  }, [configuration]);

  return null;
}
