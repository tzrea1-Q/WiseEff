import { useEffect, useState, type FormEvent } from "react";
import { ModalDialog } from "@/components/common/ModalDialog";
import { SectionError, SectionSkeleton } from "@/components/common/SectionState";
import { SelectControl } from "@/components/common/SelectControl";
import { Button } from "@/components/ui/button";
import { presentError } from "@/infrastructure/http/presentError";
import type { PlatformOrganizationsClient } from "@/infrastructure/http/platformOrganizationsClient";

export function ExperienceRegistrationSettings({ client, local, onClose }: { client: PlatformOrganizationsClient; local: boolean; onClose: () => void }) {
  const [settings, setSettings] = useState<Awaited<ReturnType<PlatformOrganizationsClient["getExperienceRegistration"]>> | null>(null);
  const [organizations, setOrganizations] = useState<Array<{ id: string; name: string }>>([]);
  const [enabled, setEnabled] = useState(false), [organizationId, setOrganizationId] = useState("");
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false), [error, setError] = useState(""), [attempt, setAttempt] = useState(0), [notice, setNotice] = useState("");
  useEffect(() => {
    let cancelled = false;
    void Promise.all([client.getExperienceRegistration(), client.list()]).then(([item, rows]) => {
      if (cancelled) return;
      setSettings(item); setEnabled(item.enabled); setOrganizationId(item.organizationId ?? ""); setOrganizations(rows);
    }).catch((failure: unknown) => { if (!cancelled) setError(presentError(failure, "无法加载体验注册设置。")); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [client, attempt]);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (saving) return;
    setSaving(true); setError(""); setNotice("");
    try { setSettings(await client.updateExperienceRegistration({ enabled, organizationId: organizationId || null })); setNotice("体验注册设置已保存。"); }
    catch (failure: unknown) { setError(presentError(failure, "体验注册设置保存失败，请重试。")); }
    finally { setSaving(false); }
  }
  return <ModalDialog open onDismiss={saving ? undefined : onClose} className="platform-organizations__dialog modal-card--sm">
    {({ titleId }) => <form className="modal-form-contents" onSubmit={(event) => void save(event)} aria-busy={saving}>
      <h3 id={titleId}>公开体验注册</h3>
      <p>仅向指定体验组织开放注册。正式组织通过邀请或管理员添加成员；关闭入口会保留现有成员和待审批申请。</p>
      {loading ? <SectionSkeleton label="正在加载体验注册设置" /> : !settings ? <SectionError message={error} onRetry={() => { setLoading(true); setError(""); setAttempt((value) => value + 1); }} /> : <>
        <p>当前入口：{settings.enabled && settings.available && local ? "已开启" : "已关闭"}；配置来源：{settings.source === "platform" ? "平台设置" : settings.source === "environment" ? "部署环境" : "默认关闭"}。</p>
        <p>当前目标：{settings.organizationName ? `${settings.organizationName}（${settings.organizationId}）` : settings.organizationId ? `${settings.organizationId}（当前不可接纳）` : "未设置"}。</p>
        {!local ? <p role="status">当前认证方式不支持本地密码公开注册，请通过成员管理配置外部身份。</p> : <fieldset className="platform-organizations__fields" disabled={saving}>
          <label><span><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /> 开启公开体验注册</span></label>
          <label>体验目标组织<SelectControl ariaLabel="体验目标组织" value={organizationId} onValueChange={setOrganizationId} options={[{ value: "", label: "请选择目标组织" }, ...organizations.map((row) => ({ value: row.id, label: `${row.name}（${row.id}）` }))]} /></label>
        </fieldset>}
        {error ? <p role="alert">{error}</p> : null}{notice ? <p role="status">{notice}</p> : null}
      </>}
      <div className="platform-organizations__actions"><Button type="button" variant="ghost" disabled={saving} onClick={onClose}>关闭</Button>{local ? <Button type="submit" disabled={loading || !settings || saving || enabled && !organizationId}>{saving ? "正在保存…" : "保存设置"}</Button> : null}</div>
    </form>}
  </ModalDialog>;
}
