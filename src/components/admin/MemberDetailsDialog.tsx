import { useState, type ReactNode } from "react";
import type { UserGovernanceActions } from "@/UserPermissionsPage";
import type { PrototypeState, User } from "@/domain/prototype/types";
import { ModalDialog } from "@/components/common/ModalDialog";
import { SettingsFormPage } from "@/components/layout/SettingsFormPage";
import { Button } from "@/components/ui/button";
import { ProjectReviewRolesPanel, type ProjectReviewRolesPanelProps } from "@/components/parameter-admin-next/ProjectReviewRolesPanel";
import { requestSettingsLeave } from "@/application/settingsFormNavigation";
import { presentError } from "@/infrastructure/http/presentError";
import { MemberOidcIdentityPanel } from "./MemberOidcIdentityPanel";
import { organizationRoleIds } from "@/domain/users/types";
import { ViewSwitch } from "@/components/ui/view-switch";
import { SectionEmpty } from "@/components/common/SectionState";

type Props = {
  user: User;
  state: PrototypeState;
  actions?: UserGovernanceActions;
  roleEditor: ReactNode;
  teamMembership?: ReactNode;
  roleLabel: (roleId: User["roleId"]) => string;
  onUpdated: (user: User) => void;
  onClose: () => void;
  oidcIssuer?: string;
  projects?: Array<{ id: string; name: string }>;
  reviewRolesClient?: ProjectReviewRolesPanelProps["userGovernanceClient"];
  readOnly?: boolean;
  onManageTeams?: () => void;
};

export function MemberDetailsDialog({ user, state, actions, roleEditor, teamMembership, roleLabel, onUpdated, onClose, oidcIssuer, projects = state.configDraft.projects, reviewRolesClient, readOnly = false, onManageTeams }: Props) {
  const [name, setName] = useState(user.name);
  const [title, setTitle] = useState(user.title);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [area, setArea] = useState("profile");
  const dirty = name !== user.name || title !== user.title;
  const caller = state.users.find((member) => member.id === state.currentUserId);
  const identityDisabledReason = organizationRoleIds(user).includes("platform-admin") && !(caller && organizationRoleIds(caller).includes("platform-admin"))
    ? "只有平台超级管理员可以修改此账号的身份绑定。" : undefined;

  async function dismiss() {
    if (pending || !(await requestSettingsLeave())) return;
    onClose();
  }

  async function save() {
    if (pending || !actions?.updateUserProfile || readOnly) return;
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
          {projectId ? <ProjectReviewRolesPanel projectId={projectId} projectName={projects.find((project) => project.id === projectId)?.name} userId={user.id} backLabel="返回成员资料" userGovernanceClient={reviewRolesClient}
            onBack={() => { void (async () => { if (await requestSettingsLeave()) {
              setProjectId(null);
              try { const updated = (await actions?.listUsers())?.find((item) => item.id === user.id); if (updated) onUpdated(updated); }
              catch (failure) { setError(presentError(failure, "成员职责刷新失败，请关闭后刷新成员列表。")); }
            } })(); }} /> : <>
            <ViewSwitch variant="tabs" ariaLabel="成员资料分区" value={area} onValueChange={setArea} items={[
              { value: "profile", label: "基本资料", id: "member-details-profile", panelId: "member-details-profile-panel" },
              { value: "access", label: "访问权限", id: "member-details-access", panelId: "member-details-access-panel" },
              { value: "projects", label: "项目职责", id: "member-details-projects", panelId: "member-details-projects-panel" }
            ]} />
            <div hidden={area !== "profile"} role="tabpanel" id="member-details-profile-panel" aria-labelledby="member-details-profile">
            {readOnly ? <dl><dt>姓名</dt><dd>{user.name}</dd><dt>账号</dt><dd>{user.username ?? user.email ?? user.id}</dd><dt>职务</dt><dd>{user.title || "未填写"}</dd></dl> : <SettingsFormPage label="成员基本资料" saveLabel="保存基本资料" dirty={dirty} saving={pending} error={error} onSave={() => void save()}
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
            </SettingsFormPage>}
            {teamMembership}
            {onManageTeams && !readOnly ? <Button type="button" size="sm" variant="outline" onClick={onManageTeams}>管理团队归属</Button> : null}
            </div>
            <div hidden={area !== "access"} role="tabpanel" id="member-details-access-panel" aria-labelledby="member-details-access">
            {oidcIssuer ? <MemberOidcIdentityPanel user={user} issuer={oidcIssuer} actions={actions} onUpdated={onUpdated} disabledReason={identityDisabledReason} readOnly={readOnly} /> : null}
            <section className="member-details__section" aria-label="组织角色与权限"><h3>组织角色与工具权限</h3>{roleEditor}</section>
            </div>
            <div hidden={area !== "projects"} role="tabpanel" id="member-details-projects-panel" aria-labelledby="member-details-projects">
            {projects.length ?
            <section className="member-details__section" aria-label="项目职责"><h3>项目职责</h3>
              <p className="member-details__hint">审核与合入职责按项目配置，独立于组织工具权限及项目编辑角色。</p>
              <div className="member-details__projects">{projects.map((project) => {
                const roles = (user.roles ?? []).filter((role) => role.projectId === project.id && !role.roleId.startsWith("catalog-capability-"));
                return <div className="member-details__project" key={project.id}><div><strong>{project.name}</strong>
                  <span className="member-details__hint">{roles.length ? roles.map((role) => roleLabel(role.roleId)).join("、") : "未分配审核职责"}</span></div>
                  {actions && !readOnly ? <Button type="button" variant="outline" size="sm" aria-label={`配置 ${user.name} 在 ${project.name} 的职责`}
                    onClick={() => { void (async () => { if (await requestSettingsLeave()) { setName(user.name); setTitle(user.title); setError(""); setProjectId(project.id); } })(); }}>配置</Button> : null}
                </div>;
              })}</div>
            </section> : <SectionEmpty message="本组织暂无可配置的项目。" />}
            </div>
          </>}
        </div>
        <div className="user-permissions-modal-actions"><Button type="button" variant="outline" disabled={pending} onClick={() => void dismiss()}>关闭</Button></div>
      </>}
    </ModalDialog>
  </>;
}
