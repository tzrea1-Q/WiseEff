import { useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from "react";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { SectionEmpty, SectionError, SectionSkeleton } from "@/components/common/SectionState";
import { Button } from "@/components/ui/button";
import { mockSkillSample } from "@/infrastructure/mock/logSkills";
import { formatBytes } from "@/domain/format/formatBytes";
import type { SkillAuthoringRepository, SkillSample, SkillSpec, ParsePreview } from "./types";

function extractorColor(index: number): CSSProperties {
  // The schema caps extractors at 200; mix adjacent categorical tokens without repeating a color.
  return { "--extractor-color": `color-mix(in srgb, var(--chart-${index % 5 + 1}) ${50 + Math.floor(index / 5)}%, var(--chart-${(index + 1) % 5 + 1}))` } as CSSProperties;
}

export function SkillSamplePane({ skillId, repository, apiMode, canEdit, onSampleChange, highlightedLine, highlightRequest, selectedLine, onLineSelect, extractors, highlightPreview, highlightError }: {
  skillId: string; repository?: Partial<SkillAuthoringRepository>; apiMode: boolean; canEdit: boolean;
  onSampleChange?: (sample: SkillSample | null) => void;
  highlightedLine?: number | null;
  highlightRequest?: number;
  selectedLine?: number | null; onLineSelect?: (line: number) => void;
  extractors?: NonNullable<SkillSpec["parsing"]>["extractors"]; highlightPreview?: ParsePreview; highlightError?: string;
}) {
  const [sample, setSample] = useState<SkillSample | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const highlightedRef = useRef<HTMLElement>(null);
  useEffect(() => { highlightedRef.current?.scrollIntoView?.({ block: "nearest", inline: "nearest" }); }, [highlightedLine, highlightRequest, sample]);
  const disabled = !apiMode || !canEdit || pending;
  const matches = useMemo(() => {
    const map = new Map<number, string[]>();
    for (const event of highlightPreview?.events ?? []) {
      for (let line = event.line; line <= (event.endLine ?? event.line); line++) {
        const ids = map.get(line) ?? []; if (!ids.includes(event.extractor)) ids.push(event.extractor); map.set(line, ids);
      }
    }
    return map;
  }, [highlightPreview]);
  useEffect(() => {
    let active = true;
    setLoading(true); setLoadError(false);
    const load = apiMode ? repository?.getSkillSample?.(skillId) ?? Promise.reject(new Error("unavailable"))
      : Promise.resolve(skillId === mockSkillSample.skillId ? mockSkillSample : null);
    void load.then((item) => { if (active) setSample(item); }).catch(() => { if (active) setLoadError(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [skillId, repository, apiMode, attempt]);
  useEffect(() => {
    if (!loading && !loadError) onSampleChange?.(sample);
  }, [sample, loading, loadError, onSampleChange]);
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
        {extractors?.length ? <>
          <ul className="skill-extractor-legend" aria-label="抽取器高亮图例">{extractors.map((extractor, index) => <li key={extractor.id} style={extractorColor(index)}>
            <span className="skill-extractor-swatch" aria-hidden="true" /><span>{extractor.id} · {highlightPreview ? `${highlightPreview.counts.byExtractor[extractor.id] ?? 0} 次命中` : "等待预览"}</span>
          </li>)}</ul>
          <p>匹配行标注抽取器标识；重叠匹配显示全部标识。{highlightPreview?.truncated ? "预览已达上限，仅高亮返回的匹配行（最多 500 个事件）。" : ""}</p>
          {highlightError ? <p role="alert">{highlightError}</p> : null}
        </> : null}
        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- The read-only log viewer needs focus for keyboard scrolling. */}
        <div className="skill-sample-content" data-sample-scroll role="region" aria-label="样例内容" tabIndex={0}>
          {(sample.content ? sample.content.replace(/(?:\r\n|\n|\r)$/, "").split(/\r\n|\n|\r/) : []).map((line, index) => {
            const ids = matches.get(index + 1) ?? [], colorIndex = extractors?.findIndex((extractor) => extractor.id === ids[0]) ?? -1;
            const labels = ids.length ? <span className="skill-extractor-matches">{ids.map((id) => <span key={id} style={extractorColor(extractors?.findIndex((extractor) => extractor.id === id) ?? 0)}>{id}</span>)}</span> : null;
            return onLineSelect ? <button type="button" className="skill-sample-line skill-sample-line--selectable" key={index}
            ref={highlightedLine === index + 1 ? highlightedRef as RefObject<HTMLButtonElement | null> : undefined} data-highlighted={highlightedLine === index + 1 || undefined}
            data-extractor-match={ids.length ? "true" : undefined} style={colorIndex >= 0 ? extractorColor(colorIndex) : undefined}
            aria-label={`选择样例第 ${index + 1} 行：${line}${ids.length ? `；匹配抽取器 ${ids.join("、")}` : ""}`} aria-pressed={selectedLine === index + 1} onClick={() => onLineSelect(index + 1)}>
            <span aria-hidden="true">{index + 1}</span><code>{line || "\u00a0"}</code>{labels}</button> : <div className="skill-sample-line" key={index}
              ref={highlightedLine === index + 1 ? highlightedRef as RefObject<HTMLDivElement | null> : undefined} data-highlighted={highlightedLine === index + 1 || undefined}
              data-extractor-match={ids.length ? "true" : undefined} style={colorIndex >= 0 ? extractorColor(colorIndex) : undefined}>
              <span aria-hidden="true">{index + 1}</span><code>{line || "\u00a0"}</code>{labels}</div>;
          })}
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
