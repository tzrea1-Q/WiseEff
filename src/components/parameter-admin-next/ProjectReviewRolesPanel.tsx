import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, RefreshCw } from "lucide-react";
import type { PrototypeState } from "@/domain/prototype/types";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { SectionError, SectionSkeleton } from "@/components/common/SectionState";
import { SettingsFormPage, SettingsFormSection, useDirtyState } from "@/components/layout/SettingsFormPage";
import { requestSettingsLeave } from "@/application/settingsFormNavigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  createUserGovernanceClient,
  type ProjectWorkflowRoleId,
  type ProjectWorkflowRoleBindingsDto
} from "@/infrastructure/http/userGovernanceClient";
import type { UserAccount } from "@/domain/users/types";
import { presentError } from "@/infrastructure/http/presentError";
import "./project-review-roles.css";

export type ProjectReviewRolesPanelProps = {
  projectId: string;
  onBack: () => void;
  state?: PrototypeState;
  userGovernanceClient?: ReturnType<typeof createUserGovernanceClient>;
};

const ROLE_LABELS: Record<ProjectWorkflowRoleId, string> = {
  "hardware-committer": "硬件 MDE",
  "software-committer": "软件 MDE",
  "software-user": "软件开发"
};
const ALL_WORKFLOW_ROLES: ProjectWorkflowRoleId[] = ["hardware-committer", "software-committer", "software-user"];
const defaultUserGovernanceClient = createUserGovernanceClient();

type RoleChange = { user: UserAccount; currentRoles: ProjectWorkflowRoleId[]; nextRoles: ProjectWorkflowRoleId[] };

export function ProjectReviewRolesPanel({ projectId, onBack, userGovernanceClient = defaultUserGovernanceClient }: ProjectReviewRolesPanelProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bindingsDto, setBindingsDto] = useState<ProjectWorkflowRoleBindingsDto | null>(null);
  const [users, setUsers] = useState<UserAccount[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [draftRoles, setDraftRoles] = useState<Record<string, ProjectWorkflowRoleId[]>>({});
  const [savingUserId, setSavingUserId] = useState<string | null>(null);
  const [saveSuccessMessage, setSaveSuccessMessage] = useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<RoleChange[] | null>(null);
  const [failedUserId, setFailedUserId] = useState<string | null>(null);

  const loadData = useCallback(async (preserveError = false, pendingChanges: RoleChange[] = []) => {
    setLoading(true);
    if (!preserveError) setError(null);
    try {
      const [usersList, projectBindings] = await Promise.all([
        userGovernanceClient.listUsers(), userGovernanceClient.getProjectWorkflowRoleBindings(projectId)
      ]);
      setUsers(usersList);
      setBindingsDto(projectBindings);
      const savedDrafts = Object.fromEntries(projectBindings.bindings.map((binding) => [binding.userId, [...binding.roles]]));
      setDraftRoles({ ...savedDrafts, ...Object.fromEntries(pendingChanges.map((change) => [change.user.id, change.nextRoles])) });
      return null;
    } catch (loadError) {
      const message = presentError(loadError, "加载项目审核角色失败，请稍后重试。");
      setError(message);
      return message;
    } finally { setLoading(false); }
  }, [projectId, userGovernanceClient]);

  useEffect(() => { void loadData(); }, [loadData]);

  const currentRolesMap = useMemo(() => new Map(bindingsDto?.bindings.map((binding) => [binding.userId, binding.roles])), [bindingsDto]);
  const savedRoles = users.map((user) => ALL_WORKFLOW_ROLES.filter((role) => currentRolesMap.get(user.id)?.includes(role)));
  const roleDrafts = users.map((user, index) => ALL_WORKFLOW_ROLES.filter((role) => (draftRoles[user.id] ?? savedRoles[index]).includes(role)));
  const dirty = useDirtyState(roleDrafts, savedRoles);
  const changes: RoleChange[] = users.flatMap((user, index) => savedRoles[index].join() === roleDrafts[index].join() ? [] : [{
    user, currentRoles: currentRolesMap.get(user.id) ?? [], nextRoles: draftRoles[user.id] ?? []
  }]);
  const filteredUsers = users.filter((user) => [user.name, user.username, user.email, user.title]
    .some((value) => value?.toLowerCase().includes(searchQuery.trim().toLowerCase())));
  const activeBindings = bindingsDto?.bindings.filter((binding) => binding.isActive) ?? [];
  const pools = [
    { title: "硬件 MDE 池", help: "负责第 1 阶段硬件检视", members: activeBindings.filter((binding) => binding.roles.includes("hardware-committer")) },
    { title: "软件 MDE 池", help: "负责第 2 阶段软件检视", members: activeBindings.filter((binding) => binding.roles.includes("software-committer")) },
    { title: "软件开发 (合入) 池", help: "负责第 3 阶段合入（软件 MDE 可兼任）", members: activeBindings.filter((binding) => binding.roles.includes("software-user") || binding.roles.includes("software-committer")) }
  ];
  const missingRoles = ALL_WORKFLOW_ROLES.filter((_role, index) => pools[index].members.length === 0);

  const toggleUserRole = (userId: string, roleId: ProjectWorkflowRoleId) => {
    const current = draftRoles[userId] ?? currentRolesMap.get(userId) ?? [];
    setDraftRoles((previous) => ({ ...previous, [userId]: current.includes(roleId) ? current.filter((role) => role !== roleId) : [...current, roleId] }));
    setError(null);
    setFailedUserId(null);
    setSaveSuccessMessage(null);
  };

  const handleConfirmSave = async () => {
    if (!confirmDialog || savingUserId) return;
    setError(null);
    setSaveSuccessMessage(null);
    for (const [index, change] of confirmDialog.entries()) {
      const { user, currentRoles, nextRoles } = change;
      setSavingUserId(user.id);
      try {
        const saved = await userGovernanceClient.updateProjectWorkflowRoleBindings(projectId, user.id, { roles: nextRoles, expectedRoles: currentRoles });
        setDraftRoles((current) => ({ ...current, [user.id]: saved.item.roles }));
        setBindingsDto((current) => current ? { ...current, bindings: [
          ...current.bindings.filter((binding) => binding.userId !== user.id),
          { userId: user.id, name: user.name, username: user.username ?? null, email: user.email ?? null, title: user.title, isActive: user.isActive, roles: saved.item.roles }
        ] } : current);
      } catch (saveError) {
        setFailedUserId(user.id);
        if ((saveError as { details?: { code?: string } })?.details?.code === "role-bindings-stale") {
          const refreshError = await loadData(true, confirmDialog.slice(index + 1));
          setError(`更新冲突：${user.name} 的角色已被其他管理员修改。${refreshError
            ? `刷新失败：${refreshError} 未保存的更改已保留，请先刷新后重新核对。`
            : "已刷新最新数据，请重新核对后保存。"}`);
        } else {
          setError(`${user.name}：${presentError(saveError, "更新项目审核角色失败，请重试。")} 已保存的成员保持不变，其余更改尚未保存。`);
        }
        setConfirmDialog(null);
        setSavingUserId(null);
        return;
      }
    }
    setSaveSuccessMessage(`已成功更新 ${confirmDialog.map((change) => change.user.name).join("、")} 的项目审核角色。`);
    setConfirmDialog(null);
    await loadData();
    setSavingUserId(null);
  };

  const busy = loading || Boolean(savingUserId);
  if (loading && !bindingsDto) return <SectionSkeleton label="正在加载项目审核角色配置…" />;
  if (error && !bindingsDto) return <SectionError message={error} onRetry={() => void loadData()} />;

  return <div className="project-review-roles-panel">
    <div className="project-review-roles__header">
      <Button type="button" variant="ghost" onClick={onBack} disabled={busy}><ArrowLeft aria-hidden="true" />返回项目列表</Button>
      <Button type="button" variant="outline" disabled={busy} onClick={async () => { if (await requestSettingsLeave()) void loadData(); }}><RefreshCw aria-hidden="true" />刷新</Button>
    </div>
    <SettingsFormPage label="项目审核角色设置" dirty={dirty} saving={busy} error={error ?? undefined}
      onSave={() => setConfirmDialog(changes)} onDiscard={() => {
        setDraftRoles(Object.fromEntries(currentRolesMap)); setError(null); setFailedUserId(null); setSaveSuccessMessage(null);
      }}>
      <SettingsFormSection title={`${projectId} 项目审核角色配置`} help="配置参数检视流转所需的硬件 MDE、软件 MDE、软件开发职责；组织角色和其他项目绑定保持不变。">
        {missingRoles.length ? <div className="project-review-roles__warning" role="alert"><strong>审核职责未就绪</strong>
          <p>当前项目缺失以下审核角色：<strong>{missingRoles.map((role) => ROLE_LABELS[role]).join("、")}</strong>。在补齐全部三类角色前，普通参数变更提交将被门禁拦截。</p>
        </div> : <p className="project-review-roles__success" role="status">审核职责已就绪</p>}
        <div className="project-review-roles__pools" role="group" aria-label="审核职责候选池">{pools.map((pool) => <article className="project-review-roles__pool" key={pool.title}>
          <strong>{pool.title}</strong><Badge variant={pool.members.length ? "secondary" : "outline"}>{pool.members.length ? `${pool.members.length} 人就绪` : "缺失"}</Badge>
          <p>{pool.help}</p><p>{pool.members.length ? pool.members.map((member) => member.name).join("、") : "暂无配置可用成员"}</p>
        </article>)}</div>
        {saveSuccessMessage ? <p className="project-review-roles__success" role="status">{saveSuccessMessage}</p> : null}
      </SettingsFormSection>
      <SettingsFormSection title="组织成员职责授权" help="勾选成员的项目职责后统一保存；已停用成员只能移除现有角色。">
        <Input type="search" aria-label="搜索成员" placeholder="搜索姓名、用户名、邮箱或职务" value={searchQuery} disabled={busy} onChange={(event) => setSearchQuery(event.target.value)} />
        <div className="project-review-roles__table-scroll">
          <table className="project-review-roles__table" aria-label="组织成员职责授权">
            <thead><tr><th scope="col">成员</th><th scope="col">职务</th><th scope="col">状态</th>{ALL_WORKFLOW_ROLES.map((role) => <th scope="col" key={role}>{ROLE_LABELS[role]}</th>)}</tr></thead>
            <tbody>{filteredUsers.length ? filteredUsers.map((user) => {
              const current = currentRolesMap.get(user.id) ?? [];
              const draft = draftRoles[user.id] ?? current;
              return <tr key={user.id} data-modified={changes.some((change) => change.user.id === user.id)}>
                <td><strong>{user.name}</strong><small>{user.username ?? user.email ?? user.id}</small>
                  {failedUserId === user.id && error ? <p id={`review-role-error-${user.id}`} className="settings-form-page__error">{error}</p> : null}
                </td><td>{user.title}</td><td><Badge variant="outline">{user.isActive ? "正常" : "已停用"}</Badge></td>
                {ALL_WORKFLOW_ROLES.map((role) => <td key={role}><input type="checkbox" checked={draft.includes(role)}
                  disabled={busy || (!user.isActive && !current.includes(role) && !draft.includes(role))}
                  onChange={() => toggleUserRole(user.id, role)} aria-label={`为 ${user.name} 配置 ${ROLE_LABELS[role]}`}
                  aria-invalid={failedUserId === user.id && error ? true : undefined}
                  aria-describedby={failedUserId === user.id && error ? `review-role-error-${user.id}` : undefined}
                  title={!user.isActive ? "已停用成员不可新增角色，仅可移除现有角色" : `${user.name} - ${ROLE_LABELS[role]}`} /></td>)}
              </tr>;
            }) : <tr><td colSpan={6}>暂无匹配成员</td></tr>}</tbody>
          </table>
        </div>
      </SettingsFormSection>
    </SettingsFormPage>
    {confirmDialog ? <ConfirmDialog open title="确认更新项目审核角色" tone="primary" confirmLabel="确认保存" cancelLabel="取消"
      pending={busy} onCancel={() => setConfirmDialog(null)} onConfirm={() => void handleConfirmSave()}
      description={<div><p>确认更新项目 <strong>{projectId}</strong> 的以下成员审核角色？</p>
        {confirmDialog.map((change) => <div key={change.user.id}><strong>{change.user.name}</strong>
          <p>变更前：{change.currentRoles.length ? change.currentRoles.map((role) => ROLE_LABELS[role]).join("、") : "（无）"}</p>
          <p>变更后：{change.nextRoles.length ? change.nextRoles.map((role) => ROLE_LABELS[role]).join("、") : "（清空所有项目角色）"}</p>
        </div>)}<p>本次更新仅影响这些成员在本项目中的审核角色，其组织角色及其他项目绑定保持不变。</p></div>} /> : null}
  </div>;
}
