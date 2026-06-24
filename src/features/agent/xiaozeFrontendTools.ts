import { z } from "zod";
import { useFrontendTool } from "@copilotkit/react-core/v2";

type PrefillRegistry = {
  parameterId?: string;
  value?: string;
};

const prefillRegistry: PrefillRegistry = {};

export function getXiaozePrefillRegistry() {
  return prefillRegistry;
}

function navigateToPath(path: string) {
  const url = new URL(path, window.location.origin);
  const next = `${url.pathname}${url.search}${url.hash}`;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (next !== current) {
    window.history.pushState(null, "", next);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }
}

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

  useFrontendTool({
    name: "prefillParameterValue",
    description: "Pre-fill a parameter form value locally without submitting a change.",
    parameters: z.object({
      parameterId: z.string(),
      value: z.string()
    }),
    handler: async ({ parameterId, value }) => {
      prefillRegistry.parameterId = parameterId;
      prefillRegistry.value = value;
      return { parameterId, value };
    }
  });
}

export function resetXiaozePrefillRegistry() {
  delete prefillRegistry.parameterId;
  delete prefillRegistry.value;
}
