import { useEffect, useId, useState, type ReactNode } from "react";
import { AdminListPage } from "@/components/layout/AdminListPage";
import { SelectControl } from "@/components/common/SelectControl";
import { SearchableSelectControl } from "@/components/common/SearchableSelectControl";
import { SearchField } from "@/components/common/SearchField";
import { SectionEmpty, SectionError, SectionSkeleton } from "@/components/common/SectionState";
import { Badge } from "@/components/ui/badge";
import { roleLabels } from "@/UserPermissionsPage";
import { presentError } from "@/infrastructure/http/presentError";
import type { createUserGovernanceClient, ProjectMember } from "@/infrastructure/http/userGovernanceClient";
import type { ProjectMemberRoleId } from "@/infrastructure/http/userGovernanceClient";
import { Button } from "@/components/ui/button";
import { ModalDialog } from "@/components/common/ModalDialog";
import { MultiSelectDropdown } from "@/components/MultiSelectDropdown";
import { SettingsLeaveGuard } from "@/components/layout/SettingsFormPage";
import { requestSettingsLeave } from "@/application/settingsFormNavigation";
import { OrganizationProjectBulkGrants } from "./OrganizationProjectBulkGrants";

export type ProjectMembershipClient = Pick<ReturnType<typeof createUserGovernanceClient>, "listProjectCandidates" | "getProjectMembers" | "listUsers" | "updateProjectMember" | "listTeams">;

export function OrganizationProjectsPanel({ client, search = "", onNavigate, organizationId, readOnly = false }: {
  client?: ProjectMembershipClient; search?: string; onNavigate?: (path: string) => void; organizationId?: string; readOnly?: boolean;
}) {
  const [projects, setProjects] = useState<Array<{ id: string; name: string }> | null>(null);
  const [selectedId, setSelectedId] = useState(() => new URLSearchParams(search).get("projectId") ?? "");
  const [error, setError] = useState(""), [attempt, setAttempt] = useState(0);
  const requestedId = new URLSearchParams(search).get("projectId");
  useEffect(() => {
    if (projects) setSelectedId(projects.some(project => project.id === requestedId) ? requestedId! : projects[0]?.id ?? "");
  }, [projects, requestedId, search]);
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
  if (!projects.length) return <SectionEmpty title="暂无项目" message="创建项目后可在此管理项目编辑角色。" actionLabel={!readOnly && onNavigate ? "前往项目管理" : undefined} onAction={() => onNavigate?.(`/parameter-admin/projects${organizationId ? `?organizationId=${encodeURIComponent(organizationId)}` : ""}`)} />;
  return <ProjectRoster key={selectedId} client={client} projectId={selectedId} readOnly={readOnly} projectName={projects.find((project) => project.id === selectedId)?.name ?? selectedId} projectSelector={
    <SearchableSelectControl id="organization-project-selector" ariaLabel="选择项目" value={selectedId} options={projects.map((project) => ({ value: project.id, label: project.name }))} onValueChange={id => {
      setSelectedId(id);
      const params = new URLSearchParams(search); params.set("projectId", id);
      if (organizationId) params.set("organizationId", organizationId);
      onNavigate?.(`/organization/projects?${params.toString()}`);
    }} />
  } />;
}

function ProjectRoster({ client, projectId, projectName, projectSelector, readOnly }: { client: ProjectMembershipClient; projectId: string; projectName: string; projectSelector: ReactNode; readOnly: boolean }) {
  const [members, setMembers] = useState<ProjectMember[] | null>(null), [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [editing, setEditing] = useState(false), [userId, setUserId] = useState("");
  const [roles, setRoles] = useState<ProjectMemberRoleId[]>([]), [expectedRoles, setExpectedRoles] = useState<ProjectMemberRoleId[]>([]);
  const [users, setUsers] = useState<Awaited<ReturnType<ProjectMembershipClient["listUsers"]>>>([]);
  const [pending, setPending] = useState(false), [saveError, setSaveError] = useState("");
  const [bulk, setBulk] = useState(false);
  const [loadingUsers, setLoadingUsers] = useState(false), [query, setQuery] = useState(""), [statusFilter, setStatusFilter] = useState("all");
  const participantFormId = useId(), participantId = useId();
  useEffect(() => { if (readOnly) { setEditing(false); setBulk(false); } }, [readOnly]);
  useEffect(() => {
    let cancelled = false;
    setMembers(null); setError("");
    void client.getProjectMembers(projectId).then((next) => { if (!cancelled) setMembers(next.members); })
      .catch((failure: unknown) => { if (!cancelled) setError(presentError(failure, "无法加载项目参与名单，请重试。")); });
    return () => { cancelled = true; };
  }, [client, projectId, attempt]);
  async function edit(member?: ProjectMember) {
    if (readOnly) return;
    setUserId(member?.userId ?? ""); setRoles(member?.roles ?? []); setExpectedRoles(member?.roles ?? []); setSaveError(""); setEditing(true);
    setUsers([]); setLoadingUsers(!member);
    if (member) return;
    try { setUsers(await client.listUsers()); } catch (failure) { setSaveError(presentError(failure, "无法加载组织成员，请关闭后重试。")); } finally { setLoadingUsers(false); }
  }
  async function save() {
    if (!userId || pending || readOnly || loadingUsers || !expectedRoles.length && !roles.length) return;
    setPending(true); setSaveError("");
    try { const result = await client.updateProjectMember(projectId, userId, { roles, expectedRoles }); setMembers(result.members); setEditing(false); }
    catch (failure) { setSaveError(presentError(failure, "项目参与角色保存失败，请重试。")); } finally { setPending(false); }
  }
  const dismiss = async () => { if (!pending && await requestSettingsLeave()) setEditing(false); };
  const roleOptions = (["hardware-user", "software-user", "hardware-committer", "software-committer"] as const).map((value) => ({ value, label: roleLabels[value] }));
  const adding = expectedRoles.length === 0;
  const dirty = JSON.stringify([...roles].sort()) !== JSON.stringify([...expectedRoles].sort()) || adding && Boolean(userId);
  return <><AdminListPage label="项目参与" headerActions={readOnly ? null : <><Button variant="outline" disabled={members === null || Boolean(error)} onClick={() => setBulk(true)}>批量授予项目角色</Button><Button disabled={members === null || Boolean(error)} onClick={() => void edit()}>添加参与者</Button></>} headerContent="项目参与名单" filterBar={<div className="flex flex-wrap items-end gap-3">{projectSelector}
    <SearchField ariaLabel="搜索项目参与者" placeholder="搜索姓名、用户名或职务" value={query} onValueChange={setQuery} />
    <SelectControl ariaLabel="筛选参与者账号状态" value={statusFilter} onValueChange={setStatusFilter} options={[{ value: "all", label: "全部账号" }, { value: "active", label: "已启用" }, { value: "inactive", label: "已停用" }]} /></div>}
    notice={<p>{readOnly ? "当前组织仅可查看。" : "项目编辑角色控制参数修改；审核与合入职责单独配置。"}</p>}
    tableState={error ? <SectionError message={error} onRetry={() => setAttempt((value) => value + 1)} /> : members === null ? <SectionSkeleton label="正在加载项目参与名单" /> : undefined}
    table={{ rows: (members ?? []).filter(member => `${member.name} ${member.username ?? ""} ${member.title}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()) && (statusFilter === "all" || member.isActive === (statusFilter === "active"))), rowKey: (member) => member.userId, ariaLabel: "项目参与名单", columns: [
      { key: "name", header: "成员", render: (member) => member.name },
      { key: "username", header: "用户名", render: (member) => member.username ?? "未设置" },
      { key: "title", header: "职务", render: (member) => member.title || "未设置" },
      { key: "roles", header: "项目编辑角色", render: (member) => member.roles.map((role) => roleLabels[role]).join("、") },
      { key: "status", header: "账号状态", render: (member) => <Badge variant={member.isActive ? "secondary" : "outline"}>{member.isActive ? "已启用" : "已停用"}</Badge> }
    ] }} emptyState={{ title: query || statusFilter !== "all" ? "没有匹配的参与者" : "暂无项目参与者", message: query || statusFilter !== "all" ? "请调整搜索或账号状态。" : "组织成员仍可查看项目，管理员可直接管理。" }}
    rowActions={readOnly ? undefined : (member) => ({ label: `${member.name} 项目参与操作`, primaryAction: { id: "edit", label: "修改", ariaLabel: `修改 ${member.name} 的项目编辑角色`, onSelect: () => void edit(member) }, items: [] })} />
    <ModalDialog open={editing && !readOnly} className="user-permissions-modal-card member-details-card modal-card--md" onDismiss={() => void dismiss()}>{({ titleId }) => <>
      <h2 id={titleId}>配置项目参与者</h2><p>项目：{projectName}</p><div className="member-details"><form id={participantFormId} aria-label="项目参与角色" className="settings-form-page" aria-busy={pending} onSubmit={event => { event.preventDefault(); void save(); }}>
        {adding ? <label htmlFor={participantId}>参与成员</label> : <span>参与成员</span>}
        {adding ? <SearchableSelectControl id={participantId} ariaLabel="选择参与成员" value={userId} disabled={pending || loadingUsers} options={[{ value: "", label: loadingUsers ? "正在加载成员…" : "请选择参与成员" }, ...users.filter((user) => !members?.some((member) => member.userId === user.id)).map((user) => ({ value: user.id, label: `${user.name}${user.isActive ? "" : "（已停用）"}` }))]} onValueChange={setUserId} /> : <p id={participantId}>{members?.find(member => member.userId === userId)?.name ?? userId}</p>}
        <MultiSelectDropdown label="项目编辑角色" value={roles} options={roleOptions} disabled={pending || readOnly} onChange={(values) => setRoles(values as ProjectMemberRoleId[])} />
        <p className="member-details__hint">{adding ? "选择成员并分配项目编辑角色；审核与合入职责不随本次分配改变。" : "移除项目编辑角色不会删除账号、历史或独立的审核与合入职责。"}</p>
        {!adding && <Button type="button" variant="outline" disabled={pending} onClick={() => setRoles([])}>移除项目编辑角色</Button>}
        {saveError ? <div role="alert" aria-label="保存错误摘要"><strong>保存失败</strong><p>{saveError}</p></div> : null}
      </form></div><div className="user-permissions-modal-actions">{!adding && dirty ? <Button variant="outline" disabled={pending} onClick={() => { setRoles(expectedRoles); setSaveError(""); }}>放弃</Button> : null}<Button variant="outline" disabled={pending} onClick={() => void dismiss()}>关闭</Button>
        {adding || dirty ? <Button type="submit" form={participantFormId} disabled={pending || loadingUsers || !userId || adding && !roles.length}>{pending ? "保存中…" : adding ? "添加参与者" : "保存"}</Button> : null}
      </div><SettingsLeaveGuard dirty={editing && !readOnly && dirty} saving={pending} />
    </>}</ModalDialog>
    {bulk && !readOnly && <OrganizationProjectBulkGrants client={client} projectId={projectId} projectName={projectName} onUpdated={setMembers} onClose={() => setBulk(false)} />}</>;
}
