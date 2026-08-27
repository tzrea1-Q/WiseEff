import { useEffect, useRef } from "react";
import { useCopilotChatConfiguration } from "@copilotkit/react-core/v2";
import { writeXiaozePopupOpenSession } from "./xiaozePopupOpenState";

/**
 * Normalize CopilotKit's outer modal state once when Xiaoze mounts. Route
 * changes deliberately do not close the popup; route continuity is owned by
 * the surrounding provider and page-context flow.
 */
export function XiaozePopupOpenPolicy() {
  const configuration = useCopilotChatConfiguration();
  const initializedRef = useRef(false);

  useEffect(() => {
    if (initializedRef.current || !configuration?.setModalOpen) {
      return;
    }

    initializedRef.current = true;
    writeXiaozePopupOpenSession(false);
    configuration.setModalOpen(false);
  }, [configuration?.setModalOpen]);

  return null;
}
