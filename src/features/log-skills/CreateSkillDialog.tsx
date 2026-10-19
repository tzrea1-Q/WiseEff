import { useEffect, useRef, useState } from "react";
import { ModalDialog } from "@/components/common/ModalDialog";
import { SelectControl } from "@/components/common/SelectControl";
import { SectionError, SectionSkeleton } from "@/components/common/SectionState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import { mockSkillTemplates } from "@/infrastructure/mock/logSkills";
import type { LogDomain } from "@/domain/logs/types";
import type { SkillAuthoringRepository, SkillTemplate } from "./types";
import "./skill-workspace.css";

export function CreateSkillDialog({ repository, apiMode, skills, onDismiss, onNavigate }: {
  repository?: Partial<SkillAuthoringRepository>; apiMode: boolean; skills: LogDomain[];
  onDismiss: () => void; onNavigate: (path: string) => void;
}) {
  const [templates, setTemplates] = useState<SkillTemplate[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [start, setStart] = useState("generic-text");
  const [copyId, setCopyId] = useState("");
  const [sample, setSample] = useState<File>();
  const [createdId, setCreatedId] = useState<string>();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let active = true;
    setLoadError(false);
    const load = apiMode ? repository?.listSkillTemplates?.() ?? Promise.reject(new Error("unavailable")) : Promise.resolve(mockSkillTemplates);
    void load.then((items) => { if (active) setTemplates(items); }).catch(() => { if (active) setLoadError(true); });
    return () => { active = false; };
  }, [apiMode, repository, attempt]);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!apiMode || pending) return;
    if (!name.trim()) { setError("请输入名称。"); nameRef.current?.focus(); return; }
    if (start === "copy" && !copyId) { setError("请选择要复制的技能。"); return; }
    if (sample && sample.size > 2 * 1024 * 1024) { setError("样例日志不能超过 2 MiB。"); return; }
    setPending(true); setError("");
    let id = createdId;
    try {
      if (!id) {
        const skill = await repository!.createLogSkill!({ name: name.trim(), ...(description.trim() ? { description: description.trim() } : {}),
          startingPoint: start === "copy" ? { copyFromSkillId: copyId } : { templateId: start } });
        id = skill.id; setCreatedId(id);
      }
      if (sample) await repository!.replaceSkillSample!(id, sample);
      onNavigate(`/log-admin/skills/${encodeURIComponent(id)}`); onDismiss();
    } catch (cause) {
      setError(id ? "技能已创建，样例上传失败。请重试，或移除文件后打开技能。"
        : cause instanceof WiseEffApiError && cause.code === "CONFLICT" ? "已存在同名技能" : "创建技能失败，请重试。");
    } finally { setPending(false); }
  };
  return <ModalDialog open onDismiss={pending ? undefined : onDismiss} initialFocusRef={nameRef} className="skill-authoring-dialog modal-card--md">
    {({ titleId }) => <form onSubmit={(event) => void submit(event)} noValidate>
      <h2 id={titleId}>新建技能</h2>
      <div className="grid gap-2"><Label htmlFor="create-skill-name">名称</Label><Input id="create-skill-name" ref={nameRef} required maxLength={120} value={name} disabled={pending || !!createdId}
        aria-invalid={error.includes("名称") || error === "已存在同名技能" || undefined} aria-describedby={error ? "create-skill-error" : undefined}
        onChange={(e) => setName(e.target.value)} /></div>
      <div className="grid gap-2"><Label htmlFor="create-skill-description">描述（可选）</Label><Textarea id="create-skill-description" rows={2} maxLength={2000} value={description} disabled={pending || !!createdId} onChange={(e) => setDescription(e.target.value)} /></div>
      {loadError ? <SectionError message="无法加载技能模板" onRetry={() => setAttempt((n) => n + 1)} /> : !templates ? <SectionSkeleton label="正在加载技能模板" />
        : <fieldset disabled={pending || !!createdId}><legend className="text-sm font-medium">起点</legend>
          <div className="skill-template-grid">
          {[...templates, { id: "copy", label: "复制已有技能", description: "复制草稿，若无草稿则复制当前发布版本。" }].map((item) =>
            <label key={item.id} className="skill-template-choice"><input type="radio" name="skill-start" value={item.id} checked={start === item.id} onChange={() => setStart(item.id)} />
              <span><strong>{item.label}</strong><small title={item.description}>{item.description}</small></span></label>)}
          </div>
          {start === "copy" ? <div className="grid gap-2"><Label htmlFor="create-skill-source">来源技能</Label><SelectControl id="create-skill-source" ariaLabel="来源技能" value={copyId} onValueChange={setCopyId} placeholder="请选择技能" disabled={pending || !!createdId}
            options={skills.map((skill) => ({ value: skill.id, label: skill.name }))} />{!skills.length ? <small>当前没有可复制的技能。</small> : null}</div> : null}
        </fieldset>}
      <div className="grid gap-2"><Label htmlFor="create-skill-sample">样例日志（可选）</Label><Input id="create-skill-sample" ref={fileRef} type="file" aria-describedby="create-skill-sample-hint" disabled={pending} onChange={(e) => setSample(e.target.files?.[0])} />
        <small id="create-skill-sample-hint" className="text-muted-foreground">请选择一个文本文件，最大 2 MiB。</small>
        {sample ? <div className="flex items-center gap-2 text-sm"><span className="min-w-0 break-all">{sample.name}</span>
          <Button type="button" variant="link" size="sm" disabled={pending} onClick={() => { setSample(undefined); if (fileRef.current) fileRef.current.value = ""; }}>移除已选样例</Button></div> : null}
      </div>
      {!apiMode ? <p>演示模式仅供查看，请在 API 模式下新建技能。</p> : null}
      {error ? <p id="create-skill-error" role="alert">{error}</p> : null}
      <div className="dialog-actions"><Button type="button" variant="outline" disabled={pending} onClick={onDismiss}>取消</Button>
        <Button type="submit" disabled={!apiMode || pending || !templates || loadError} aria-busy={pending}>{pending ? "创建中…" : createdId ? "打开技能" : "创建技能"}</Button></div>
    </form>}
  </ModalDialog>;
}
