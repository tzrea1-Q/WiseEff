import { useState, type ReactNode } from "react";
import { z } from "zod";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
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
  const [email, setEmail] = useState(user.email ?? "");
  const [username, setUsername] = useState<string | null>(null);
  const [usernameError, setUsernameError] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [area, setArea] = useState("profile");
  const emailChanged = email.trim() !== (user.email ?? "");
  const dirty = name !== user.name || title !== user.title || emailChanged;
  const caller = state.users.find((member) => member.id === state.currentUserId);
  const platformAdmin = caller && organizationRoleIds(caller).includes("platform-admin");
  const canCorrectUsername = platformAdmin && !readOnly && Boolean(user.username && actions?.correctLocalUsername);
  const identityDisabledReason = organizationRoleIds(user).includes("platform-admin") && !platformAdmin
    ? "只有平台超级管理员可以修改此账号的身份绑定。" : undefined;

  async function dismiss() {
    if (pending || !(await requestSettingsLeave())) return;
    onClose();
  }

  async function save() {
    if (pending || !actions?.updateUserProfile || readOnly) return;
    if (!name.trim()) { setError("姓名不能为空。"); return; }
    if (emailChanged && !z.string().email().safeParse(email.trim()).success) { setError("请输入有效的资料邮箱。"); return; }
    setPending(true); setError(""); setSaved(false);
    try {
      const updated = await actions.updateUserProfile(user.id, { name: name.trim(), title: title.trim(), ...(emailChanged ? { email: email.trim() } : {}) });
      onUpdated(updated); setName(updated.name); setTitle(updated.title); setEmail(updated.email ?? ""); setSaved(true);
    } catch (failure) {
      setError(presentError(failure, "成员资料保存失败，请重试。"));
    } finally { setPending(false); }
  }

  async function saveUsername() {
    if (pending || !canCorrectUsername || !username?.trim() || !actions?.correctLocalUsername) return;
    setPending(true); setUsernameError("");
    try {
      onUpdated(await actions.correctLocalUsername(user.id, username.trim()));
      setUsername(null);
    } catch (failure) {
      setUsernameError(presentError(failure, "本地登录名保存失败，请重试。"));
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
            {readOnly ? <dl><dt>姓名</dt><dd>{user.name}</dd><dt>本地登录名</dt><dd>{user.username ?? "未设置"}</dd><dt>资料邮箱</dt><dd>{user.email ?? "未填写"}</dd><dt>职务</dt><dd>{user.title || "未填写"}</dd></dl> : <SettingsFormPage label="成员基本资料" saveLabel="保存基本资料" dirty={dirty} saving={pending} error={error} onSave={() => void save()}
              onDiscard={() => { setName(user.name); setTitle(user.title); setEmail(user.email ?? ""); setError(""); setSaved(false); }}>
              <div className="member-details__section">
              <h3>基本资料</h3>
              <div className="flex flex-wrap items-center gap-2">
                <p className="member-details__hint">本地登录名：{user.username ?? "未设置"}</p>
                {canCorrectUsername ? <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => { setUsername(user.username!); setUsernameError(""); }}>更正本地登录名</Button> : null}
              </div>
              <label className="user-permissions-modal-field"><span>姓名</span>
                <input className="user-permissions-modal-control" required value={name} disabled={pending || !actions?.updateUserProfile}
                  onChange={(event) => { setName(event.target.value); setError(""); setSaved(false); }} />
              </label>
              <label className="user-permissions-modal-field"><span>职务（选填）</span>
                <input className="user-permissions-modal-control" value={title} disabled={pending || !actions?.updateUserProfile}
                  onChange={(event) => { setTitle(event.target.value); setError(""); setSaved(false); }} />
              </label>
              <label className="user-permissions-modal-field"><span>资料邮箱</span>
                <input className="user-permissions-modal-control" type="email" value={email} disabled={pending || !actions?.updateUserProfile}
                  onChange={(event) => { setEmail(event.target.value); setError(""); setSaved(false); }} />
              </label>
              <p className="member-details__hint">资料邮箱用于成员资料。外部登录使用「访问权限」中的 OIDC 身份绑定。</p>
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
                    onClick={() => { void (async () => { if (await requestSettingsLeave()) { setName(user.name); setTitle(user.title); setEmail(user.email ?? ""); setError(""); setProjectId(project.id); } })(); }}>配置</Button> : null}
                </div>;
              })}</div>
            </section> : <SectionEmpty message="本组织暂无可配置的项目。" />}
            </div>
          </>}
        </div>
        <div className="user-permissions-modal-actions"><Button type="button" variant="outline" disabled={pending} onClick={() => void dismiss()}>关闭</Button></div>
      </>}
    </ModalDialog>
    <ConfirmDialog open={username !== null && !!canCorrectUsername} title="更正本地登录名" confirmLabel="保存登录名" pending={pending} error={usernameError}
      confirmDisabled={!username?.trim() || username.trim().toLowerCase() === user.username}
      description="下次本地登录请使用新登录名和原密码。当前会话继续有效。登录名为 3–64 个字符，可用字母、数字、点、下划线和连字符。"
      extra={<label className="user-permissions-modal-field"><span>新本地登录名</span>
        <input className="user-permissions-modal-control" autoComplete="off" maxLength={64} disabled={pending} value={username ?? ""}
          onChange={event => { setUsername(event.target.value); setUsernameError(""); }} />
      </label>}
      onCancel={() => setUsername(null)} onConfirm={() => void saveUsername()} />
  </>;
}
