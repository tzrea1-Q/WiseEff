import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OrganizationOverviewPanel } from "./OrganizationOverviewPanel";
import type { OrganizationWorkspaceSummary } from "@/infrastructure/http/userGovernanceClient";

const summary: OrganizationWorkspaceSummary = { organization: { id: "target", name: "目标组织", status: "active" }, counts: { members: 4, teams: 2, projects: 3 }, administration: { pendingInvitations: 1, pendingHandovers: 2, pendingIdentitySync: 1 } };
describe("organization overview", () => {
  it("shows real clickable counts and target-scoped pending work", async () => {
    const onNavigate = vi.fn();
    render(<OrganizationOverviewPanel load={vi.fn().mockResolvedValue(summary)} onNavigate={onNavigate} organizationId="target" />);
    fireEvent.click(await screen.findByRole("button", { name: "成员 4" }));
    expect(onNavigate).toHaveBeenLastCalledWith("/organization/members?organizationId=target");
    fireEvent.click(screen.getByRole("button", { name: "待同步身份 1" }));
    expect(onNavigate).toHaveBeenLastCalledWith("/organization/members?organizationId=target");
  });
  it("does not invent zeros during loading, retries failure and renders actual empty counts", async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error("服务暂不可用")).mockResolvedValueOnce({ ...summary, counts: { members: 0, teams: 0, projects: 0 } });
    render(<OrganizationOverviewPanel load={load} onNavigate={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "成员 0" })).not.toBeInTheDocument();
    expect(await screen.findByText("服务暂不可用")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByRole("button", { name: "成员 0" })).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(2);
  });
  it("keeps ordinary member overview read-only and ignores a previous scope's late reply", async () => {
    let resolveOld!: (value: OrganizationWorkspaceSummary) => void;
    const old = () => new Promise<OrganizationWorkspaceSummary>(resolve => { resolveOld = resolve; });
    const next = vi.fn().mockResolvedValue({ ...summary, organization: { ...summary.organization, name: "新组织" }, administration: null });
    const onNavigate = vi.fn();
    const view = render(<OrganizationOverviewPanel load={old} onNavigate={onNavigate} />);
    view.rerender(<OrganizationOverviewPanel load={next} onNavigate={onNavigate} />);
    expect(await screen.findByText("新组织")).toBeInTheDocument();
    resolveOld(summary);
    await waitFor(() => expect(screen.queryByText("目标组织")).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /成员/ })).not.toBeInTheDocument();
    expect(screen.queryByText("待同步身份")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "项目 3" }));
    expect(onNavigate).toHaveBeenCalledWith("/parameters");
  });
});
