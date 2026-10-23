import { useEffect, useState } from "react";
import { AdminListPage } from "@/components/layout/AdminListPage";
import { SettingsFormPage } from "@/components/layout/SettingsFormPage";
import { requestSettingsLeave } from "@/application/settingsFormNavigation";
import { ModalDialog } from "@/components/common/ModalDialog";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { SectionEmpty, SectionError, SectionSkeleton } from "@/components/common/SectionState";
import { MultiSelectDropdown } from "@/components/MultiSelectDropdown";
import { Button } from "@/components/ui/button";
import { presentError } from "@/infrastructure/http/presentError";
import type { OrganizationTeamDto, OrganizationTeamsClient } from "@/infrastructure/http/userGovernanceClient";

export function OrganizationTeamsPage({ client }: { client?: OrganizationTeamsClient }) {
  const [teams, setTeams] = useState<OrganizationTeamDto[]>([]), [users, setUsers] = useState<Awaited<ReturnType<OrganizationTeamsClient["listUsers"]>>>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading"), [loadError, setLoadError] = useState(""), [attempt, setAttempt] = useState(0);
  const [editing, setEditing] = useState<{ kind: "create" | "rename" | "members"; team?: OrganizationTeamDto } | null>(null);
  const [name, setName] = useState(""), [memberIds, setMemberIds] = useState<string[]>([]), [pending, setPending] = useState(false), [error, setError] = useState("");
  const [deleting, setDeleting] = useState<OrganizationTeamDto | null>(null);
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
    setEditing({ kind, team }); setName(kind === "create" ? "" : team?.name ?? ""); setMemberIds(team?.memberIds ?? []); setError("");
  };
  const dismiss = async () => { if (!pending && await requestSettingsLeave()) { setEditing(null); setError(""); } };
  const dirty = editing?.kind === "members" ? [...memberIds].sort().join("\n") !== [...(editing.team?.memberIds ?? [])].sort().join("\n") : name !== (editing?.kind === "create" ? "" : editing?.team?.name ?? "");
  async function save() {
    if (!client || !editing || pending) return;
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
    if (!client || !deleting || pending) return;
    setPending(true); setError("");
    try { await client.deleteTeam(deleting.id); setTeams((current) => current.filter((team) => team.id !== deleting.id)); setDeleting(null); }
    catch (failure) { setError(presentError(failure, "团队删除失败，请重试。")); } finally { setPending(false); }
  }
  const title = editing?.kind === "members" ? `管理 ${editing.team?.name} 的成员` : editing?.kind === "rename" ? "修改团队名称" : "创建团队";
  return <section className="user-permissions-page" aria-label="团队管理">
    <AdminListPage label="组织团队" headerContent="团队" headerActions={<Button onClick={() => start("create")}>创建团队</Button>} filterBar={null}
      notice={<p className="member-details__hint">团队用于成员分组；加入或离开团队不会改变项目权限。</p>}
      tableState={status === "loading" ? <SectionSkeleton label="正在加载团队" /> : status === "error" ? <SectionError message={loadError} onRetry={() => setAttempt((value) => value + 1)} /> : undefined}
      table={{ ariaLabel: "组织团队", rows: teams, rowKey: (team) => team.id, columns: [
        { key: "name", header: "团队名称", render: (team) => <strong>{team.name}</strong> },
        { key: "members", header: "成员", render: (team) => team.memberIds.length ? team.memberIds.map((id) => users.find((user) => user.id === id)?.name ?? id).join("、") : <span className="member-list-meta">暂无成员</span> },
        { key: "count", header: "人数", render: (team) => team.memberIds.length }
      ] }}
      emptyState={{ message: "还没有团队，可创建团队为成员分组。", actionLabel: "创建团队", onAction: () => start("create") }}
      rowActions={(team) => ({ label: `${team.name} 操作`, primaryAction: { id: "members", label: "管理成员", ariaLabel: `管理 ${team.name} 的成员`, onSelect: () => start("members", team) }, items: [
        { id: "rename", label: "改名", onSelect: () => start("rename", team) },
        { id: "delete", label: "删除", destructive: true, onRequestConfirmation: () => { setDeleting(team); setError(""); } }
      ] })} />
    <ModalDialog open={Boolean(editing)} className="user-permissions-modal-card modal-card--md" onDismiss={() => void dismiss()}>{({ titleId }) => <>
      <h2 id={titleId}>{title}</h2>
      <div className="modal-body"><SettingsFormPage key={`${editing?.kind}:${editing?.team?.id ?? "new"}`} label={title} dirty={dirty} saving={pending} error={error}
        onSave={() => void save()} onDiscard={() => { setName(editing?.kind === "create" ? "" : editing?.team?.name ?? ""); setMemberIds(editing?.team?.memberIds ?? []); setError(""); }}>
        {editing?.kind === "members" ? <div className="member-details__section">
          <p className="member-details__hint">可同时选择多位本组织成员，停用成员会标注。此操作仅更新分组。</p>
          <MultiSelectDropdown label="选择团队成员" value={memberIds} options={users.map((user) => ({ value: user.id, label: `${user.name} · ${user.username ?? user.email ?? user.id}${user.isActive ? "" : "（已停用）"}` }))} onChange={setMemberIds} />
          <p className="member-details__hint">已选择 {memberIds.length} 位成员</p>
          <Button type="button" variant="ghost" onClick={() => setMemberIds(users.map((user) => user.id))} disabled={pending}>选择本组织全部成员</Button>
          <Button type="button" variant="ghost" onClick={() => setMemberIds([])} disabled={pending}>清空选择</Button>
        </div> : <label className="user-permissions-modal-field"><span>团队名称</span><input required maxLength={80} className="user-permissions-modal-control" value={name} disabled={pending} onChange={(event) => { setName(event.target.value); setError(""); }} /></label>}
      </SettingsFormPage></div>
      <div className="user-permissions-modal-actions"><Button variant="outline" disabled={pending} onClick={() => void dismiss()}>关闭</Button></div>
    </>}</ModalDialog>
    <ConfirmDialog open={Boolean(deleting)} title="删除团队？" description={`删除「${deleting?.name ?? ""}」仅移除团队分组，成员账号、项目和个人权限均保留。`} confirmLabel="删除团队" tone="danger" pending={pending} error={error}
      onCancel={() => { if (!pending) { setDeleting(null); setError(""); } }} onConfirm={() => void remove()} />
  </section>;
}
