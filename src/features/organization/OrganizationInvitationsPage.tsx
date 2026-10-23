import { useEffect, useState } from "react";
import { AdminListPage } from "@/components/layout/AdminListPage";
import { SettingsFormPage } from "@/components/layout/SettingsFormPage";
import { requestSettingsLeave } from "@/application/settingsFormNavigation";
import { ModalDialog } from "@/components/common/ModalDialog";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { SectionEmpty, SectionError, SectionSkeleton } from "@/components/common/SectionState";
import { MultiSelectDropdown } from "@/components/MultiSelectDropdown";
import { Button } from "@/components/ui/button";
import { platformRoles, type PlatformRoleId } from "@/domain/users/types";
import { formatAbsolute } from "@/domain/format/formatDateTime";
import { presentError } from "@/infrastructure/http/presentError";
import type { OrganizationInvitationDto, OrganizationInvitationsClient } from "@/infrastructure/http/organizationInvitationsClient";

const statusNames = { pending: "待接受", expired: "已过期", revoked: "已撤销", accepted: "已接受" };
export function OrganizationInvitationsPage({ client, canGrantPlatformAdmin, onBack }: { client?: OrganizationInvitationsClient; canGrantPlatformAdmin: boolean; onBack(): void }) {
  const [invitations, setInvitations] = useState<OrganizationInvitationDto[]>([]), [status, setStatus] = useState<"loading" | "ready" | "error" | "external">("loading"), [attempt, setAttempt] = useState(0), [loadError, setLoadError] = useState("");
  const [editing, setEditing] = useState<{ item?: OrganizationInvitationDto } | null>(null), [label, setLabel] = useState(""), [roles, setRoles] = useState<PlatformRoleId[]>(["hardware-user"]), [days, setDays] = useState(7);
  const [pending, setPending] = useState(false), [error, setError] = useState(""), [revoking, setRevoking] = useState<OrganizationInvitationDto | null>(null), [link, setLink] = useState(""), [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!client) return;
    let cancelled = false; setStatus("loading"); setLoadError("");
    void client.getAuthenticationConfig().then(async (config) => {
      if (cancelled) return;
      if (config.provider !== "local") { setStatus("external"); return; }
      const items = await client.listInvitations(); if (!cancelled) { setInvitations(items); setStatus("ready"); }
    }).catch((failure: unknown) => { if (!cancelled) { setLoadError(presentError(failure, "邀请列表加载失败。")); setStatus("error"); } });
    return () => { cancelled = true; };
  }, [client, attempt]);
  const start = (item?: OrganizationInvitationDto) => { setEditing({ item }); setLabel(item?.label ?? ""); setRoles(item?.roles ?? ["hardware-user"]); setDays(7); setError(""); };
  const dismiss = async () => { if (!pending && await requestSettingsLeave()) { setEditing(null); setError(""); } };
  const dirty = Boolean(editing && (label !== (editing.item?.label ?? "") || roles.join() !== (editing.item?.roles ?? ["hardware-user"]).join() || days !== 7));
  async function save() {
    if (!client || !editing || pending) return;
    if (!label.trim() || !roles.length || !Number.isInteger(days) || days < 1 || days > 30) { setError("请填写邀请备注、至少一个角色及 1–30 天有效期。"); return; }
    setPending(true); setError("");
    try {
      const result = await client.issueInvitation({ label: label.trim(), roles, expiresInDays: days }, editing.item?.id);
      setInvitations((current) => [result.item, ...current.filter((item) => item.id !== result.item.id)]); setEditing(null); setCopied(false);
      setLink(`${window.location.origin}/invite#${result.token}`);
    } catch (failure) { setError(presentError(failure, "邀请生成失败，请重试。")); } finally { setPending(false); }
  }
  async function revoke() {
    if (!client || !revoking || pending) return;
    setPending(true); setError("");
    try { const item = await client.revokeInvitation(revoking.id); setInvitations((current) => current.map((old) => old.id === item.id ? item : old)); setRevoking(null); }
    catch (failure) { setError(presentError(failure, "撤销失败，请重试。")); } finally { setPending(false); }
  }
  if (!client) return <SectionEmpty message="邀请管理需要 API 连接。" />;
  if (status === "external") return <SectionEmpty message="当前使用外部身份认证，请在成员管理中直接绑定身份。密码邀请仅适用于本地账号。" actionLabel="返回成员管理" onAction={onBack} />;
  const title = editing?.item ? "修改并重新生成邀请" : "创建邀请";
  return <section className="user-permissions-page" aria-label="邀请管理">
    <AdminListPage label="成员邀请" headerContent="邀请" headerActions={<><Button variant="outline" onClick={onBack}>返回成员管理</Button><Button variant="outline" onClick={() => setAttempt((value) => value + 1)}>刷新</Button><Button onClick={() => start()}>创建邀请</Button></>} filterBar={null}
      notice={<p className="member-details__hint">复制一次性链接交给受邀人；接受后角色直接生效，无需再次审批。直接创建账号仍可在成员管理中使用。</p>}
      tableState={status === "loading" ? <SectionSkeleton label="正在加载邀请" /> : status === "error" ? <SectionError message={loadError} onRetry={() => setAttempt((value) => value + 1)} /> : undefined}
      table={{ ariaLabel: "成员邀请", rows: invitations, rowKey: (item) => item.id, columns: [
        { key: "label", header: "备注", render: (item) => <strong>{item.label}</strong> },
        { key: "roles", header: "组织角色", render: (item) => item.roles.map((role) => platformRoles.find((entry) => entry.id === role)?.name ?? role).join("、") },
        { key: "status", header: "状态", render: (item) => statusNames[item.status] },
        { key: "expires", header: "有效期至", render: (item) => formatAbsolute(item.expiresAt) }
      ] }} emptyState={{ message: "暂无邀请。", actionLabel: "创建邀请", onAction: () => start() }}
      rowActions={(item) => item.status === "accepted" ? { label: `${item.label} 操作`, items: [] } : { label: `${item.label} 操作`, primaryAction: { id: "regenerate", label: "重新生成", onSelect: () => start(item) }, items: item.status === "revoked" ? [] : [{ id: "revoke", label: "撤销", destructive: true, onRequestConfirmation: () => { setRevoking(item); setError(""); } }] }} />
    <ModalDialog open={Boolean(editing)} className="user-permissions-modal-card modal-card--md" onDismiss={() => void dismiss()}>{({ titleId }) => <>
      <h2 id={titleId}>{title}</h2><div className="modal-body"><SettingsFormPage label={title} dirty={dirty} saving={pending} error={error} onSave={() => void save()} onDiscard={() => { setLabel(editing?.item?.label ?? ""); setRoles(editing?.item?.roles ?? ["hardware-user"]); setDays(7); setError(""); }}>
        {editing?.item ? <p className="member-details__hint">保存后旧链接立即失效，请交付新链接。</p> : null}
        <label className="user-permissions-modal-field"><span>邀请备注</span><input className="user-permissions-modal-control" required maxLength={120} value={label} disabled={pending} onChange={(event) => setLabel(event.target.value)} /></label>
        <MultiSelectDropdown label="组织角色" value={roles} options={platformRoles.filter((role) => canGrantPlatformAdmin || role.id !== "platform-admin").map((role) => ({ value: role.id, label: role.name }))} onChange={(values) => setRoles(values as PlatformRoleId[])} />
        <label className="user-permissions-modal-field"><span>有效天数</span><input type="number" className="user-permissions-modal-control" required min={1} max={30} value={days} disabled={pending} onChange={(event) => setDays(Number(event.target.value))} /></label>
      </SettingsFormPage></div><div className="user-permissions-modal-actions"><Button variant="outline" disabled={pending} onClick={() => void dismiss()}>关闭</Button>{editing?.item && !dirty ? <Button disabled={pending} onClick={() => void save()}>生成新链接</Button> : null}</div>
    </>}</ModalDialog>
    <ModalDialog open={Boolean(link)} className="user-permissions-modal-card modal-card--md" onDismiss={() => { setLink(""); setError(""); }}>{({ titleId }) => <>
      <h2 id={titleId}>邀请链接已生成</h2><div className="modal-body"><p className="member-details__hint">请复制后交给受邀人。关闭后无法再次查看，可重新生成新链接。</p>
      <label className="user-permissions-modal-field"><span>一次性邀请链接</span><input className="user-permissions-modal-control" readOnly value={link} onFocus={(event) => event.target.select()} /></label>
      {error ? <p role="alert">{error}</p> : null}{copied ? <p role="status">邀请链接已复制。</p> : null}</div>
      <div className="user-permissions-modal-actions"><Button variant="outline" onClick={() => { setLink(""); setError(""); }}>关闭</Button><Button onClick={() => void navigator.clipboard.writeText(link).then(() => setCopied(true)).catch(() => setError("自动复制失败，请选中链接手动复制。"))}>复制链接</Button></div>
    </>}</ModalDialog>
    <ConfirmDialog open={Boolean(revoking)} title="撤销邀请？" description={`撤销「${revoking?.label ?? ""}」后，原链接立即失效。`} confirmLabel="撤销邀请" tone="danger" pending={pending} error={error} onCancel={() => { if (!pending) { setRevoking(null); setError(""); } }} onConfirm={() => void revoke()} />
  </section>;
}
