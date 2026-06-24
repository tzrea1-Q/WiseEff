import { HttpAgent, type AgentSubscriber, type RunAgentResult } from "@ag-ui/client";
import type { RunAgentParameters } from "@ag-ui/client";
import { createDefaultOidcAuthProvider } from "@/infrastructure/auth/oidcAuthProvider";
import { readLocalAuthToken } from "@/infrastructure/http/authClient";
import { wiseEffApiAuthorization, wiseEffApiBaseUrl } from "@/infrastructure/http/runtimeMode";
import { buildXiaozeResumeEntries, readCopilotKitResumeCommand } from "./xiaozeResumeBridge";

export { buildXiaozeResumeEntries, readCopilotKitResumeCommand };
export type { CopilotKitResumeCommand, CopilotKitInterruptEvent } from "./xiaozeResumeBridge";

export function resolveXiaozeAgentUrl(agentUrl?: string) {
  if (agentUrl) {
    return agentUrl;
  }
  const base = wiseEffApiBaseUrl.replace(/\/+$/, "");
  return `${base}/api/v1/agent/xiaoze`;
}

export async function resolveXiaozeAuthorizationHeader(): Promise<string | undefined> {
  if (wiseEffApiAuthorization?.trim()) {
    return wiseEffApiAuthorization;
  }

  const oidcProvider = createDefaultOidcAuthProvider();
  const oidcAuthorization = await oidcProvider?.getAuthorization();
  if (oidcAuthorization?.trim()) {
    return oidcAuthorization;
  }

  const localToken = readLocalAuthToken();
  return localToken ? `Bearer ${localToken}` : undefined;
}

export function createAuthenticatedFetch(fetchImpl: typeof fetch = fetch): typeof fetch {
  return async (input, init) => {
    const headers = new Headers(init?.headers);
    const authorization = await resolveXiaozeAuthorizationHeader();
    if (authorization?.trim()) {
      headers.set("Authorization", authorization);
    }
    return fetchImpl(input, { ...init, headers });
  };
}

type RunHttpAgentParameters = RunAgentParameters & { abortController?: AbortController };

class XiaozeHttpAgent extends HttpAgent {
  override runAgent(parameters?: RunHttpAgentParameters, subscriber?: AgentSubscriber): Promise<RunAgentResult> {
    const bridgedResume =
      parameters?.resume ?? buildXiaozeResumeEntries(readCopilotKitResumeCommand(parameters?.forwardedProps));
    if (!bridgedResume) {
      return super.runAgent(parameters, subscriber);
    }
    return super.runAgent({ ...parameters, resume: bridgedResume }, subscriber);
  }
}

export function createXiaozeHttpAgent(options: { agentUrl?: string; fetchImpl?: typeof fetch } = {}) {
  return new XiaozeHttpAgent({
    agentId: "default",
    url: resolveXiaozeAgentUrl(options.agentUrl),
    fetch: createAuthenticatedFetch(options.fetchImpl)
  });
}
