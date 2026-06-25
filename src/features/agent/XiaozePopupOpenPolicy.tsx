import { useEffect, useRef } from "react";
import { useCopilotChatConfiguration } from "@copilotkit/react-core/v2";
import { readXiaozePopupOpenSession } from "./xiaozePopupOpenState";

/** Align CopilotKit modal state with WiseEff default-closed policy on first mount. */
export function XiaozePopupOpenPolicy() {
  const configuration = useCopilotChatConfiguration();
  const appliedRef = useRef(false);

  useEffect(() => {
    if (appliedRef.current) {
      return;
    }
    appliedRef.current = true;

    const shouldBeOpen = readXiaozePopupOpenSession();
    if (configuration?.isModalOpen !== shouldBeOpen) {
      configuration?.setModalOpen?.(shouldBeOpen);
    }
  }, [configuration]);

  return null;
}
