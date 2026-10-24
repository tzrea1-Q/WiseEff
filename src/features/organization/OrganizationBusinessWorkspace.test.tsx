import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OrganizationBusinessWorkspace } from "./OrganizationBusinessWorkspace";
import { createOrganizationWorkspaceClient } from "@/infrastructure/http/userGovernanceClient";
import { createApiClient } from "@/infrastructure/http/apiClient";

describe("business workspace admits proactive work only in an active organization", () => {
  const props = { actorId: "platform", homePath: "/parameters", onNavigate: vi.fn(), children: <span>只读业务内容</span>, proactiveInsights: <span>允许的建议</span> };
  it("keeps Home business readable while suspended and re-enables suggestions after restoration", () => {
    const view = render(<OrganizationBusinessWorkspace {...props} homeSuspended />);
    expect(screen.getByText("只读业务内容")).toBeVisible();
    expect(screen.queryByText("允许的建议")).not.toBeInTheDocument();
    view.rerender(<OrganizationBusinessWorkspace {...props} homeSuspended={false} />);
    expect(screen.getByText("允许的建议")).toBeVisible();
  });
  it("waits for the explicit target status, preserves active Home identity, and re-enables restored target work", async () => {
    const actor = { user: { id: "platform", organizationId: "home", name: "Platform", title: "", isActive: true }, organization: { id: "home", name: "Active home" }, roles: [{ projectId: null, roleId: "platform-admin" }], permissions: ["users:manage", "platform:access"] };
    const client = (status: string) => createOrganizationWorkspaceClient(createApiClient({ baseUrl: "", fetchImpl: vi.fn(async () => new Response(JSON.stringify({ actor, organization: { id: "target", name: "Target", status } }))) }));
    const view = render(<OrganizationBusinessWorkspace {...props} organizationId="target" workspaceClient={client("suspended")} />);
    expect(screen.queryByText("允许的建议")).not.toBeInTheDocument();
    expect(await screen.findByText("只读业务内容")).toBeVisible();
    expect(screen.getByText("所属组织：Active home")).toBeVisible();
    expect(screen.queryByText("允许的建议")).not.toBeInTheDocument();
    view.rerender(<OrganizationBusinessWorkspace {...props} organizationId="target" workspaceClient={client("active")} />);
    expect(await screen.findByText("允许的建议")).toBeVisible();
  });
});
