import { useCopilotChatConfiguration } from "@copilotkit/react-core/v2";
import { useEffect } from "react";
import { XIAOZE_OPEN_HANDOFF_EVENT } from "./xiaozeOpenHandoff";
import { writeXiaozePopupOpenSession } from "./xiaozePopupOpenState";

export function XiaozeOpenHandoffListener() {
  const configuration = useCopilotChatConfiguration();

  useEffect(() => {
    const handler = (_event: Event) => {
      writeXiaozePopupOpenSession(true);
      configuration?.setModalOpen?.(true);
    };

    window.addEventListener(XIAOZE_OPEN_HANDOFF_EVENT, handler);
    return () => window.removeEventListener(XIAOZE_OPEN_HANDOFF_EVENT, handler);
  }, [configuration]);

  return null;
}
