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
    expect(screen.getByRole("status")).toHaveTextContent("当前工作区仅可查看，请联系管理员");
    expect(screen.queryByText("允许的建议")).not.toBeInTheDocument();
    view.rerender(<OrganizationBusinessWorkspace {...props} homeSuspended={false} />);
    expect(screen.getByText("允许的建议")).toBeVisible();
  });
  it("validates an ordinary member's explicit Home scope without displaying its identity", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      actor: { user: { id: "member", organizationId: "home", name: "Member", title: "", isActive: true }, organization: { id: "home", name: "Secret Home" }, roles: [{ projectId: null, roleId: "hardware-committer" }], permissions: ["parameter:view"] },
      organization: { id: "home", name: "Secret Home", status: "active" }
    })));
    render(<OrganizationBusinessWorkspace {...props} actorId="member" organizationId="home" workspaceClient={createOrganizationWorkspaceClient(createApiClient({ baseUrl: "", fetchImpl }))} />);
    expect(await screen.findByText("只读业务内容")).toBeVisible();
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(screen.queryByLabelText("当前操作组织")).not.toBeInTheDocument();
    expect(screen.queryByText("Secret Home")).not.toBeInTheDocument();
    expect(screen.queryByText("home")).not.toBeInTheDocument();
  });
  it("does not render business content when an explicit target is rejected", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: { code: "FORBIDDEN", message: "Cannot operate in this Organization.", details: {} } }), { status: 403 }));
    render(<OrganizationBusinessWorkspace {...props} actorId="member" organizationId="foreign" workspaceClient={createOrganizationWorkspaceClient(createApiClient({ baseUrl: "", fetchImpl }))} />);
    expect(await screen.findByRole("alert")).toBeVisible();
    expect(screen.queryByText("只读业务内容")).not.toBeInTheDocument();
  });
  it("explains a suspended-workspace rejection without exposing organization terminology", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: { code: "FORBIDDEN", message: "组织已停用，当前仅可查看。请联系平台管理员恢复组织。", details: { reason: "organization-suspended" } } }), { status: 403 }));
    render(<OrganizationBusinessWorkspace {...props} actorId="member" organizationId="home" workspaceClient={createOrganizationWorkspaceClient(createApiClient({ baseUrl: "", fetchImpl }))} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("当前工作区仅可查看，请联系管理员");
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
  it("keeps a platform administrator's explicit target visible even without member-management capability", async () => {
    const actor = { user: { id: "platform", organizationId: "home", name: "Platform", title: "", isActive: true }, organization: { id: "home", name: "Home" }, roles: [{ projectId: null, roleId: "platform-admin" }], permissions: ["platform:access", "parameter:view"] };
    const client = createOrganizationWorkspaceClient(createApiClient({ baseUrl: "", fetchImpl: vi.fn(async () => new Response(JSON.stringify({ actor, organization: { id: "target", name: "Target", status: "active" } }))) }));
    render(<OrganizationBusinessWorkspace {...props} organizationId="target" workspaceClient={client} />);
    expect(await screen.findByRole("region", { name: "当前操作组织" })).toHaveTextContent("Target");
  });
});
