import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionError, SectionSkeleton } from "@/components/common/SectionState";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import type { LogAnalysisRepository } from "@/application/ports/LogAnalysisRepository";
import type { LogDomain } from "@/domain/logs/types";
import type { SectionProps } from "./SkillWorkspace";
import { SkillWebhookEditor } from "./SkillWebhookEditor";
import { buildSkillUploadExamples } from "./integrationExamples";

export function IntegrationSection({ skill, spec, setSpec, disabled, repository, apiMode, dirty, onSkillUpdated, onBusyChange, fieldErrors }: SectionProps) {
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
  const examples = buildSkillUploadExamples(window.location.origin, skill.skillKey);
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
        {!editing ? <Button variant="outline" disabled={disabled || dirty || !repository?.updateLogDomain} onClick={() => { setKey(skill.skillKey); setKeyError(""); setEditing(true); }}>编辑技能标识</Button> : null}
      </div></div>
      {editing ? <div>
        {keyError ? <p id="skill-key-error" role="alert" className="skill-field-error">{keyError}</p> : null}
        <div className="skill-integration-actions"><Button disabled={saving || disabled} onClick={() => void saveKey()}>保存标识</Button>
          <Button variant="outline" disabled={saving} onClick={() => { setEditing(false); setKeyError(""); }}>取消编辑</Button></div>
      </div> : null}
      {dirty ? <p>请先保存草稿，再修改技能标识。</p> : null}
      <div><label htmlFor={`${id}-endpoint`}>上传地址</label><div className="skill-integration-actions"><Input id={`${id}-endpoint`} readOnly value={examples.endpoint} /><Button variant="outline" onClick={() => void copy(examples.endpoint, "上传地址")}>复制上传地址</Button></div></div>
      <p>先将访问令牌设为 WISEEFF_TOKEN；示例仅包含令牌占位符和示例日志。</p>
      {([['json', '单文件 JSON / Base64'], ['multipart', '多文件表单']] as const).map(([kind, label]) => <details key={kind}><summary>{label}</summary>
        <pre className="skill-curl-example"><code>{examples[kind].curl}</code></pre>
        <Button variant="outline" onClick={() => void copy(examples[kind].curl, label)}>复制{label}命令</Button>
      </details>)}
      {copyStatus ? <p role="status">{copyStatus}</p> : null}
    </section>
    <section aria-label="结果回调"><h3>结果回调</h3>
      {loading ? <SectionSkeleton label="正在加载回调配置" /> : loadError ? <SectionError message="无法加载回调配置" onRetry={() => setReload((value) => value + 1)} />
        : domain && webhookRepository ? <SkillWebhookEditor key={domain.id} domain={domain} logActions={webhookRepository} disabled={disabled}
          onSaved={async () => undefined} /> : <p>{apiMode ? "当前无法加载回调配置。" : "请在 API 模式下配置结果回调。"}</p>}
    </section>
    <section aria-label="模型与预算"><h3>模型与预算</h3><p>模型和预算随技能草稿保存并发布；留空使用平台默认值。</p>
      <p>令牌预算按模型报告的累计用量计算，每次模型调用前检查；单次调用可能使累计用量超过预算，超出量最多为该次补全的用量。</p>
      <label>模型覆盖<Input maxLength={200} disabled={disabled} value={spec.modelOverride ?? ""} placeholder="使用平台默认模型"
        onChange={(event) => { const next = { ...spec }; if (event.target.value) next.modelOverride = event.target.value; else delete next.modelOverride; setSpec(next); }} /></label>
      {([['stepBudget', '步骤预算'], ['tokenBudget', '令牌预算']] as const).map(([field, label]) => <div key={field}><label>{label}<Input type="number" min={field === "tokenBudget" ? Math.min(4096, skill.budgetCaps?.tokenBudget ?? 4096) : 1} step={1}
        max={skill.budgetCaps?.[field]} disabled={disabled} value={spec[field] ?? ""} placeholder="使用平台默认预算"
        aria-invalid={!!fieldErrors?.[field]} aria-describedby={`skill-${field}-help${fieldErrors?.[field] ? ` skill-${field}-error` : ""}`}
        onChange={(event) => { const next = { ...spec }; if (event.target.value) next[field] = Number(event.target.value); else delete next[field]; setSpec(next); }} /></label>
        <p id={`skill-${field}-help`}>最小值：{field === "tokenBudget" ? Math.min(4096, skill.budgetCaps?.tokenBudget ?? 4096) : 1}；{skill.budgetCaps ? `平台上限：${skill.budgetCaps[field]}` : "由服务器校验平台预算上限。"}</p>
        {fieldErrors?.[field] ? <p id={`skill-${field}-error`} role="alert" className="skill-field-error">{fieldErrors[field]}</p> : null}
      </div>)}
    </section>
  </div>;
}
