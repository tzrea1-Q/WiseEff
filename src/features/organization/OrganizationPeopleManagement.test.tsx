import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { createPrototypeState } from "@/mockData";
import { selectControlOption } from "@/test/selectControlOption";
import type { OrganizationTeamsClient } from "@/infrastructure/http/userGovernanceClient";
import type { OrganizationInvitationDto, OrganizationInvitationsClient } from "@/infrastructure/http/organizationInvitationsClient";
import { OrganizationTeamsPage } from "./OrganizationTeamsPage";
import { OrganizationInvitationsPage } from "./OrganizationInvitationsPage";

afterEach(cleanup);
const people = createPrototypeState().users.slice(0, 2);
const team = { id: "team", organizationId: "org", name: "研发团队", memberIds: [people[0].id] };
function teamsClient(): OrganizationTeamsClient {
  return { listTeams: vi.fn(async () => [team]), listUsers: vi.fn(async () => people), createTeam: vi.fn(async (name) => ({ ...team, name })),
    renameTeam: vi.fn(async (_id, name) => ({ ...team, name })), replaceTeamMembers: vi.fn(async (_id, memberIds) => ({ ...team, memberIds })), deleteTeam: vi.fn(async () => undefined) };
}
const invitation: OrganizationInvitationDto = { id: "invitation", organizationId: "org", label: "研发新人", roles: ["hardware-user"], status: "pending", expiresAt: "2027-01-01", createdAt: "2026-10-24", acceptedUserId: null, teams: [], projects: [] };
function invitationsClient(): OrganizationInvitationsClient {
  return { getAuthenticationConfig: vi.fn(async () => ({ provider: "local" })), listInvitations: vi.fn(async () => []), listTeams: vi.fn(async () => [team]), listProjectCandidates: vi.fn(async () => []),
    issueInvitation: vi.fn(async () => ({ item: invitation, token: "fixture-token" })), revokeInvitation: vi.fn(async () => ({ ...invitation, status: "revoked" as const })) };
}

it("offers one empty-team action and protects an unfinished creation with a fixed submit button", async () => {
  const client = teamsClient(); vi.mocked(client.listTeams).mockResolvedValue([]);
  render(<OrganizationTeamsPage client={client} />);
  await screen.findByText("还没有团队，可创建团队为成员分组。");
  expect(screen.getAllByRole("button", { name: "创建团队" })).toHaveLength(1);
  await userEvent.click(screen.getByRole("button", { name: "创建团队" }));
  const dialog = screen.getByRole("dialog", { name: "创建团队" });
  expect(within(dialog).getByRole("button", { name: "创建团队" })).toBeDisabled();
  await userEvent.type(within(dialog).getByLabelText("团队名称"), "新团队");
  expect(within(dialog).getByRole("button", { name: "创建团队" })).toBeEnabled();
  await userEvent.keyboard("{Escape}");
  await userEvent.click(within(screen.getByRole("dialog", { name: "放弃未保存的更改？" })).getByRole("button", { name: "继续编辑" }));
  expect(within(dialog).getByLabelText("团队名称")).toHaveValue("新团队");
  expect(client.createTeam).not.toHaveBeenCalled();
});

it("freezes the complete member picker during save and retains other team members", async () => {
  const client = teamsClient(); let resolve!: (value: typeof team) => void;
  vi.mocked(client.replaceTeamMembers).mockImplementation(() => new Promise((done) => { resolve = done; }));
  render(<OrganizationTeamsPage client={client} />);
  await userEvent.click(await screen.findByRole("button", { name: "管理 研发团队 的成员" }));
  const dialog = screen.getByRole("dialog", { name: "管理 研发团队 的成员" });
  await userEvent.click(within(dialog).getByRole("button", { name: /^选择团队成员/ }));
  await userEvent.click(screen.getByRole("checkbox", { name: `${people[1].name} · ${people[1].username ?? people[1].email ?? people[1].id}` }));
  await userEvent.keyboard("{Escape}");
  await userEvent.click(within(dialog).getByRole("button", { name: "保存团队成员" }));
  expect(within(dialog).getByRole("button", { name: /^选择团队成员/ })).toBeDisabled();
  expect(client.replaceTeamMembers).toHaveBeenCalledWith(team.id, people.map((person) => person.id));
  await act(async () => resolve({ ...team, memberIds: people.map((person) => person.id) }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
});

it("provides a way to join another team from an unassigned member context", async () => {
  render(<OrganizationTeamsPage client={teamsClient()} search={`?memberId=${people[1].id}`} />);
  await screen.findByText(`${people[1].name} 尚未加入匹配的团队，可显示全部团队后管理成员。`);
  await userEvent.click(screen.getByRole("button", { name: "显示全部团队" }));
  expect(screen.getByRole("table")).toHaveTextContent(team.name);
  expect(screen.getByRole("table")).toHaveTextContent("未加入");
  expect(screen.getByRole("button", { name: "管理 研发团队 的成员" })).toBeEnabled();
});

it("opens linked invitation creation with Chinese roles and freezes every preset while issuing", async () => {
  const client = invitationsClient(); let resolve!: (value: { item: OrganizationInvitationDto; token: string }) => void;
  vi.mocked(client.issueInvitation).mockImplementation(() => new Promise((done) => { resolve = done; }));
  render(<OrganizationInvitationsPage client={client} canGrantPlatformAdmin={false} onBack={vi.fn()} search="?create=1" />);
  const dialog = await screen.findByRole("dialog", { name: "创建邀请" });
  expect(within(dialog).getByRole("button", { name: "生成邀请链接" })).toBeDisabled();
  await userEvent.type(within(dialog).getByLabelText("邀请备注"), "新人加入");
  await userEvent.click(within(dialog).getByRole("button", { name: /^组织角色/ }));
  expect(screen.getByRole("checkbox", { name: "硬件开发" })).toBeChecked();
  expect(screen.queryByText("Hardware User")).not.toBeInTheDocument();
  await userEvent.keyboard("{Escape}");
  await userEvent.click(within(dialog).getByRole("button", { name: "生成邀请链接" }));
  for (const label of [/^组织角色/, /^预设团队/, /^预设项目/]) expect(within(dialog).getByRole("button", { name: label })).toBeDisabled();
  await act(async () => resolve({ item: invitation, token: "fixture-token" }));
  expect(await screen.findByRole("dialog", { name: "邀请链接已生成" })).toBeInTheDocument();
});

it("filters invitations from the overview link and opens the accepted member", async () => {
  const client = invitationsClient(); const onViewMember = vi.fn();
  vi.mocked(client.listInvitations).mockResolvedValue([invitation, { ...invitation, id: "accepted", label: "已入组新人", status: "accepted", acceptedUserId: "person" }]);
  render(<OrganizationInvitationsPage client={client} canGrantPlatformAdmin={false} onBack={vi.fn()} onViewMember={onViewMember} search="?status=pending" />);
  await screen.findByText(invitation.label);
  expect(screen.queryByText("已入组新人")).not.toBeInTheDocument();
  await selectControlOption(screen.getByRole("combobox", { name: "邀请状态" }), "accepted");
  await userEvent.click(screen.getByRole("button", { name: "查看接受人" }));
  expect(onViewMember).toHaveBeenCalledWith("person");
});

it("keeps read-only teams and invitations free of write actions", async () => {
  const teamsView = render(<OrganizationTeamsPage client={teamsClient()} readOnly />);
  await screen.findByText(team.name);
  expect(screen.queryByRole("button", { name: /创建团队|管理.*的成员|更多/ })).not.toBeInTheDocument();
  teamsView.unmount();
  render(<OrganizationInvitationsPage client={invitationsClient()} readOnly canGrantPlatformAdmin={false} onBack={vi.fn()} search="?create=1" />);
  await screen.findByText("暂无邀请。");
  expect(screen.queryByRole("button", { name: "创建邀请" })).not.toBeInTheDocument();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
