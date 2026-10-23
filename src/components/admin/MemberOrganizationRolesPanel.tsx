import { useState } from "react";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { SettingsFormPage } from "@/components/layout/SettingsFormPage";
import { Button } from "@/components/ui/button";
import { isPlatformRoleId, organizationRoleIds, type PlatformRoleId, type UserAccount } from "@/domain/users/types";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import { presentError } from "@/infrastructure/http/presentError";

type Props = {
  user: UserAccount;
  options: Array<{ id: PlatformRoleId; label: string; description: string }>;
  disabledReason?: string;
  isSelf?: boolean;
  onSave: (roles: PlatformRoleId[], expectedRoles: PlatformRoleId[]) => Promise<UserAccount>;
  onReload: () => Promise<UserAccount>;
  onSaved?: (user: UserAccount) => Promise<void>;
};

export function MemberOrganizationRolesPanel({ user, options, disabledReason, isSelf = false, onSave, onReload, onSaved }: Props) {
  // Keep the original role set while editing, even if the directory refreshes.
  // The server compares that set with its current bindings before writing.
  const [savedRoles, setSavedRoles] = useState(() => organizationRoleIds(user));
  const [roles, setRoles] = useState(savedRoles);
  const [pending, setPending] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState("");
  const [conflictRoles, setConflictRoles] = useState<PlatformRoleId[] | null>(null);
  const [saved, setSaved] = useState(false);
  const label = (ids: PlatformRoleId[]) => ids.map((id) => options.find((option) => option.id === id)?.label ?? id).join("、") || "未授予组织级角色";
  const dirty = [...roles].sort().join() !== [...savedRoles].sort().join();

  async function save() {
    if (pending || conflictRoles !== null) return;
    setPending(true); setError("");
    try {
      const updated = await onSave(roles, savedRoles);
      const next = organizationRoleIds(updated);
      setSavedRoles(next); setRoles(next); setSaved(true); setConfirm(false);
      await onSaved?.(updated);
    } catch (failure) {
      if (failure instanceof WiseEffApiError && failure.details.code === "role-bindings-stale") {
        setConflictRoles(Array.isArray(failure.details.currentRoles) ? failure.details.currentRoles.filter((role): role is PlatformRoleId => typeof role === "string" && isPlatformRoleId(role)) : []);
        setError("该成员的组织角色已被其他管理员修改。请重新加载当前角色并核对后再保存。");
      } else {
        setError(presentError(failure, "组织角色保存失败，请重试。"));
      }
    } finally { setPending(false); }
  }

  async function reload() {
    if (pending) return;
    setPending(true);
    try {
      const updated = await onReload();
      const next = organizationRoleIds(updated);
      setSavedRoles(next); setRoles(next); setConflictRoles(null); setError(""); setConfirm(false); setSaved(false);
    } catch (failure) {
      setError(presentError(failure, "当前角色加载失败，请重试。未保存的更改仍然保留。"));
    } finally { setPending(false); }
  }

  return <>
    <SettingsFormPage label="组织角色设置" dirty={dirty} saving={pending} saveDisabled={Boolean(disabledReason) || conflictRoles !== null}
      onSave={() => { setError(""); setConfirm(true); }} onDiscard={() => { setRoles(savedRoles); setError(""); setSaved(false); }}>
      <fieldset className="member-organization-roles" aria-label="组织角色选择" disabled={pending || Boolean(disabledReason)}>
        {options.map((option) => <label key={option.id} className="member-organization-roles__option">
          <input type="checkbox" aria-label={option.label} checked={roles.includes(option.id)}
            onChange={(event) => { setRoles(options.filter((item) => item.id === option.id ? event.target.checked : roles.includes(item.id)).map((item) => item.id)); setSaved(false); }} />
          <span><strong>{option.label}</strong><span className="member-details__hint">{option.description}</span></span>
        </label>)}
      </fieldset>
      <p className="member-details__hint">已授予：{label(savedRoles)}。支持组合角色或全部取消；项目职责独立保留。{isSelf ? "撤销自身管理权限前，请确认已有其他管理员接任。" : ""}</p>
      {disabledReason ? <p className="member-details__hint">{disabledReason}</p> : null}
      {saved ? <p role="status" className="member-details__hint">组织角色已保存。</p> : null}
      {!confirm && conflictRoles !== null ? <div role="alert"><p>{error}</p><p>当前组织角色：{label(conflictRoles)}</p>
        <Button type="button" variant="outline" disabled={pending} onClick={() => void reload()}>重新加载当前角色</Button></div> : null}
    </SettingsFormPage>
    <ConfirmDialog open={confirm} title="确认调整用户角色" description={<>
      <p>将把 <strong>{user.name}</strong> 的组织角色从「{label(savedRoles)}」调整为「{label(roles)}」，新权限立即生效。</p>
      <p className="member-details__hint">本次仅更新组织角色，该用户各项目中的审核角色与职责绑定将完整保留。</p>
    </>} confirmLabel="确认调整" pending={pending} confirmDisabled={conflictRoles !== null} error={error}
      extra={conflictRoles !== null ? <div><p>当前组织角色：{label(conflictRoles)}</p><Button type="button" variant="outline" disabled={pending} onClick={() => void reload()}>重新加载当前角色</Button></div> : undefined}
      onConfirm={() => void save()} onCancel={() => { if (!pending) { setConfirm(false); if (conflictRoles === null) setError(""); } }} />
  </>;
}
