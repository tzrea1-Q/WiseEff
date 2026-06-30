import { useEffect, useRef } from "react";
import { useCopilotChatConfiguration } from "@copilotkit/react-core/v2";
import { useXiaozePageContextValue } from "./xiaozePageContext";
import { writeXiaozePopupOpenSession } from "./xiaozePopupOpenState";

/** Close the outer CopilotKit modal scope on navigation; inner state is handled in XiaozePopupView. */
export function XiaozePopupOpenPolicy() {
  const configuration = useCopilotChatConfiguration();
  const pageContext = useXiaozePageContextValue();
  const path = pageContext?.path;
  const previousPathRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!configuration?.setModalOpen || !path) {
      return;
    }

    if (previousPathRef.current === undefined) {
      previousPathRef.current = path;
      writeXiaozePopupOpenSession(false);
      configuration.setModalOpen(false);
      return;
    }

    if (path !== previousPathRef.current) {
      previousPathRef.current = path;
      writeXiaozePopupOpenSession(false);
      configuration.setModalOpen(false);
    }
  }, [configuration?.setModalOpen, path]);

  return null;
}
