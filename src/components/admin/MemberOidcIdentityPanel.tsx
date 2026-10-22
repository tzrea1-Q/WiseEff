import { useState } from "react";
import { SettingsFormPage } from "@/components/layout/SettingsFormPage";
import type { User } from "@/domain/prototype/types";
import type { UserGovernanceActions } from "@/UserPermissionsPage";
import { presentError } from "@/infrastructure/http/presentError";

export function MemberOidcIdentityPanel({ user, issuer, actions, onUpdated, disabledReason }: {
  user: User; issuer: string; actions?: UserGovernanceActions; onUpdated: (user: User) => void; disabledReason?: string;
}) {
  const [identity, setIdentity] = useState(user.oidcIdentity ?? null);
  const [subject, setSubject] = useState(identity?.subject ?? "");
  const email = user.legacyOidcEmail ?? user.email ?? "";
  const [pending, setPending] = useState(false), [error, setError] = useState("");
  const dirty = subject !== (identity?.subject ?? "") || (identity !== null && identity.issuer !== issuer);
  async function save() {
    if (pending || disabledReason || !actions?.setOidcIdentity) return;
    if (!subject.trim()) { setError("Subject 不能为空。"); return; }
    setPending(true); setError("");
    try {
      const updated = await actions.setOidcIdentity(user.id, { issuer,subject,...(email.trim() ? { email: email.trim() } : {}),expectedIdentity: identity });
      setIdentity(updated.oidcIdentity ?? null); setSubject(updated.oidcIdentity?.subject ?? ""); onUpdated(updated);
    } catch (failure) { setError(presentError(failure, "身份绑定保存失败，请核对 Subject 和原始迁移邮箱后重试。")); }
    finally { setPending(false); }
  }
  return <SettingsFormPage label="OIDC 身份绑定" dirty={dirty} saving={pending} saveDisabled={Boolean(disabledReason)} error={error} onSave={() => void save()}
    onDiscard={() => { setSubject(identity?.subject ?? ""); setError(""); }}>
    <section className="member-details__section" aria-label="OIDC 身份">
      <h3>OIDC 身份</h3>
      {disabledReason ? <p className="member-details__hint">{disabledReason}</p> : null}
      <p className="member-details__hint">{identity ? `已绑定：${identity.subject}` : user.legacyOidcEmail ? `未显式绑定；兼容原始迁移邮箱 ${user.legacyOidcEmail}` : "尚未显式绑定外部身份"}</p>
      <label className="user-permissions-modal-field"><span>Issuer</span><input className="user-permissions-modal-control" value={issuer} readOnly /></label>
      <label className="user-permissions-modal-field"><span>Subject</span><input className="user-permissions-modal-control" value={subject} maxLength={255} disabled={pending || Boolean(disabledReason) || !actions?.setOidcIdentity} onChange={(event) => setSubject(event.target.value)} required /></label>
    </section>
  </SettingsFormPage>;
}
