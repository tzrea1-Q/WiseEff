import { useEffect, useState, type ReactNode } from "react";
import { AdminListPage } from "@/components/layout/AdminListPage";
import { SelectControl } from "@/components/common/SelectControl";
import { SectionEmpty, SectionError, SectionSkeleton } from "@/components/common/SectionState";
import { Badge } from "@/components/ui/badge";
import { roleLabels } from "@/UserPermissionsPage";
import { presentError } from "@/infrastructure/http/presentError";
import type { createUserGovernanceClient, ProjectMember } from "@/infrastructure/http/userGovernanceClient";
import type { ProjectMemberRoleId } from "@/infrastructure/http/userGovernanceClient";
import { Button } from "@/components/ui/button";
import { ModalDialog } from "@/components/common/ModalDialog";
import { MultiSelectDropdown } from "@/components/MultiSelectDropdown";
import { SettingsFormPage } from "@/components/layout/SettingsFormPage";
import { requestSettingsLeave } from "@/application/settingsFormNavigation";
import { OrganizationProjectBulkGrants } from "./OrganizationProjectBulkGrants";

export type ProjectMembershipClient = Pick<ReturnType<typeof createUserGovernanceClient>, "listProjectCandidates" | "getProjectMembers" | "listUsers" | "updateProjectMember" | "listTeams">;

export function OrganizationProjectsPanel({ client }: { client?: ProjectMembershipClient }) {
  const [projects, setProjects] = useState<Array<{ id: string; name: string }> | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [error, setError] = useState(""), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    setProjects(null); setError("");
    void client.listProjectCandidates().then((next) => {
      if (cancelled) return;
      setProjects(next); setSelectedId((id) => next.some((project) => project.id === id) ? id : next[0]?.id ?? "");
    }).catch((failure: unknown) => { if (!cancelled) setError(presentError(failure, "无法加载组织项目，请重试。")); });
    return () => { cancelled = true; };
  }, [client, attempt]);

  if (!client) return <SectionEmpty message="项目参与名单需要连接真实 API。" />;
  if (error) return <SectionError message={error} onRetry={() => setAttempt((value) => value + 1)} />;
  if (!projects) return <SectionSkeleton label="正在加载组织项目" />;
  if (!projects.length) return <SectionEmpty title="暂无项目" message="创建项目后可在此查看参与名单。" />;
  return <ProjectRoster key={selectedId} client={client} projectId={selectedId} projectName={projects.find((project) => project.id === selectedId)?.name ?? selectedId} projectSelector={
    <SelectControl ariaLabel="选择项目" value={selectedId} options={projects.map((project) => ({ value: project.id, label: project.name }))} onValueChange={setSelectedId} />
  } />;
}

function ProjectRoster({ client, projectId, projectName, projectSelector }: { client: ProjectMembershipClient; projectId: string; projectName: string; projectSelector: ReactNode }) {
  const [members, setMembers] = useState<ProjectMember[] | null>(null), [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [editing, setEditing] = useState(false), [userId, setUserId] = useState("");
  const [roles, setRoles] = useState<ProjectMemberRoleId[]>([]), [expectedRoles, setExpectedRoles] = useState<ProjectMemberRoleId[]>([]);
  const [users, setUsers] = useState<Awaited<ReturnType<ProjectMembershipClient["listUsers"]>>>([]);
  const [pending, setPending] = useState(false), [saveError, setSaveError] = useState("");
  const [bulk, setBulk] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setMembers(null); setError("");
    void client.getProjectMembers(projectId).then((next) => { if (!cancelled) setMembers(next.members); })
      .catch((failure: unknown) => { if (!cancelled) setError(presentError(failure, "无法加载项目参与名单，请重试。")); });
    return () => { cancelled = true; };
  }, [client, projectId, attempt]);
  async function edit(member?: ProjectMember) {
    setUserId(member?.userId ?? ""); setRoles(member?.roles ?? []); setExpectedRoles(member?.roles ?? []); setSaveError(""); setEditing(true);
    try { setUsers(await client.listUsers()); } catch (failure) { setSaveError(presentError(failure, "无法加载组织成员，请关闭后重试。")); }
  }
  async function save() {
    if (!userId || pending) return;
    setPending(true); setSaveError("");
    try { const result = await client.updateProjectMember(projectId, userId, { roles, expectedRoles }); setMembers(result.members); setEditing(false); }
    catch (failure) { setSaveError(presentError(failure, "项目参与角色保存失败，请重试。")); } finally { setPending(false); }
  }
  const dismiss = async () => { if (!pending && await requestSettingsLeave()) setEditing(false); };
  const roleOptions = (["hardware-user", "software-user", "hardware-committer", "software-committer"] as const).map((value) => ({ value, label: roleLabels[value] }));
  return <><AdminListPage label="项目参与" headerActions={<><Button variant="outline" disabled={members === null || Boolean(error)} onClick={() => setBulk(true)}>批量授予项目角色</Button><Button disabled={members === null || Boolean(error)} onClick={() => void edit()}>添加参与者</Button></>} headerContent="项目参与名单" filterBar={projectSelector}
    notice={<p>组织成员可查看项目；参与者按项目编辑角色修改，MDE 编辑角色可修改关键参数。组织和平台管理员可直接管理。审核与合入职责需单独配置。</p>}
    tableState={error ? <SectionError message={error} onRetry={() => setAttempt((value) => value + 1)} /> : members === null ? <SectionSkeleton label="正在加载项目参与名单" /> : undefined}
    table={{ rows: members ?? [], rowKey: (member) => member.userId, ariaLabel: "项目参与名单", columns: [
      { key: "name", header: "成员", render: (member) => member.name },
      { key: "username", header: "用户名", render: (member) => member.username ?? "未设置" },
      { key: "title", header: "职务", render: (member) => member.title || "未设置" },
      { key: "roles", header: "项目编辑角色", render: (member) => member.roles.map((role) => roleLabels[role]).join("、") },
      { key: "status", header: "账号状态", render: (member) => <Badge variant={member.isActive ? "secondary" : "outline"}>{member.isActive ? "已启用" : "已停用"}</Badge> }
    ] }} emptyState={{ title: "暂无项目参与者", message: "管理员仍可直接管理此项目。" }}
    rowActions={(member) => ({ label: `${member.name} 项目参与操作`, primaryAction: { id: "edit", label: "修改", ariaLabel: `修改 ${member.name} 的项目编辑角色`, onSelect: () => void edit(member) }, items: [] })} />
    <ModalDialog open={editing} className="user-permissions-modal-card member-details-card modal-card--md" onDismiss={() => void dismiss()}>{({ titleId }) => <>
      <h2 id={titleId}>配置项目参与者</h2><div className="member-details"><SettingsFormPage label="项目参与角色" dirty={JSON.stringify([...roles].sort()) !== JSON.stringify([...expectedRoles].sort())} saving={pending} saveDisabled={!userId || !roles.length && !expectedRoles.length} error={saveError}
        onSave={() => void save()} onDiscard={() => { setRoles(expectedRoles); setSaveError(""); }}>
        <SelectControl ariaLabel="选择参与成员" value={userId} disabled={pending || expectedRoles.length > 0} options={users.filter((user) => user.id === userId || !members?.some((member) => member.userId === user.id)).map((user) => ({ value: user.id, label: `${user.name}${user.isActive ? "" : "（已停用）"}` }))} onValueChange={setUserId} />
        <div inert={pending}><MultiSelectDropdown label="项目编辑角色" value={roles} options={roleOptions} onChange={(values) => setRoles(values as ProjectMemberRoleId[])} /></div>
        <p className="member-details__hint">清空角色并保存即可移除参与资格；保留账号、历史和独立的审核/合入职责。停用账号不会因此启用。</p>
        {expectedRoles.length > 0 && <Button type="button" variant="outline" disabled={pending} onClick={() => setRoles([])}>移除参与资格</Button>}
      </SettingsFormPage></div><div className="user-permissions-modal-actions"><Button variant="outline" disabled={pending} onClick={() => void dismiss()}>关闭</Button></div>
    </>}</ModalDialog>
    {bulk && <OrganizationProjectBulkGrants client={client} projectId={projectId} projectName={projectName} onUpdated={setMembers} onClose={() => setBulk(false)} />}</>;
}
