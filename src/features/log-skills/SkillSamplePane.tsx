import { useEffect, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { SectionEmpty, SectionError, SectionSkeleton } from "@/components/common/SectionState";
import { Button } from "@/components/ui/button";
import { mockSkillSample } from "@/infrastructure/mock/logSkills";
import { formatBytes } from "@/domain/format/formatBytes";
import type { SkillAuthoringRepository, SkillSample } from "./types";

export function SkillSamplePane({ skillId, repository, apiMode, canEdit }: {
  skillId: string; repository?: Partial<SkillAuthoringRepository>; apiMode: boolean; canEdit: boolean;
}) {
  const [sample, setSample] = useState<SkillSample | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const disabled = !apiMode || !canEdit || pending;
  useEffect(() => {
    let active = true;
    setLoading(true); setLoadError(false);
    const load = apiMode ? repository?.getSkillSample?.(skillId) ?? Promise.reject(new Error("unavailable"))
      : Promise.resolve(skillId === mockSkillSample.skillId ? mockSkillSample : null);
    void load.then((item) => { if (active) setSample(item); }).catch(() => { if (active) setLoadError(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [skillId, repository, apiMode, attempt]);
  const upload = async (file: File) => {
    if (disabled) return;
    if (file.size > 2 * 1024 * 1024) { setError("样例日志不能超过 2 MiB。"); return; }
    setPending(true); setError("");
    try { await repository!.replaceSkillSample!(skillId, file); setSample(await repository!.getSkillSample!(skillId)); }
    catch { setError("上传失败，请选择不超过 2 MiB 的文本文件后重试。"); }
    finally { setPending(false); }
  };
  return <div className="skill-sample-pane" aria-busy={pending}>
    <h2>样例日志</h2>
    <input ref={fileRef} type="file" aria-label="选择样例日志" hidden disabled={disabled} onChange={(event) => {
      const file = event.target.files?.[0]; event.target.value = ""; if (file) void upload(file);
    }} />
    {!apiMode ? <p>演示样例仅供查看。</p> : !canEdit ? <p>上传和删除需要技能管理权限。</p> : null}
    {error && !confirm ? <p role="alert">{error}</p> : null}
    {loading ? <SectionSkeleton label="正在加载样例日志" /> : loadError ? <SectionError message="无法加载样例日志" onRetry={() => setAttempt((n) => n + 1)} />
      : sample ? <>
        <header><div className="skill-sample-file"><strong>{sample.fileName}</strong><p>{formatBytes(sample.sizeBytes)} · {sample.lineCount.toLocaleString("zh-CN")} 行</p></div>
          <div className="dialog-actions"><Button variant="outline" size="sm" disabled={disabled} onClick={() => fileRef.current?.click()}>替换样例</Button>
            <Button variant="outline" size="sm" disabled={disabled} onClick={() => { setError(""); setConfirm(true); }}>删除样例</Button></div></header>
        {sample.truncated ? <p>仅显示前 5000 行</p> : null}
        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- The read-only log viewer needs focus for keyboard scrolling. */}
        <div className="skill-sample-content" data-sample-scroll role="region" aria-label="样例内容" tabIndex={0}>
          {sample.content.split("\n").map((line, index) => <div className="skill-sample-line" key={index}>
            <span aria-hidden="true">{index + 1}</span><code>{line || "\u00a0"}</code></div>)}
        </div>
      </> : <><SectionEmpty message="上传样例日志，后续解析与信号规则会用它实时预览。" />
        <Button variant="outline" disabled={disabled} onClick={() => fileRef.current?.click()}>上传样例日志</Button></>}
    <ConfirmDialog open={confirm} title="删除样例日志？" description="删除后，后续预览需要重新上传样例。技能版本不受影响。" confirmLabel="删除样例" pending={pending} tone="danger" error={error}
      onCancel={() => setConfirm(false)} onConfirm={() => {
        setPending(true); setError("");
        void repository!.deleteSkillSample!(skillId).then(() => { setSample(null); setConfirm(false); })
          .catch(() => setError("删除失败，请重试。")).finally(() => setPending(false));
      }} />
  </div>;
}
