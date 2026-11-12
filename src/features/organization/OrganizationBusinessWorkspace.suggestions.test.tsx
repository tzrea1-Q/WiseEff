import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { XiaozePageContext } from "@/features/agent/xiaozePageContext";
import { XiaozeProactiveInsights } from "@/features/agent/XiaozeProvider";
import { createApiClient } from "@/infrastructure/http/apiClient";
import { createOrganizationWorkspaceClient } from "@/infrastructure/http/userGovernanceClient";
import { OrganizationBusinessWorkspace } from "./OrganizationBusinessWorkspace";

afterEach(() => vi.unstubAllGlobals());

it("only requests suggestions after the server confirms an active target", async () => {
  let resolveScope!: (response: Response) => void;
  const suggestionTargets: Array<string | null> = [];
  const fetchImpl = vi.fn((input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, "http://localhost");
    if (url.pathname === "/api/v1/organization/operating-scope") return new Promise<Response>((resolve) => { resolveScope = resolve; });
    if (url.pathname === "/api/v1/agent/xiaoze/suggest") {
      suggestionTargets.push(url.searchParams.get("organizationId"));
      return Promise.resolve(Response.json({ suggestions: [] }));
    }
    throw new Error(`Unexpected request: ${url.pathname}`);
  });
  vi.stubGlobal("fetch", fetchImpl);
  const workspaceClient = createOrganizationWorkspaceClient(createApiClient({ baseUrl: "http://localhost", fetchImpl }));
  const actor = { user: { id: "platform", organizationId: "home", name: "Platform", title: "", isActive: true }, organization: { id: "home", name: "Home" }, roles: [{ projectId: null, roleId: "platform-admin" }], permissions: ["users:manage"] };
  const workspace = (target: string) => <XiaozePageContext.Provider value={{ path: "/parameters", pageKey: "parameters", projectId: "project" }}>
    <OrganizationBusinessWorkspace actorId="platform" organizationId={target} homePath="/parameters" workspaceClient={workspaceClient} onNavigate={vi.fn()}
      proactiveInsights={<XiaozeProactiveInsights enabled organizationId={target} />}><span>业务内容</span></OrganizationBusinessWorkspace>
  </XiaozePageContext.Provider>;

  const view = render(workspace("denied"));
  await waitFor(() => expect(resolveScope).toBeTypeOf("function"));
  expect(suggestionTargets).toEqual([]);
  await act(async () => resolveScope(Response.json({ error: { code: "FORBIDDEN", message: "Forbidden.", details: {} } }, { status: 403 })));
  expect(await screen.findByRole("alert")).toBeVisible();
  expect(suggestionTargets).toEqual([]);

  view.rerender(workspace("suspended"));
  await waitFor(() => expect(fetchImpl.mock.calls.filter(([input]) => String(input).includes("operating-scope"))).toHaveLength(2));
  expect(suggestionTargets).toEqual([]);
  await act(async () => resolveScope(Response.json({ actor, organization: { id: "suspended", name: "Suspended", status: "suspended" } })));
  expect(await screen.findByText("业务内容")).toBeVisible();
  expect(suggestionTargets).toEqual([]);

  view.rerender(workspace("active"));
  await waitFor(() => expect(fetchImpl.mock.calls.filter(([input]) => String(input).includes("operating-scope"))).toHaveLength(3));
  expect(suggestionTargets).toEqual([]);
  await act(async () => resolveScope(Response.json({ actor, organization: { id: "active", name: "Active", status: "active" } })));
  await waitFor(() => expect(suggestionTargets).toEqual(["active"]));
});
