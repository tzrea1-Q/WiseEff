import { z } from "zod";
import { useFrontendTool } from "@copilotkit/react-core/v2";

function navigateToPath(path: string) {
  const url = new URL(path, window.location.origin);
  const next = `${url.pathname}${url.search}${url.hash}`;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (next !== current) {
    window.history.pushState(null, "", next);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }
}

/**
 * Frontend tools must produce user-visible effects. The former
 * `prefillParameterValue` tool wrote to a registry no page consumed, so the
 * agent claimed "已预填" while the UI never changed — it has been removed.
 */
export function useXiaozeFrontendTools() {
  useFrontendTool({
    name: "navigateTo",
    description: "Navigate the user to a WiseEff page path without performing any write.",
    parameters: z.object({
      path: z.string()
    }),
    handler: async ({ path }) => {
      navigateToPath(path);
      return { navigatedTo: path };
    }
  });
}
