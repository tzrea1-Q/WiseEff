import { useAgentContext } from "@copilotkit/react-core/v2";
import { xiaozePromptDebugEnabled } from "@/infrastructure/http/runtimeMode";

export function XiaozePromptDebugRegistrar() {
  useAgentContext({
    description: "wiseeff.debug",
    value: { promptDebug: true }
  });
  return null;
}

export function XiaozePromptDebugRequestRegistrar() {
  if (!xiaozePromptDebugEnabled) {
    return null;
  }
  return <XiaozePromptDebugRegistrar />;
}
