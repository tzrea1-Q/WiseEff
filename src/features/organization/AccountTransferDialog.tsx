import { useEffect, useState } from "react";
import { ModalDialog } from "@/components/common/ModalDialog";
import { SelectControl } from "@/components/common/SelectControl";
import { SectionError, SectionSkeleton } from "@/components/common/SectionState";
import { Button } from "@/components/ui/button";
import { presentError } from "@/infrastructure/http/presentError";
import { SettingsLeaveGuard } from "@/components/layout/SettingsFormPage";
import { requestSettingsLeave } from "@/application/settingsFormNavigation";
import type { AccountTransferClient, AccountTransferInput, AccountTransferPreview } from "@/infrastructure/http/accountTransferClient";

const roles = [{ id: "guest", label: "访客" }, { id: "hardware-user", label: "硬件开发" }, { id: "software-user", label: "软件开发" },
  { id: "hardware-committer", label: "硬件MDE" }, { id: "software-committer", label: "软件MDE" }, { id: "admin", label: "组织管理员" }] as const;
export function AccountTransferDialog({ user, client, onClose, onTransferred, onOpenOrganizations }: {
  user: { id: string; name: string }; client: AccountTransferClient; onClose(): void; onTransferred(target: { id: string; name: string }): void | Promise<void>; onOpenOrganizations?: () => void;
}) {
  const [targets, setTargets] = useState<Array<{ id: string; name: string }> | null>(null), [attempt, setAttempt] = useState(0);
  const [target, setTarget] = useState(""), [targetRoles, setTargetRoles] = useState<AccountTransferInput["targetRoles"]>(["guest"]);
  const [preview, setPreview] = useState<AccountTransferPreview | null>(null), [pending, setPending] = useState(false), [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false; setError("");
    void client.listTargets().then(result => { if (!cancelled) setTargets(result); }).catch(failure => { if (!cancelled) setError(presentError(failure, "目标组织加载失败。")); });
    return () => { cancelled = true; };
  }, [client, attempt]);
  async function inspect() {
    if (pending || !target || !targetRoles.length) return;
    setPending(true); setError(""); setPreview(null);
    try { setPreview(await client.preview(user.id, target)); }
    catch (failure) { setError(presentError(failure, "调动影响加载失败，请重试。")); }
    finally { setPending(false); }
  }
  async function transfer() {
    if (!preview?.supported || pending) return;
    setPending(true); setError("");
    try { await client.transfer(user.id, { targetOrganizationId: target, targetRoles, expectedVersion: preview.version }); await onTransferred(preview.target); }
    catch (failure) { setError(presentError(failure, "账号调动失败，请重新预览后重试。")); setPreview(null); }
    finally { setPending(false); }
  }
  return <ModalDialog open className="user-permissions-modal-card member-details-card modal-card--md" onDismiss={() => { void (async () => { if (!pending && await requestSettingsLeave()) onClose(); })(); }}>
    {({ titleId }) => <>
      <h2 id={titleId}>调动 {user.name}</h2>
      <div className="member-details modal-body">
        {!targets && !error ? <SectionSkeleton label="正在加载目标组织" /> : null}
        {!targets && error ? <SectionError message={error} onRetry={() => { setError(""); setAttempt(value => value + 1); }} /> : null}
        {targets ? <>
          <label className="user-permissions-modal-field"><span>目标组织</span><SelectControl ariaLabel="目标组织" value={target} placeholder="选择目标组织" disabled={pending}
            options={targets.map(org => ({ value: org.id, label: `${org.name}（${org.id}）` }))} onValueChange={value => { setTarget(value); setPreview(null); setError(""); }} /></label>
          <fieldset className="member-organization-roles" disabled={pending}><legend>目标组织角色</legend>
            {roles.map(role => <label className="member-organization-roles__option" key={role.id}><input type="checkbox" checked={targetRoles.includes(role.id)} onChange={event => {
              setTargetRoles(current => event.target.checked ? [...current, role.id] : current.filter(value => value !== role.id)); setPreview(null); setError("");
            }} /> <span>{role.label}</span></label>)}
          </fieldset>
          {!targets.length ? <><p>暂无可接收成员的正常组织，请先创建或恢复目标组织。</p>{onOpenOrganizations ? <Button variant="outline" onClick={onOpenOrganizations}>打开组织目录</Button> : null}</> : null}
          {preview ? <section className="member-details__section" aria-label="调动影响">
            <h3>{preview.source.name} → {preview.target.name}</h3>
            <p>账号 {preview.user.username ?? preview.user.id}{preview.oidcIdentity ? "及显式身份绑定保留" : "及密码保留"}。账号当前{preview.user.isActive ? "启用" : "停用"}，调动后保持该状态。</p>
            {preview.oidcIdentity ? <div role="note" aria-label="外部身份同步要求"><p>调动后等待身份系统同步。请将身份提供方的 organization_id 更新为 {preview.target.id}，然后重新登录。</p>
              <p>Issuer：{preview.oidcIdentity.issuer}；Subject：{preview.oidcIdentity.subject}</p>
              <p>旧组织声明无法登录；只有验证通过的新组织登录才会标记同步完成。可在目标组织成员资料中刷新检查结果。</p></div> : null}
            <p>清除原组织角色 {preview.roles.filter(role => role.projectId === null && role.roleId !== "platform-admin").length} 项、团队 {preview.teams.length} 个及项目参与 {preview.projectMemberships.length} 项；审核、合入职责一并清除。</p>
            <p>撤销会话 {preview.personalAccess.sessions} 个、个人设备配对 {preview.personalAccess.pairings} 个、待用配对码 {preview.personalAccess.pairingCodes} 个。</p>
            <p>项目草稿与待办：{preview.retainedWork.project}</p><p>知识草稿与导入：{preview.retainedWork.knowledge}；反馈草稿与待办：{preview.retainedWork.feedback}</p>
            <p>原组织业务和历史保留，未完成事项留在原组织待交接。组织集成凭据继续有效。</p>
            {preview.platformAdministrator ? <p>平台超级管理员身份保留；目标组织权限按本次选择配置。</p> : null}
            {!preview.supported ? <p role="alert">{preview.unavailableReason}</p> : null}
          </section> : null}
          {error ? <p role="alert" className="organization-profile__error">{error}</p> : null}
        </> : null}
      </div>
      <SettingsLeaveGuard dirty={Boolean(target) || targetRoles.join() !== "guest"} saving={pending} />
      <div className="user-permissions-modal-actions"><Button variant="outline" disabled={pending} onClick={onClose}>取消</Button>
        {preview?.supported ? <Button disabled={pending || !targetRoles.length} onClick={() => void transfer()}>{pending ? "正在调动…" : "确认调动"}</Button>
          : <Button disabled={pending || !target || !targetRoles.length || !targets} onClick={() => void inspect()}>{pending ? "正在预览…" : "预览影响"}</Button>}
      </div>
    </>}
  </ModalDialog>;
}
