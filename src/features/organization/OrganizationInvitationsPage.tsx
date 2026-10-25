import { useCallback, useEffect, useRef, useState } from "react";
import { AdminListPage } from "@/components/layout/AdminListPage";
import { SettingsLeaveGuard } from "@/components/layout/SettingsFormPage";
import { requestSettingsLeave } from "@/application/settingsFormNavigation";
import { ModalDialog } from "@/components/common/ModalDialog";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { SectionEmpty, SectionError, SectionSkeleton } from "@/components/common/SectionState";
import { MultiSelectDropdown } from "@/components/MultiSelectDropdown";
import { Button } from "@/components/ui/button";
import { SearchField } from "@/components/common/SearchField";
import { SelectControl } from "@/components/common/SelectControl";
import { roleLabels } from "@/UserPermissionsPage";
import { platformRoles, type PlatformRoleId } from "@/domain/users/types";
import { formatAbsolute } from "@/domain/format/formatDateTime";
import { presentError } from "@/infrastructure/http/presentError";
import type { InvitationProjectPreset, OrganizationInvitationDto, OrganizationInvitationsClient } from "@/infrastructure/http/organizationInvitationsClient";

const statusNames = { pending: "待接受", expired: "已过期", revoked: "已撤销", accepted: "已接受" };
export function OrganizationInvitationsPage({ client, canGrantPlatformAdmin, onBack, onViewMember, readOnly = false, search = "" }: { client?: OrganizationInvitationsClient; canGrantPlatformAdmin: boolean; onBack(): void; onViewMember?: (userId: string) => void; readOnly?: boolean; search?: string }) {
  const [invitations, setInvitations] = useState<OrganizationInvitationDto[]>([]), [status, setStatus] = useState<"loading" | "ready" | "error" | "external">("loading"), [attempt, setAttempt] = useState(0), [loadError, setLoadError] = useState("");
  const [editing, setEditing] = useState<{ item?: OrganizationInvitationDto } | null>(null), [label, setLabel] = useState(""), [roles, setRoles] = useState<PlatformRoleId[]>(["hardware-user"]), [days, setDays] = useState(7);
  const [teams, setTeams] = useState<Array<{ id: string; name: string }>>([]), [projectChoices, setProjectChoices] = useState<Array<{ id: string; name: string }>>([]);
  const [teamIds, setTeamIds] = useState<string[]>([]), [projects, setProjects] = useState<InvitationProjectPreset[]>([]);
  const [pending, setPending] = useState(false), [error, setError] = useState(""), [revoking, setRevoking] = useState<OrganizationInvitationDto | null>(null), [link, setLink] = useState(""), [copied, setCopied] = useState(false);
  const [query, setQuery] = useState(""), [statusFilter, setStatusFilter] = useState(() => new URLSearchParams(search).get("status") ?? "all");
  const openedFromLink = useRef(false);
  useEffect(() => { const value = new URLSearchParams(search).get("status"); setStatusFilter(value && value in statusNames ? value : "all"); }, [search]);
  useEffect(() => {
    if (!client) return;
    let cancelled = false; setStatus("loading"); setLoadError("");
    void client.getAuthenticationConfig().then(async (config) => {
      if (cancelled) return;
      if (config.provider !== "local") { setStatus("external"); return; }
      const [items, nextTeams, nextProjects] = await Promise.all([client.listInvitations(), client.listTeams(), client.listProjectCandidates()]);
      if (!cancelled) { setInvitations(items); setTeams(nextTeams); setProjectChoices(nextProjects); setStatus("ready"); }
    }).catch((failure: unknown) => { if (!cancelled) { setLoadError(presentError(failure, "邀请列表加载失败。")); setStatus("error"); } });
    return () => { cancelled = true; };
  }, [client, attempt]);
  const reset = useCallback((item?: OrganizationInvitationDto) => { setLabel(item?.label ?? ""); setRoles(item?.roles ?? ["hardware-user"]); setTeamIds(item?.teams.map((team) => team.id) ?? []); setProjects(item?.projects.map(({ projectId, roles: projectRoles }) => ({ projectId, roles: projectRoles })) ?? []); setDays(7); setError(""); }, []);
  useEffect(() => {
    if (new URLSearchParams(search).get("create") !== "1") { openedFromLink.current = false; return; }
    if (!readOnly && status === "ready" && !openedFromLink.current) { openedFromLink.current = true; reset(); setEditing({}); }
  }, [search, readOnly, status, reset]);
  const start = (item?: OrganizationInvitationDto) => { if (!readOnly) { setEditing({ item }); reset(item); } };
  const dismiss = async () => { if (!pending && await requestSettingsLeave()) { setEditing(null); setError(""); } };
  const dirty = Boolean(editing && (label !== (editing.item?.label ?? "") || roles.join() !== (editing.item?.roles ?? ["hardware-user"]).join() || days !== 7 ||
    [...teamIds].sort().join() !== (editing.item?.teams.map((team) => team.id).sort() ?? []).join() ||
    JSON.stringify(projects) !== JSON.stringify(editing.item?.projects.map(({ projectId, roles: projectRoles }) => ({ projectId, roles: projectRoles })) ?? [])));
  const projectName = (id: string) => projectChoices.find((item) => item.id === id)?.name ?? editing?.item?.projects.find((item) => item.projectId === id)?.name ?? id;
  async function save() {
    if (!client || !editing || pending || readOnly) return;
    if (!label.trim() || !roles.length || !Number.isInteger(days) || days < 1 || days > 30) { setError("请填写邀请备注、至少一个角色及 1–30 天有效期。"); return; }
    if (projects.some((project) => !project.roles.length)) { setError("请为每个预设项目选择至少一个参与角色。"); return; }
    setPending(true); setError("");
    try {
      const result = await client.issueInvitation({ label: label.trim(), roles, expiresInDays: days, teamIds, projects }, editing.item?.id);
      setInvitations((current) => [result.item, ...current.filter((item) => item.id !== result.item.id)]); setEditing(null); setCopied(false);
      setLink(`${window.location.origin}/invite#${result.token}`);
    } catch (failure) { setError(presentError(failure, "邀请生成失败，请重试。")); } finally { setPending(false); }
  }
  async function revoke() {
    if (!client || !revoking || pending || readOnly) return;
    setPending(true); setError("");
    try { const item = await client.revokeInvitation(revoking.id); setInvitations((current) => current.map((old) => old.id === item.id ? item : old)); setRevoking(null); }
    catch (failure) { setError(presentError(failure, "撤销失败，请重试。")); } finally { setPending(false); }
  }
  if (!client) return <SectionEmpty message="邀请管理需要 API 连接。" />;
  if (status === "external") return <SectionEmpty message="当前使用外部身份认证，请在成员管理中直接绑定身份。密码邀请仅适用于本地账号。" actionLabel="返回成员管理" onAction={onBack} />;
  const title = editing?.item ? "修改并重新生成邀请" : "创建邀请";
  const valid = Boolean(label.trim() && roles.length && Number.isInteger(days) && days >= 1 && days <= 30 && projects.every((project) => project.roles.length > 0));
  const needle = query.trim().toLocaleLowerCase();
  const visibleInvitations = invitations.filter((item) => (statusFilter === "all" || item.status === statusFilter) &&
    [item.label, ...item.teams.map((team) => team.name), ...item.projects.map((project) => project.name)].some((value) => value.toLocaleLowerCase().includes(needle)));
  return <section className="user-permissions-page" aria-label="邀请管理">
    <AdminListPage label="成员邀请" headerContent={false} headerActions={<><Button variant="outline" disabled={pending || status === "loading"} onClick={() => setAttempt((value) => value + 1)}>刷新</Button>{!readOnly && invitations.length > 0 ? <Button disabled={status !== "ready"} onClick={() => start()}>创建邀请</Button> : null}</>} filterBar={invitations.length > 0 ? <>
      <SearchField value={query} onValueChange={setQuery} ariaLabel="搜索邀请" placeholder="搜索备注、团队或项目" />
      <SelectControl ariaLabel="邀请状态" value={statusFilter} onValueChange={setStatusFilter} options={[{ value: "all", label: "全部状态" }, ...Object.entries(statusNames).map(([value, label]) => ({ value, label }))]} />
    </> : null}
      notice={<p className="member-details__hint">受邀人通过一次性链接加入，接受后预设权限立即生效。</p>}
      tableState={status === "loading" ? <SectionSkeleton label="正在加载邀请" /> : status === "error" ? <SectionError message={loadError} onRetry={() => setAttempt((value) => value + 1)} /> : undefined}
      table={{ ariaLabel: "成员邀请", rows: visibleInvitations, rowKey: (item) => item.id, columns: [
        { key: "label", header: "备注", render: (item) => <strong>{item.label}</strong> },
        { key: "roles", header: "预设权限与分组", render: (item) => <><div>组织角色：{item.roles.map((role) => roleLabels[role]).join("、")}</div>{item.teams.length ? <div className="member-list-meta">团队：{item.teams.map((team) => team.name).join("、")}</div> : null}{item.projects.map((project) => <div className="member-list-meta" key={project.projectId}>{project.name} · 编辑角色：{project.roles.map((role) => roleLabels[role]).join("、")}</div>)}</> },
        { key: "status", header: "状态", render: (item) => statusNames[item.status] },
        { key: "expires", header: "有效期至", render: (item) => formatAbsolute(item.expiresAt) }
      ] }} emptyState={{ message: invitations.length ? "没有匹配的邀请。" : "暂无邀请。", actionLabel: invitations.length ? "清除筛选" : readOnly ? undefined : "创建邀请", onAction: invitations.length ? () => { setQuery(""); setStatusFilter("all"); } : readOnly ? undefined : () => start() }}
      rowActions={(item) => item.status === "accepted" ? { label: `${item.label} 操作`, primaryAction: item.acceptedUserId && onViewMember ? { id: "member", label: "查看接受人", onSelect: () => onViewMember(item.acceptedUserId!) } : undefined, items: [] } : { label: `${item.label} 操作`, primaryAction: !readOnly ? { id: "regenerate", label: "重新生成", onSelect: () => start(item) } : undefined, items: readOnly || item.status === "revoked" ? [] : [{ id: "revoke", label: "撤销", destructive: true, onRequestConfirmation: () => { setRevoking(item); setError(""); } }] }} />
    <ModalDialog open={Boolean(editing)} className="user-permissions-modal-card member-details-card modal-card--md" onDismiss={() => void dismiss()}>{({ titleId }) => <>
      <h2 id={titleId}>{title}</h2><form id="organization-invitation-editor" className="member-details modal-body" aria-label={title} aria-busy={pending} onSubmit={(event) => { event.preventDefault(); void save(); }}><fieldset className="user-permissions-modal-fields" disabled={pending || readOnly}>
        {editing?.item ? <p className="member-details__hint">保存后旧链接立即失效，请交付新链接。</p> : null}
        {status === "error" ? <p role="alert">{loadError}</p> : null}
        <label className="user-permissions-modal-field"><span>邀请备注</span><input className="user-permissions-modal-control" required maxLength={120} value={label} disabled={pending} onChange={(event) => setLabel(event.target.value)} /></label>
        <MultiSelectDropdown label="组织角色" value={roles} disabled={pending || readOnly} options={platformRoles.filter((role) => canGrantPlatformAdmin || role.id !== "platform-admin").map((role) => ({ value: role.id, label: roleLabels[role.id] }))} onChange={(values) => setRoles(values as PlatformRoleId[])} />
        <MultiSelectDropdown label="预设团队" value={teamIds} disabled={pending || readOnly} searchable options={[...teams.map((team) => ({ value: team.id, label: team.name })), ...(editing?.item?.teams ?? []).filter((team) => !teams.some((choice) => choice.id === team.id)).map((team) => ({ value: team.id, label: `${team.name}（已不可用，请移除）` }))]} onChange={setTeamIds} />
        <MultiSelectDropdown label="预设项目" value={projects.map((project) => project.projectId)} disabled={pending || readOnly} searchable options={[...projectChoices.map((project) => ({ value: project.id, label: project.name })), ...projects.filter((project) => !projectChoices.some((choice) => choice.id === project.projectId)).map((project) => ({ value: project.projectId, label: `${projectName(project.projectId)}（已不可用，请移除）` }))]} onChange={(ids) => setProjects(ids.map((projectId) => projects.find((project) => project.projectId === projectId) ?? { projectId, roles: ["software-user"] }))} />
        {projects.map((project) => <div className="member-details__section" key={project.projectId}><MultiSelectDropdown label={`${projectName(project.projectId)} 的项目编辑角色`} value={project.roles} disabled={pending || readOnly} options={platformRoles.filter((role) => role.level === "user" || role.level === "committer").map((role) => ({ value: role.id, label: roleLabels[role.id] }))} onChange={(values) => setProjects((current) => current.map((item) => item.projectId === project.projectId ? { ...item, roles: values as InvitationProjectPreset["roles"] } : item))} /></div>)}
        <p className="member-details__hint">团队仅用于分组；项目参与角色单独授予，不包含审核或合入职责。预设目标失效时须修正并重新生成邀请。</p>
        <Button variant="ghost" type="button" disabled={pending || status === "loading"} onClick={() => setAttempt((value) => value + 1)}>刷新可选团队和项目</Button>
        <label className="user-permissions-modal-field"><span>有效天数</span><input type="number" className="user-permissions-modal-control" required min={1} max={30} value={days} disabled={pending} onChange={(event) => setDays(Number(event.target.value))} /></label>
      </fieldset>{error ? <p role="alert">{error}</p> : null}</form><div className="user-permissions-modal-actions"><Button variant="outline" disabled={pending} onClick={() => { setEditing(null); setError(""); }}>取消</Button><Button form="organization-invitation-editor" type="submit" disabled={pending || readOnly || !valid}>{pending ? "生成中…" : editing?.item ? "重新生成邀请链接" : "生成邀请链接"}</Button></div><SettingsLeaveGuard dirty={Boolean(editing) && dirty} saving={pending} />
    </>}</ModalDialog>
    <ModalDialog open={Boolean(link)} className="user-permissions-modal-card member-details-card modal-card--md" onDismiss={() => { setLink(""); setError(""); }}>{({ titleId }) => <>
      <h2 id={titleId}>邀请链接已生成</h2><div className="member-details"><p className="member-details__hint">请复制后交给受邀人。关闭后无法再次查看，可重新生成新链接。</p>
      <label className="user-permissions-modal-field"><span>一次性邀请链接</span><input className="user-permissions-modal-control" readOnly value={link} onFocus={(event) => event.target.select()} /></label>
      {error ? <p role="alert">{error}</p> : null}{copied ? <p role="status">邀请链接已复制。</p> : null}</div>
      <div className="user-permissions-modal-actions"><Button variant="outline" onClick={() => { setLink(""); setError(""); }}>关闭</Button><Button onClick={() => void navigator.clipboard.writeText(link).then(() => setCopied(true)).catch(() => setError("自动复制失败，请选中链接手动复制。"))}>复制链接</Button></div>
    </>}</ModalDialog>
    <ConfirmDialog open={Boolean(revoking)} title="撤销邀请？" description={`撤销「${revoking?.label ?? ""}」后，原链接立即失效。`} confirmLabel="撤销邀请" tone="danger" pending={pending} error={error} onCancel={() => { if (!pending) { setRevoking(null); setError(""); } }} onConfirm={() => void revoke()} />
  </section>;
}
