import { useState } from "react";
import { SettingsFormPage } from "@/components/layout/SettingsFormPage";
import type { User } from "@/domain/prototype/types";
import type { UserGovernanceActions } from "@/UserPermissionsPage";
import { presentError } from "@/infrastructure/http/presentError";
import { Button } from "@/components/ui/button";
import { formatAbsolute } from "@/domain/format/formatDateTime";

export function MemberOidcIdentityPanel({ user, issuer, actions, onUpdated, disabledReason, readOnly = false }: {
  user: User; issuer: string; actions?: UserGovernanceActions; onUpdated: (user: User) => void; disabledReason?: string; readOnly?: boolean;
}) {
  const [identity, setIdentity] = useState(user.oidcIdentity ?? null);
  const [subject, setSubject] = useState(identity?.subject ?? "");
  const email = user.legacyOidcEmail ?? user.email ?? "";
  const [pending, setPending] = useState(false), [error, setError] = useState("");
  const [checking, setChecking] = useState(false), [checkError, setCheckError] = useState("");
  const [reloaded, setReloaded] = useState(false);
  const dirty = subject !== (identity?.subject ?? "") || (identity !== null && identity.issuer !== issuer);
  async function check(preserveDraft = false) {
    if (checking || pending || !actions?.listUsers) return;
    setChecking(true); setCheckError("");
    try {
      const updated = (await actions.listUsers()).find(member => member.id === user.id);
      if (!updated) throw new Error("成员已调动或不存在，请刷新成员列表。");
      setIdentity(updated.oidcIdentity ?? null); if (!preserveDraft) setSubject(updated.oidcIdentity?.subject ?? ""); onUpdated(updated);
      if (preserveDraft) { setError(""); setReloaded(true); }
    } catch (failure) { setCheckError(presentError(failure, preserveDraft ? "当前身份绑定加载失败，请重试。未保存输入仍保留。" : "同步状态检查失败，请重试。")); }
    finally { setChecking(false); }
  }
  async function save() {
    if (pending || checking || readOnly || disabledReason || !actions?.setOidcIdentity) return;
    if (!subject.trim()) { setError("Subject 不能为空。"); return; }
    setPending(true); setError(""); setReloaded(false);
    try {
      const updated = await actions.setOidcIdentity(user.id, { issuer,subject,...(email.trim() ? { email: email.trim() } : {}),expectedIdentity: identity });
      setIdentity(updated.oidcIdentity ?? null); setSubject(updated.oidcIdentity?.subject ?? ""); onUpdated(updated);
    } catch (failure) { setError(presentError(failure, "身份绑定保存失败，请核对 Subject 和原始迁移邮箱后重试。")); }
    finally { setPending(false); }
  }
  return <SettingsFormPage label="OIDC 身份绑定" saveLabel="保存身份绑定" dirty={!readOnly && dirty} saving={pending || checking} saveDisabled={Boolean(disabledReason) || readOnly} error={error} onSave={() => void save()}
    onDiscard={() => { setSubject(identity?.subject ?? ""); setError(""); }}>
    <section className="member-details__section" aria-label="OIDC 身份">
      <h3>OIDC 身份</h3>
      {disabledReason ? <p className="member-details__hint">{disabledReason}</p> : null}
      <p className="member-details__hint">{identity ? `已绑定：${identity.subject}` : user.legacyOidcEmail ? `未显式绑定；兼容原始迁移邮箱 ${user.legacyOidcEmail}` : "尚未显式绑定外部身份"}</p>
      {user.oidcTransfer ? <div role="status" aria-label="外部身份同步结果">
        <p>{user.oidcTransfer.status === "pending" ? "等待身份系统同步" : "已验证目标组织登录"}</p>
        <p>所需 organization_id：{user.oidcTransfer.targetOrganizationId}</p>
        {user.oidcTransfer.status === "pending" ? <p>尚未收到通过签名、组织声明及显式绑定校验的新登录；刷新仅检查平台已收到的结果，不会修改身份提供方。</p>
          : <p>验证时间：<time dateTime={user.oidcTransfer.verifiedAt ?? undefined}>{formatAbsolute(user.oidcTransfer.verifiedAt ?? "")}</time></p>}
        <Button type="button" variant="outline" disabled={checking || pending || dirty || !actions?.listUsers} onClick={() => void check()}>{checking ? "正在检查…" : "刷新同步结果"}</Button>
      </div> : null}
      {checkError ? <p role="alert">{checkError}</p> : null}
      {error && actions?.listUsers ? <Button type="button" variant="outline" disabled={pending || checking} onClick={() => void check(true)}>{checking ? "正在加载…" : "重新加载当前绑定"}</Button> : null}
      {reloaded ? <p role="status">已加载当前绑定，未保存输入已保留，请核对后再保存。</p> : null}
      <label className="user-permissions-modal-field"><span>Issuer</span><input className="user-permissions-modal-control" value={issuer} readOnly /></label>
      <label className="user-permissions-modal-field"><span>Subject</span><input className="user-permissions-modal-control" value={subject} maxLength={255} disabled={pending || checking || readOnly || Boolean(disabledReason) || !actions?.setOidcIdentity} onChange={(event) => { setSubject(event.target.value); setReloaded(false); }} required /></label>
    </section>
  </SettingsFormPage>;
}
