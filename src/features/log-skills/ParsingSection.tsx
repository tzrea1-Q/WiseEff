import { useEffect, useId, useMemo, useRef, useState } from "react";
import { parseDocument, stringify } from "yaml";
import { parsingSpecSchema, logSkillSpecSchema } from "@wiseeff/dto-schemas";
import { matchSkillFile } from "@/domain/logs/fileApplicability";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { ViewSwitch } from "@/components/ui/view-switch";
import { TabPanel } from "@/components/ui/tab-panel";
import { ExtractorBuilder } from "./ExtractorBuilder";
import { FormatProfileForm } from "./FormatProfileForm";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { decodedValueText } from "@/features/log-analysis/DecodedFields";
import type { ParsePreview, SkillWorkspaceRepository, SkillSample, SkillSpec } from "./types";

export function parseParsingYaml(text: string): { value?: unknown; error?: string } {
  const document = parseDocument(text, { uniqueKeys: true });
  if (document.errors.length) return { error: document.errors.map((error) => `第 ${error.linePos?.[0].line ?? 1} 行：${error.message}`).join("\n") };
  try { return { value: document.toJS({ maxAliasCount: 0 }) }; }
  catch (error) { return { error: `第 1 行：${error instanceof Error ? error.message : String(error)}` }; }
}

export function boundedSamplePreview(content: string) {
  const bytes = new TextEncoder().encode(content);
  if (bytes.length <= 1024 * 1024) return { content, truncated: false };
  const prefix = new TextDecoder().decode(bytes.subarray(0, 1024 * 1024));
  return { content: prefix.slice(0, Math.max(0, prefix.lastIndexOf("\n"))), truncated: true };
}

export function ParsingSection({ skillId, yaml, onChange, disabled, repository, sample, files, selectedLine, onLineSelect, profile, onProfileChange, onProfileValidityChange }: {
  skillId: string; yaml: string; onChange: (text: string) => void; disabled: boolean; repository?: Partial<SkillWorkspaceRepository>;
  sample?: SkillSample | null; files?: SkillSpec["files"];
  selectedLine?: number | null; onLineSelect?: (line: number) => void;
  profile?: SkillSpec["formatProfile"]; onProfileChange?: (profile: SkillSpec["formatProfile"]) => void; onProfileValidityChange?: (valid: boolean) => void;
}) {
  const id = useId();
  const [view, setView] = useState("form");
  const [sampleText, setSampleText] = useState("");
  const [fileName, setFileName] = useState("sample.log");
  const [result, setResult] = useState<ParsePreview | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const sampleEdited = useRef(false);
  const generation = useRef(0);
  const parsed = parseParsingYaml(yaml);
  const previewPath = sample?.contentFilePath ?? sample?.fileName ?? fileName;
  const filesValid = logSkillSpecSchema.safeParse({ schemaVersion: "skill/v1", files }).success;
  const skillMatched = filesValid && matchSkillFile(files, previewPath).skillMatched;
  const validation = parsingSpecSchema.safeParse(parsed.value);
  const storedPreview = useMemo(() => boundedSamplePreview(sample?.content ?? ""), [sample]);
  useEffect(() => {
    // The workspace owns the shared pane's sample; standalone callers can still
    // prefill their fallback input through the older optional adapter.
    if (sample !== undefined) return;
    let active = true;
    void repository?.getSkillSampleText?.(skillId).then((sample) => {
      if (active && sample && !sampleEdited.current) { setSampleText(sample.text); setFileName(sample.fileName ?? "sample.log"); }
    }).catch(() => { if (active) setError("无法读取已保存样例；可直接粘贴样例运行预览。"); });
    return () => { active = false; generation.current++; };
  }, [repository, skillId, sample]);
  useEffect(() => { generation.current++; setResult(null); setPending(false); }, [sample, files]);
  const invalidate = () => { generation.current++; setResult(null); setPending(false); };
  return <section className="skill-section" aria-label="样例与解析"><h2>样例与解析</h2>
    <ViewSwitch variant="tabs" ariaLabel="解析视图" value={view} onValueChange={setView} items={[
      { value: "form", label: "表单", id: `${id}-form`, panelId: `${id}-form-panel` },
      { value: "code", label: "代码视图", id: `${id}-code`, panelId: `${id}-code-panel` }
    ]} />
    <TabPanel id={`${id}-form-panel`} aria-labelledby={`${id}-form`} hidden={view !== "form"}>
      {onProfileChange ? <FormatProfileForm skillId={skillId} profile={profile} onChange={onProfileChange} disabled={disabled} repository={repository} sample={sample}
        previewEnabled={skillMatched} onValidityChange={onProfileValidityChange} /> : null}
      <ExtractorBuilder skillId={skillId} parsing={validation.success ? validation.data : null} onChange={(value) => { invalidate(); onChange(stringify(value)); }}
        disabled={disabled} repository={repository} sampleText={sample ? storedPreview.content : sampleText} selectedLine={selectedLine} onLineSelect={onLineSelect} timestampPattern={profile?.timestampPattern} />
    </TabPanel>
    <TabPanel id={`${id}-code-panel`} aria-labelledby={`${id}-code`} hidden={view !== "code"}>
    <label htmlFor="parsing-yaml">代码视图 · YAML</label>
    <div className="skill-yaml-editor">
      <pre aria-hidden="true">{yaml.split("\n").map((_, i) => i + 1).join("\n")}</pre>
      <Textarea id="parsing-yaml" spellCheck={false} wrap="off" disabled={disabled} value={yaml} aria-invalid={!!parsed.error}
        aria-describedby={parsed.error ? "parsing-yaml-error" : undefined} onScroll={(event) => {
          const gutter = event.currentTarget.previousElementSibling; if (gutter) gutter.scrollTop = event.currentTarget.scrollTop;
        }} onChange={(event) => { invalidate(); onChange(event.target.value); }} />
    </div>
    </TabPanel>
    {parsed.error ? <p id="parsing-yaml-error" role="alert">{parsed.error}</p> : null}
    <section aria-label="预览"><h3>预览</h3>
      {sample ? <p>使用右侧样例日志：{previewPath}{storedPreview.truncated ? "；仅预览 1 MiB 内的完整行。" : ""}</p> : <>
        <label>文件名<Input value={fileName} disabled={pending} onChange={(event) => { sampleEdited.current = true; invalidate(); setFileName(event.target.value); }} /></label>
        <label>样例文本<Textarea value={sampleText} placeholder="暂无样例；粘贴日志后运行预览。" className="font-mono" onChange={(event) => { sampleEdited.current = true; invalidate(); setSampleText(event.target.value); }} /></label>
      </>}
      {!filesValid ? <p>请先修正适用文件规则。</p> : !skillMatched ? <p>此文件未匹配技能，仅通用分析；不会运行技能抽取或解码。</p> : null}
      <Button disabled={disabled || pending || !!parsed.error || !repository?.parsePreview || !skillMatched} aria-busy={pending} onClick={async () => {
        const request = ++generation.current; setPending(true); setError("");
        try { const preview = await repository!.parsePreview!(skillId, { parsing: parsed.value ?? null,
          sampleText: sample ? storedPreview.content : sampleText, fileName: previewPath }); if (request === generation.current) setResult(preview); }
        catch { if (request === generation.current) setError("预览失败，请检查样例不超过 1 MiB 后重试。"); }
        finally { if (request === generation.current) setPending(false); }
      }}>{pending ? "预览中…" : "运行预览"}</Button>
      {error ? <p role="alert">{error}</p> : null}
      {result ? <>
        {result.truncated ? <p role="status">{result.reason === "time_cap" ? "预览达到 100 ms 时间上限，已返回完成的部分。"
          : result.reason === "output_field_cap" ? "预览达到 32768 个解码字段上限，已返回完成的部分。"
          : result.reason === "output_byte_cap" ? "预览达到 4 MiB 解码输出上限，已返回完成的部分。"
          : result.reason === "line_cap" ? "预览仅处理前 5000 行。" : "预览仅显示前 500 个事件。"}</p> : null}
        {result.issues.length ? <ul role="alert">{result.issues.map((issue, i) => <li key={i}>{issue.path.join(".")}：{issue.message}</li>)}</ul> : null}
        <p>事件 {result.counts.total} · 未匹配行 {result.unmatchedLineCount} · 解码错误 {Object.values(result.counts.errors).reduce((sum, count) => sum + count, 0)}{result.counts.total > 500 ? " · 仅显示前 500 条" : ""}</p>
        <p>{Object.entries(result.counts.byExtractor).map(([id, count]) => `${id}: ${count}`).join(" · ")}</p>
        <Table aria-label="解析预览结果"><TableHeader><TableRow><TableHead>行号</TableHead><TableHead>抽取规则</TableHead><TableHead>字段</TableHead></TableRow></TableHeader>
          <TableBody>{result.events.map((event, i) => <TableRow key={i}><TableCell>{event.line}{event.endLine ? `–${event.endLine}` : ""}</TableCell><TableCell>{event.extractor}</TableCell>
            <TableCell>{Object.entries(event.fields).map(([name, value]) => `${name} = ${decodedValueText(value)}`).join(" · ")}
              {event.errors?.map((issue, j) => <p key={j}>{issue.field} · {issue.code}: {issue.message}</p>)}</TableCell></TableRow>)}</TableBody></Table>
        {!result.events.length ? <p>未抽取到事件；请检查文件名和规则。</p> : null}
      </> : null}
    </section>
  </section>;
}
