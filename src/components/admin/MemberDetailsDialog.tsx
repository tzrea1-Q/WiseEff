import { useState, type ReactNode } from "react";
import type { UserGovernanceActions } from "@/UserPermissionsPage";
import type { PrototypeState, User } from "@/domain/prototype/types";
import { ModalDialog } from "@/components/common/ModalDialog";
import { SettingsFormPage } from "@/components/layout/SettingsFormPage";
import { Button } from "@/components/ui/button";
import { ProjectReviewRolesPanel } from "@/components/parameter-admin-next/ProjectReviewRolesPanel";
import { requestSettingsLeave } from "@/application/settingsFormNavigation";
import { presentError } from "@/infrastructure/http/presentError";

type Props = {
  user: User;
  state: PrototypeState;
  actions?: UserGovernanceActions;
  roleEditor: ReactNode;
  roleLabel: (roleId: User["roleId"]) => string;
  onUpdated: (user: User) => void;
  onClose: () => void;
};

export function MemberDetailsDialog({ user, state, actions, roleEditor, roleLabel, onUpdated, onClose }: Props) {
  const [name, setName] = useState(user.name);
  const [title, setTitle] = useState(user.title);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(null);
  const dirty = name !== user.name || title !== user.title;

  async function dismiss() {
    if (pending || !(await requestSettingsLeave())) return;
    onClose();
  }

  async function save() {
    if (pending || !actions?.updateUserProfile) return;
    if (!name.trim()) { setError("姓名不能为空。"); return; }
    setPending(true); setError(""); setSaved(false);
    try {
      const updated = await actions.updateUserProfile(user.id, { name: name.trim(), title: title.trim() });
      onUpdated(updated); setName(updated.name); setTitle(updated.title); setSaved(true);
    } catch (failure) {
      setError(presentError(failure, "成员资料保存失败，请重试。"));
    } finally { setPending(false); }
  }

  return <>
    <ModalDialog open className={`user-permissions-modal-card member-details-card ${projectId ? "modal-card--lg" : "modal-card--md"}`} onDismiss={() => void dismiss()}>
      {({ titleId }) => <>
        <h2 id={titleId}>{user.name} · 成员资料</h2>
        <div className="member-details modal-body">
          {projectId ? <ProjectReviewRolesPanel projectId={projectId} projectName={state.configDraft.projects.find((project) => project.id === projectId)?.name} userId={user.id} backLabel="返回成员资料"
            onBack={() => { void (async () => { if (await requestSettingsLeave()) {
              setProjectId(null);
              try { const updated = (await actions?.listUsers())?.find((item) => item.id === user.id); if (updated) onUpdated(updated); }
              catch (failure) { setError(presentError(failure, "成员职责刷新失败，请关闭后刷新成员列表。")); }
            } })(); }} /> : <>
            <SettingsFormPage label="成员基本资料" dirty={dirty} saving={pending} error={error} onSave={() => void save()}
              onDiscard={() => { setName(user.name); setTitle(user.title); setError(""); setSaved(false); }}>
              <div className="member-details__section">
              <h3>基本资料</h3>
              <p className="member-details__hint">账号：{user.username ?? user.email ?? user.id}</p>
              <label className="user-permissions-modal-field"><span>姓名</span>
                <input className="user-permissions-modal-control" required value={name} disabled={pending || !actions?.updateUserProfile}
                  onChange={(event) => { setName(event.target.value); setError(""); setSaved(false); }} />
              </label>
              <label className="user-permissions-modal-field"><span>职务（选填）</span>
                <input className="user-permissions-modal-control" value={title} disabled={pending || !actions?.updateUserProfile}
                  onChange={(event) => { setTitle(event.target.value); setError(""); setSaved(false); }} />
              </label>
              {saved ? <p role="status" className="member-details__hint">成员资料已保存。</p> : null}
              </div>
            </SettingsFormPage>
            <section className="member-details__section" aria-label="组织角色与权限"><h3>组织角色</h3>{roleEditor}</section>
            <section className="member-details__section" aria-label="项目职责"><h3>项目职责</h3>
              <p className="member-details__hint">项目职责独立于组织角色，调整一个项目不会修改其他项目的授权。</p>
              <div className="member-details__projects">{state.configDraft.projects.map((project) => {
                const roles = (user.roles ?? []).filter((role) => role.projectId === project.id && !role.roleId.startsWith("catalog-capability-"));
                return <div className="member-details__project" key={project.id}><div><strong>{project.name}</strong>
                  <span className="member-details__hint">{roles.length ? roles.map((role) => roleLabel(role.roleId)).join("、") : "未分配审核职责"}</span></div>
                  {actions ? <Button type="button" variant="outline" size="sm" aria-label={`配置 ${user.name} 在 ${project.name} 的职责`}
                    onClick={() => { if (dirty) setError("请先保存基本资料，再配置项目职责。"); else void (async () => { if (await requestSettingsLeave()) setProjectId(project.id); })(); }}>配置</Button> : null}
                </div>;
              })}</div>
            </section>
          </>}
        </div>
        <div className="user-permissions-modal-actions"><Button type="button" variant="outline" disabled={pending} onClick={() => void dismiss()}>关闭</Button></div>
      </>}
    </ModalDialog>
  </>;
}
