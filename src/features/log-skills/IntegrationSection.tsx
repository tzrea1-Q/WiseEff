import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionError, SectionSkeleton } from "@/components/common/SectionState";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import { resolveWiseEffApiBaseUrl } from "@/infrastructure/http/runtimeMode";
import type { LogAnalysisRepository } from "@/application/ports/LogAnalysisRepository";
import type { LogDomain } from "@/domain/logs/types";
import type { SectionProps } from "./SkillWorkspace";
import { SkillWebhookEditor } from "./SkillWebhookEditor";
import { buildSkillUploadExamples } from "./integrationExamples";
import { IntegrationCredentials } from "./IntegrationCredentials";

export function IntegrationSection({ skill, disabled, repository, apiMode, canEdit, onSkillUpdated, onBusyChange, onWebhookDirtyChange }: SectionProps) {
  const id = useId();
  const [domain, setDomain] = useState<LogDomain | null>(null);
  const [loading, setLoading] = useState(apiMode);
  const [loadError, setLoadError] = useState(false);
  const [editing, setEditing] = useState(false);
  const [key, setKey] = useState(skill.skillKey);
  const [keyError, setKeyError] = useState("");
  const [saving, setSaving] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (!apiMode) return;
    let active = true;
    setLoading(true); setLoadError(false);
    void repository?.listLogSkills?.({ includeArchived: true }).then((items) => {
      if (active) { setDomain(items.find((item) => item.id === skill.id) ?? null); setLoading(false); }
    }).catch(() => { if (active) { setLoadError(true); setLoading(false); } });
    if (!repository?.listLogSkills) setLoading(false);
    return () => { active = false; };
  }, [apiMode, repository, skill.id, reload]);
  const examples = buildSkillUploadExamples(import.meta.env.VITE_WISEEFF_API_BASE_URL?.trim() ? resolveWiseEffApiBaseUrl() : window.location.origin, skill.skillKey);
  const copy = async (value: string, label: string) => {
    try { await navigator.clipboard.writeText(value); setCopyStatus(`已复制${label}`); }
    catch { setCopyStatus("复制失败，请手动复制。"); }
  };
  const saveKey = async () => {
    if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(key)) { setKeyError("使用 2–63 个小写字母、数字或连字符，首字符须为字母或数字。"); return; }
    setSaving(true); onBusyChange(true); setKeyError("");
    try {
      await repository!.updateLogDomain!({ domainId: skill.id, skillKey: key });
      onSkillUpdated({ ...skill, skillKey: key }); setEditing(false);
    } catch (cause) {
      const errors = cause instanceof WiseEffApiError ? cause.details.fieldErrors as Record<string, string | string[]> | undefined : undefined;
      setKeyError(errors?.skillKey ? "技能标识格式无效或已被使用，请换一个标识。" : "保存失败，请重试。");
    } finally { setSaving(false); onBusyChange(false); }
  };
  const webhookRepository = repository?.setLogDomainWebhook && repository.listLogDomainWebhookDeliveries && repository.sendLogDomainWebhookTest
    ? repository as Required<Pick<LogAnalysisRepository, "setLogDomainWebhook" | "listLogDomainWebhookDeliveries" | "sendLogDomainWebhookTest">> : null;
  return <div className="skill-section skill-integration"><h2>集成</h2>
    <section aria-label="接入"><h3>接入</h3>
      <p>使用技能标识上传日志时，将绑定当前已发布版本。修改标识后，请同步更新调用方。</p>
      <div><label htmlFor={`${id}-key`}>技能标识</label><div className="skill-integration-actions">
        <Input id={`${id}-key`} value={editing ? key : skill.skillKey} readOnly={!editing} maxLength={63} disabled={saving}
          aria-invalid={!!keyError} aria-describedby={keyError ? "skill-key-error" : undefined}
          onChange={(event) => { setKey(event.target.value); setKeyError(""); }} />
        <Button variant="outline" onClick={() => void copy(skill.skillKey, "技能标识")}>复制技能标识</Button>
        {!editing ? <Button variant="outline" disabled={disabled || !repository?.updateLogDomain} onClick={() => { setKey(skill.skillKey); setKeyError(""); setEditing(true); }}>编辑技能标识</Button> : null}
      </div></div>
      {editing ? <div>
        {keyError ? <p id="skill-key-error" role="alert" className="skill-field-error">{keyError}</p> : null}
        <div className="skill-integration-actions"><Button disabled={saving || disabled} onClick={() => void saveKey()}>保存标识</Button>
          <Button variant="outline" disabled={saving} onClick={() => { setEditing(false); setKeyError(""); }}>取消编辑</Button></div>
      </div> : null}
      <div><label htmlFor={`${id}-endpoint`}>上传地址</label><div className="skill-integration-actions"><Input id={`${id}-endpoint`} readOnly value={examples.endpoint} /><Button variant="outline" onClick={() => void copy(examples.endpoint, "上传地址")}>复制上传地址</Button></div></div>
      <p>将集成凭据填入 Authorization: Bearer &lt;集成凭据&gt;；示例仅包含占位符和示例日志。</p>
      {([['json', '单文件 JSON / Base64'], ['multipart', '多文件表单']] as const).map(([kind, label]) => <details key={kind}><summary>{label}</summary>
        <pre className="skill-curl-example"><code>{examples[kind].curl}</code></pre>
        <Button variant="outline" onClick={() => void copy(examples[kind].curl, label)}>复制{label}命令</Button>
      </details>)}
      {copyStatus ? <p role="status">{copyStatus}</p> : null}
    </section>
    <IntegrationCredentials skill={skill} repository={repository} apiMode={apiMode} canEdit={canEdit} disabled={disabled} onBusyChange={onBusyChange} />
    <section aria-label="结果回调"><h3>结果回调</h3>
      {loading ? <SectionSkeleton label="正在加载回调配置" /> : loadError ? <SectionError message="无法加载回调配置" onRetry={() => setReload((value) => value + 1)} />
        : domain && webhookRepository ? <SkillWebhookEditor key={domain.id} domain={domain} logActions={webhookRepository} disabled={disabled}
          onDirtyChange={onWebhookDirtyChange} onBusyChange={onBusyChange} onSaved={async () => undefined} /> : <p>{apiMode ? "当前无法加载回调配置。" : "请在 API 模式下配置结果回调。"}</p>}
    </section>
  </div>;
}
