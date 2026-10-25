import { useEffect, useState } from "react";
import { AdminListPage } from "@/components/layout/AdminListPage";
import { SettingsLeaveGuard } from "@/components/layout/SettingsFormPage";
import { requestSettingsLeave } from "@/application/settingsFormNavigation";
import { ModalDialog } from "@/components/common/ModalDialog";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { SectionEmpty, SectionError, SectionSkeleton } from "@/components/common/SectionState";
import { MultiSelectDropdown } from "@/components/MultiSelectDropdown";
import { Button } from "@/components/ui/button";
import { SearchField } from "@/components/common/SearchField";
import { Badge } from "@/components/ui/badge";
import { presentError } from "@/infrastructure/http/presentError";
import type { OrganizationTeamDto, OrganizationTeamsClient } from "@/infrastructure/http/userGovernanceClient";

export function OrganizationTeamsPage({ client, readOnly = false, search = "" }: { client?: OrganizationTeamsClient; readOnly?: boolean; search?: string }) {
  const [teams, setTeams] = useState<OrganizationTeamDto[]>([]), [users, setUsers] = useState<Awaited<ReturnType<OrganizationTeamsClient["listUsers"]>>>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading"), [loadError, setLoadError] = useState(""), [attempt, setAttempt] = useState(0);
  const [editing, setEditing] = useState<{ kind: "create" | "rename" | "members"; team?: OrganizationTeamDto } | null>(null);
  const [name, setName] = useState(""), [memberIds, setMemberIds] = useState<string[]>([]), [pending, setPending] = useState(false), [error, setError] = useState("");
  const [deleting, setDeleting] = useState<OrganizationTeamDto | null>(null);
  const [query, setQuery] = useState("");
  const memberId = new URLSearchParams(search).get("memberId");
  const [onlyMemberTeams, setOnlyMemberTeams] = useState(Boolean(memberId));
  const member = users.find((user) => user.id === memberId);
  useEffect(() => { setOnlyMemberTeams(Boolean(memberId)); }, [memberId]);
  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    setStatus("loading"); setLoadError("");
    void Promise.all([client.listTeams(), client.listUsers()]).then(([nextTeams, nextUsers]) => {
      if (!cancelled) { setTeams(nextTeams); setUsers(nextUsers); setStatus("ready"); }
    }).catch((failure: unknown) => { if (!cancelled) { setLoadError(presentError(failure, "团队加载失败，请重试。")); setStatus("error"); } });
    return () => { cancelled = true; };
  }, [client, attempt]);
  if (!client) return <SectionEmpty message="团队管理需要 API 连接。" />;

  const start = (kind: "create" | "rename" | "members", team?: OrganizationTeamDto) => {
    if (readOnly) return;
    setEditing({ kind, team }); setName(kind === "create" ? "" : team?.name ?? ""); setMemberIds(team?.memberIds ?? []); setError("");
  };
  const dismiss = async () => { if (!pending && await requestSettingsLeave()) { setEditing(null); setError(""); } };
  const dirty = editing?.kind === "members" ? [...memberIds].sort().join("\n") !== [...(editing.team?.memberIds ?? [])].sort().join("\n") : name !== (editing?.kind === "create" ? "" : editing?.team?.name ?? "");
  async function save() {
    if (!client || !editing || pending || readOnly) return;
    if (editing.kind !== "members" && !name.trim()) { setError("团队名称不能为空。"); return; }
    setPending(true); setError("");
    try {
      const item = editing.kind === "members" ? await client.replaceTeamMembers(editing.team!.id, memberIds)
        : editing.kind === "rename" ? await client.renameTeam(editing.team!.id, name.trim()) : await client.createTeam(name.trim());
      setTeams((current) => [...current.filter((team) => team.id !== item.id), item].sort((a, b) => a.name.localeCompare(b.name, "zh-CN")));
      setEditing(null);
    } catch (failure) { setError(presentError(failure, "团队保存失败，请重试。")); } finally { setPending(false); }
  }
  async function remove() {
    if (!client || !deleting || pending || readOnly) return;
    setPending(true); setError("");
    try { await client.deleteTeam(deleting.id); setTeams((current) => current.filter((team) => team.id !== deleting.id)); setDeleting(null); }
    catch (failure) { setError(presentError(failure, "团队删除失败，请重试。")); } finally { setPending(false); }
  }
  const title = editing?.kind === "members" ? `管理 ${editing.team?.name} 的成员` : editing?.kind === "rename" ? "修改团队名称" : "创建团队";
  const names = (team: OrganizationTeamDto) => team.memberIds.map((id) => users.find((user) => user.id === id)?.name ?? id);
  const needle = query.trim().toLocaleLowerCase();
  const visibleTeams = teams.filter((team) => (!memberId || !onlyMemberTeams || team.memberIds.includes(memberId)) &&
    [team.name, ...team.memberIds.flatMap((id) => { const user = users.find((item) => item.id === id); return user ? [user.name, user.username ?? user.email ?? ""] : [id]; })].some((value) => value.toLocaleLowerCase().includes(needle)));
  return <section className="user-permissions-page" aria-label="团队管理">
    <AdminListPage label="组织团队" headerContent={false} headerActions={!readOnly && teams.length > 0 ? <Button onClick={() => start("create")}>创建团队</Button> : null} filterBar={teams.length > 0 ? <>
      <SearchField value={query} onValueChange={setQuery} ariaLabel="搜索团队" placeholder="搜索团队、成员姓名或账号" />
      {memberId ? <label><input type="checkbox" checked={onlyMemberTeams} onChange={(event) => setOnlyMemberTeams(event.target.checked)} />仅看 {member?.name ?? "该成员"} 已加入的团队</label> : null}
    </> : null}
      notice={<p className="member-details__hint">团队用于成员分组；加入或离开团队不会改变项目权限。</p>}
      tableState={status === "loading" ? <SectionSkeleton label="正在加载团队" /> : status === "error" ? <SectionError message={loadError} onRetry={() => setAttempt((value) => value + 1)} /> : undefined}
      table={{ ariaLabel: "组织团队", rows: visibleTeams, rowKey: (team) => team.id, columns: [
        { key: "name", header: "团队名称", render: (team) => <><strong>{team.name}</strong>{memberId ? <Badge variant="outline">{team.memberIds.includes(memberId) ? "已加入" : "未加入"}</Badge> : null}</> },
        { key: "members", header: "成员", render: (team) => team.memberIds.length ? `${names(team).slice(0, 3).join("、")}${team.memberIds.length > 3 ? " 等" : " ·"} ${team.memberIds.length} 人` : <span className="member-list-meta">暂无成员</span> }
      ] }}
      emptyState={{ message: teams.length === 0 ? "还没有团队，可创建团队为成员分组。" : memberId && onlyMemberTeams ? `${member?.name ?? "该成员"} 尚未加入匹配的团队，可显示全部团队后管理成员。` : "没有匹配的团队。", actionLabel: teams.length === 0 ? (readOnly ? undefined : "创建团队") : "显示全部团队", onAction: teams.length === 0 ? (readOnly ? undefined : () => start("create")) : () => { setQuery(""); setOnlyMemberTeams(false); } }}
      rowActions={readOnly ? undefined : (team) => ({ label: `${team.name} 操作`, primaryAction: { id: "members", label: "管理成员", ariaLabel: `管理 ${team.name} 的成员`, onSelect: () => start("members", team) }, items: [
        { id: "rename", label: "改名", onSelect: () => start("rename", team) },
        { id: "delete", label: "删除", destructive: true, onRequestConfirmation: () => { setDeleting(team); setError(""); } }
      ] })} />
    <ModalDialog open={Boolean(editing)} className="user-permissions-modal-card modal-card--md" onDismiss={() => void dismiss()}>{({ titleId }) => <>
      <h2 id={titleId}>{title}</h2>
      <form id="organization-team-editor" className="modal-body" aria-label={title} aria-busy={pending} onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <fieldset className="user-permissions-modal-fields" disabled={pending || readOnly}>
        {editing?.kind === "members" ? <div className="member-details__section">
          {member ? <p className="member-details__hint">正在管理 {member.name} 的团队归属；其他成员保持原有选择。</p> : null}
          <MultiSelectDropdown label="选择团队成员" value={memberIds} disabled={pending || readOnly} searchable options={users.map((user) => ({ value: user.id, label: `${user.name} · ${user.username ?? user.email ?? user.id}${user.isActive ? "" : "（已停用）"}` }))} onChange={setMemberIds} />
          <Button type="button" variant="ghost" onClick={() => setMemberIds(users.map((user) => user.id))} disabled={pending}>选择本组织全部成员</Button>
          <Button type="button" variant="ghost" onClick={() => setMemberIds([])} disabled={pending}>清空选择</Button>
        </div> : <label className="user-permissions-modal-field"><span>团队名称</span><input required maxLength={80} className="user-permissions-modal-control" value={name} disabled={pending} onChange={(event) => { setName(event.target.value); setError(event.target.value.trim() ? "" : "团队名称不能为空。"); }} /></label>}
        </fieldset>{error ? <p role="alert">{error}</p> : null}
      </form>
      <div className="user-permissions-modal-actions"><Button variant="outline" disabled={pending} onClick={() => { setEditing(null); setError(""); }}>取消</Button><Button form="organization-team-editor" type="submit" disabled={pending || readOnly || (editing?.kind === "create" ? !name.trim() : !dirty)}>{pending ? "保存中…" : editing?.kind === "create" ? "创建团队" : editing?.kind === "members" ? "保存团队成员" : "保存名称"}</Button></div>
      <SettingsLeaveGuard dirty={Boolean(editing) && dirty} saving={pending} />
    </>}</ModalDialog>
    <ConfirmDialog open={Boolean(deleting)} title="删除团队？" description={`删除「${deleting?.name ?? ""}」仅移除团队分组，成员账号、项目和个人权限均保留。`} confirmLabel="删除团队" tone="danger" pending={pending} error={error}
      onCancel={() => { if (!pending) { setDeleting(null); setError(""); } }} onConfirm={() => void remove()} />
  </section>;
}
