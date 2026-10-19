import { useEffect, useId, useRef, useState } from "react";
import { DataTable } from "@/components/admin/DataTable";
import { SelectControl } from "@/components/common/SelectControl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatProfileCode, parseFormatProfileCode, type FormatProfile } from "./formatProfileFields";
import type { FormatPreview, SkillSample, SkillSpec, SkillWorkspaceRepository } from "./types";
import "./format-profile-form.css";

const levels = ["error", "warn", "info"] as const;
const levelNames = { error: "错误", warn: "警告", info: "信息" };

export function FormatProfileForm({ skillId, profile, onChange, disabled = false, repository, sample, previewEnabled = true, onValidityChange, externalError }: {
  skillId: string; profile: SkillSpec["formatProfile"]; onChange: (profile: SkillSpec["formatProfile"]) => void; disabled?: boolean;
  repository?: Partial<SkillWorkspaceRepository>; sample?: SkillSample | null; previewEnabled?: boolean; onValidityChange?: (valid: boolean) => void; externalError?: string | null;
}) {
  const id = useId();
  const [codeView, setCodeView] = useState(false);
  const [code, setCode] = useState(() => formatProfileCode(profile));
  const [sampleText, setSampleText] = useState("");
  const [preview, setPreview] = useState<FormatPreview | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [pending, setPending] = useState(false);
  const emitted = useRef(formatProfileCode(profile));
  const parsed = parseFormatProfileCode(code);
  const valid = !parsed.error;
  const activeProfile = parsed.profile ?? {};
  useEffect(() => {
    const incoming = formatProfileCode(profile);
    if (incoming !== emitted.current) { emitted.current = incoming; setCode(incoming); }
  }, [profile]);
  useEffect(() => { onValidityChange?.(valid); }, [valid, onValidityChange]);
  useEffect(() => {
    let active = true;
    setPreview(null); setPreviewError("");
    if (!previewEnabled || !valid || !repository?.previewFormat) { setPending(false); return; }
    setPending(true);
    const timer = setTimeout(() => {
      const lines: string[] = []; let bytes = 0;
      for (const line of (sample?.content ?? sampleText).split(/\r\n|\n|\r/).slice(0, 500)) {
        bytes += new TextEncoder().encode(line).length + 1;
        if (bytes > 1024 * 1024) break;
        lines.push(line);
      }
      void repository.previewFormat!(skillId, { formatProfile: parseFormatProfileCode(code).profile ?? {}, sampleText: lines.join("\n") }).then((result) => {
        if (active) setPreview(result);
      }).catch(() => { if (active) setPreviewError("基础格式预览失败；请检查样例与格式后重试。"); })
        .finally(() => { if (active) setPending(false); });
    }, 200);
    return () => { active = false; clearTimeout(timer); };
  }, [code, valid, repository, skillId, sample, sampleText, previewEnabled]); // Code is the live draft, including invalid input.
  const updateCode = (next: string) => {
    setCode(next); setPreview(null);
    const result = parseFormatProfileCode(next);
    onValidityChange?.(!result.error);
    if (!result.error) { emitted.current = formatProfileCode(result.profile); onChange(result.profile); }
  };
  const update = (next: FormatProfile) => updateCode(formatProfileCode(next));
  // Invalid patterns still need editable form fields; preserve their draft object.
  let formProfile = activeProfile;
  let readableCode = true;
  try { if (code.trim()) formProfile = JSON.parse(code) as FormatProfile; } catch { readableCode = false; }
  const formShape = readableCode && formProfile && typeof formProfile === "object" && !Array.isArray(formProfile)
    && (formProfile.timestampPattern === undefined || typeof formProfile.timestampPattern === "string")
    && (formProfile.multiline === undefined || ["start-pattern", "indent"].includes(formProfile.multiline?.mode))
    && (formProfile.severityMap === undefined || formProfile.severityMap !== null && typeof formProfile.severityMap === "object" && !Array.isArray(formProfile.severityMap)
      && levels.every((level) => formProfile.severityMap?.[level] === undefined || Array.isArray(formProfile.severityMap?.[level]) && formProfile.severityMap[level]!.every((pattern) => typeof pattern === "string")));
  return <section className="skill-format-form" aria-label="基础格式">
    <div className="skill-format-toolbar"><h3>基础格式</h3><Button type="button" variant="outline" size="sm" disabled={!formShape && codeView} onClick={() => setCodeView(!codeView)}>{codeView ? "返回格式表单" : "基础格式代码视图"}</Button></div>
    <p>时间戳取第一个捕获组（没有捕获组时取整个匹配）；级别按错误、警告、信息顺序取首次命中。多行合并保留原始行号。</p>
    {codeView ? <label>基础格式 JSON<Textarea value={code} spellCheck={false} disabled={disabled} aria-invalid={!valid || !!externalError} aria-describedby={!valid || externalError ? `${id}-error` : undefined} onChange={(event) => updateCode(event.target.value)} /></label> : <>
      <label>时间戳模式<Input value={formProfile.timestampPattern ?? ""} disabled={disabled} aria-invalid={!valid} onChange={(event) => {
        const next = { ...formProfile }; if (event.target.value) next.timestampPattern = event.target.value; else delete next.timestampPattern; update(next);
      }} placeholder={'^\\[(\\d+\\.\\d+)\\]'} /></label>
      <fieldset disabled={disabled}><legend>级别映射</legend>
        {levels.map((level) => <div className="skill-format-level" key={level}><strong>{levelNames[level]} · {level}</strong>
          {(formProfile.severityMap?.[level] ?? []).map((pattern, index) => <div className="skill-format-row" key={index}><Input aria-label={`${level} 模式 ${index + 1}`} value={pattern} aria-invalid={!valid} disabled={disabled} onChange={(event) => {
            const patterns = [...(formProfile.severityMap?.[level] ?? [])]; patterns[index] = event.target.value; update({ ...formProfile, severityMap: { ...formProfile.severityMap, [level]: patterns } });
          }} /><Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => {
            const patterns = [...(formProfile.severityMap?.[level] ?? [])]; patterns.splice(index, 1); update({ ...formProfile, severityMap: { ...formProfile.severityMap, [level]: patterns } });
          }} aria-label={`删除 ${level} 模式 ${index + 1}`}>删除</Button></div>)}
          <Button type="button" variant="outline" size="sm" disabled={disabled || (formProfile.severityMap?.[level]?.length ?? 0) >= 32} onClick={() => update({ ...formProfile, severityMap: { ...formProfile.severityMap, [level]: [...(formProfile.severityMap?.[level] ?? []), ""] } })}>添加 {level} 模式</Button>
        </div>)}
      </fieldset>
      <label htmlFor={`${id}-multiline`}>多行规则</label><SelectControl id={`${id}-multiline`} ariaLabel="多行规则" value={formProfile.multiline?.mode ?? "none"} disabled={disabled} options={[{ value: "none", label: "不合并" }, { value: "indent", label: "缩进行接续上一条" }, { value: "start-pattern", label: "匹配起始模式时新建条目" }]} onValueChange={(value) => {
        const next = { ...formProfile }; if (value === "none") delete next.multiline; else next.multiline = value === "indent" ? { mode: "indent" } : { mode: "start-pattern", startPattern: "" }; update(next);
      }} />
      {formProfile.multiline?.mode === "start-pattern" ? <label>条目起始模式<Input value={formProfile.multiline.startPattern ?? ""} disabled={disabled} aria-invalid={!valid} onChange={(event) => update({ ...formProfile, multiline: { mode: "start-pattern", startPattern: event.target.value } })} /></label> : null}
    </>}
    {parsed.error || externalError ? <p id={`${id}-error`} role="alert">{parsed.error || externalError}</p> : null}
    {!sample ? <label>基础格式样例<Textarea value={sampleText} maxLength={1024 * 1024} placeholder="粘贴日志，实时查看时间戳、级别与多行分组。" onChange={(event) => setSampleText(event.target.value)} /></label> : <p>实时预览样例：{sample.contentFilePath ?? sample.fileName}{!previewEnabled ? " · 未匹配技能，不运行基础格式预览。" : ""}</p>}
    {repository?.previewFormat ? <p>实时预览限前 500 行、1 MiB；单行最多 6144 字符。</p> : null}
    {pending ? <p role="status">基础格式预览中…</p> : null}
    {previewError ? <p role="alert">{previewError}</p> : null}
    {!repository?.previewFormat ? <p>保存时将校验基础格式；在技能工作区可使用样例实时预览。</p> : null}
    {preview ? <><DataTable fluid ariaLabel="基础格式逐行预览" rows={preview.lines} rowKey={(line) => String(line.line)} columns={[
      { key: "line", header: "行", render: (line) => line.line }, { key: "timestamp", header: "时间戳", render: (line) => line.timestamp ?? "—" },
      { key: "severity", header: "级别", render: (line) => `${levelNames[line.severity]} · ${line.severity}` }, { key: "text", header: "样例", render: (line) => <code>{line.text}</code> }
    ]} emptyMessage="样例没有可解析的非空行。" />
      <DataTable fluid ariaLabel="基础格式条目分组" rows={preview.entries} rowKey={(entry) => entry.lineNumbers.join(",")} columns={[
        { key: "lines", header: "原始行", render: (entry) => entry.lineNumbers.join(", ") }, { key: "text", header: "合并后的条目", render: (entry) => <pre>{entry.text}</pre> }
      ]} emptyMessage="暂无合并条目。" /></> : null}
  </section>;
}
