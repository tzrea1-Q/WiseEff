import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { parsingSpecSchema } from "@wiseeff/dto-schemas";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { ModalDialog } from "@/components/common/ModalDialog";
import { SelectControl } from "@/components/common/SelectControl";
import { DataTable } from "@/components/admin/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { SkillSpec, SkillWorkspaceRepository } from "./types";

type Parsing = NonNullable<SkillSpec["parsing"]>;
type Extractor = Parsing["extractors"][number];
type Request = Parameters<NonNullable<SkillWorkspaceRepository["generateExtractorPattern"]>>[1];
type Preview = Awaited<ReturnType<NonNullable<SkillWorkspaceRepository["generateExtractorPattern"]>>>;
type Segment = Request["segments"][number];
type Token = { start: number; end: number; valueStart: number; text: string; name?: string };

/** Keep key=value and quoted values together while exposing punctuation boundaries. */
export function extractorTokens(line: string): Token[] {
  return Array.from(line.matchAll(/[A-Za-z_][\w.-]*=(?:"[^"]*"|[^\s,;\]\)]+)|"[^"]*"|[+-]?(?:0x[\da-fA-F]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|[^\s\w]|[\w]+/g), (match) => {
    const pair = /^([A-Za-z_][\w.-]*)=/.exec(match[0]);
    return { start: match.index!, end: match.index! + match[0].length, valueStart: match.index! + (pair?.[0].length ?? 0), text: match[0], name: pair?.[1].replace(/[^\w]/g, "_") };
  });
}

function segmentType(value: string): Segment["type"] {
  return /^".*"$/.test(value) ? "quoted" : /^0x[\da-f]+$/i.test(value) ? "hex" : /^\d+$/.test(value) ? "uint"
    : /^[+-]?\d+$/.test(value) ? "int" : /^[+-]?(?:\d+\.\d*|\.\d+|\d+[eE][+-]?\d+)$/.test(value) ? "float" : "string";
}

export function ExtractorBuilder({ skillId, parsing, onChange, disabled, repository, sampleText, selectedLine, timestampPattern }: {
  skillId: string; parsing: Parsing | null; onChange: (value: Parsing) => void; disabled: boolean;
  repository?: Partial<SkillWorkspaceRepository>; sampleText: string; selectedLine?: number | null; onLineSelect?: (line: number) => void;
  timestampPattern?: string;
}) {
  const lines = useMemo(() => sampleText.split(/\r?\n/), [sampleText]);
  const lineNumber = Math.min(lines.length, Math.max(1, selectedLine ?? 1));
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const line = lines[lineNumber - 1];
  const [draft, setDraft] = useState<{ id: string; line: string; original?: Extractor; segments: Segment[]; pattern?: string; advanced: boolean; generalizeNumbers: boolean; manuallyEdited?: boolean } | null>(null);
  const [anchor, setAnchor] = useState<number | null>(null);
  const [outcome, setOutcome] = useState<{ key: string; result?: Preview; error?: string } | null>(null);
  const tokens = useMemo(() => extractorTokens(draft?.line ?? ""), [draft?.line]);
  // The endpoint deliberately rejects oversize lines instead of matching a truncated line.
  const sampleLines = useMemo(() => lines.slice(0, 500), [lines]);
  const input: Request | null = draft && (draft.segments.length || draft.pattern !== undefined) ? {
    line: draft.line, segments: draft.segments, sampleLines, generalizeNumbers: draft.generalizeNumbers,
    ...(timestampPattern ? { timestampPattern } : {}),
    ...(draft.pattern !== undefined ? { pattern: draft.pattern } : {})
  } : null;
  const key = JSON.stringify(input);
  const current = outcome?.key === key ? outcome : null;
  const result = current?.result;
  const pending = !!input && !!repository?.generateExtractorPattern && !current;
  useEffect(() => {
    if (!input || !repository?.generateExtractorPattern) return;
    let active = true;
    const timer = setTimeout(() => {
      void repository.generateExtractorPattern!(skillId, JSON.parse(key) as Request)
        .then((result) => { if (active) setOutcome({ key, result }); })
        .catch(() => { if (active) setOutcome({ key, error: "模式预览失败，请检查表达式后重试。" }); });
    }, 200);
    return () => { active = false; clearTimeout(timer); };
    // key contains the complete request; unrelated parent renders must not restart validation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, repository, skillId]);
  const candidate = draft && result && parsing ? {
    ...draft.original, id: draft.id, pattern: result.pattern,
    fields: Object.fromEntries(Object.entries(result.fields).map(([name, field]) => [name,
      draft.original?.fields[name] && !draft.segments.some((segment) => segment.name === name) ? draft.original.fields[name] : field]))
  } satisfies Extractor : null;
  const next = candidate && parsing ? { ...parsing, extractors: draft?.original
    ? parsing.extractors.map((extractor) => extractor.id === draft.original!.id ? candidate : extractor)
    : [...parsing.extractors, candidate] } : null;
  const validation = next ? parsingSpecSchema.safeParse(next) : null;
  const ruleNumbers = new Map(parsing?.extractors.map((extractor, index) => [extractor.id, index + 1]));
  const choose = (tokenIndex: number, range: boolean) => {
    if (!draft || disabled) return;
    const token = tokens[tokenIndex], from = range && anchor !== null ? tokens[Math.min(anchor, tokenIndex)] : token;
    const to = range && anchor !== null ? tokens[Math.max(anchor, tokenIndex)] : token;
    const start = from.valueStart, end = to.end;
    const existing = draft.segments.find((segment) => segment.start === start && segment.end === end);
    const segments = draft.segments.filter((segment) => segment.end <= start || segment.start >= end);
    let name = from.name ?? `field${segments.length + 1}`;
    while (segments.some((segment) => segment.name === name)) name += "_";
    if (!existing) segments.push({ start, end, name, type: segmentType(draft.line.slice(start, end)) });
    setDraft({ ...draft, segments: segments.sort((a, b) => a.start - b.start), pattern: undefined, manuallyEdited: false });
    if (!range || anchor === null) setAnchor(tokenIndex);
  };
  return <section aria-label="抽取规则" className="skill-extractors">
    <p>选择样例行，再点击片段命名字段；按住 Shift 点击可扩展选择范围。</p>
    <p>{sampleText ? `当前选择第 ${lineNumber} 行；可在右侧样例日志中点击或用键盘选择其他行。` : "请先在右侧上传样例日志，再选择要抽取的行。"}</p>
    <pre className="skill-extractor-line" aria-label="当前样例行">{line || "暂无样例；请上传或粘贴样例日志。"}</pre>
    <Button variant="outline" disabled={disabled || !parsing || !line || !repository?.generateExtractorPattern || parsing.extractors.length >= 200} onClick={() => {
      let index = 1; while (parsing!.extractors.some((extractor) => extractor.id === `extractor${index}`)) index++;
      setDraft({ id: `extractor${index}`, line, segments: [], advanced: false, generalizeNumbers: true }); setAnchor(null);
    }}>从此行创建抽取规则</Button>
    {!parsing ? <p role="alert">请先在代码视图修复解析规范。</p> : !parsing.extractors.length ? <p>暂无抽取规则。选择样例行后创建第一条规则。</p> : <DataTable fluid ariaLabel="抽取规则列表" rows={parsing.extractors} rowKey={(row) => row.id}
      emptyMessage="暂无抽取规则。选择样例行后创建第一条规则。" columns={[
        { key: "id", header: "抽取规则", render: (row) => `规则 ${ruleNumbers.get(row.id)}` },
        { key: "fields", header: "字段", render: (row) => Object.keys(row.fields).join("、") || "无字段" },
        { key: "actions", header: "操作", render: (row) => <div className="dialog-actions"><Button size="sm" variant="outline" disabled={disabled || !repository?.generateExtractorPattern} onClick={() => {
          setDraft({ id: row.id, line, original: row, segments: [], pattern: row.pattern, advanced: true, generalizeNumbers: true }); setAnchor(null);
        }}>编辑规则 {ruleNumbers.get(row.id)}</Button><Button size="sm" variant="ghost" disabled={disabled} onClick={() => setDeleteId(row.id)}>删除规则 {ruleNumbers.get(row.id)}</Button></div> }
      ]} />}
    <ConfirmDialog open={deleteId !== null} title="删除抽取规则" description="删除后，该规则将不再抽取日志字段；保存草稿后生效。" tone="danger" confirmLabel="删除规则"
      onCancel={() => setDeleteId(null)} onConfirm={() => { if (parsing) onChange({ ...parsing, extractors: parsing.extractors.filter((extractor) => extractor.id !== deleteId) }); setDeleteId(null); }} />
    <ModalDialog open={!!draft} onDismiss={() => setDraft(null)} className="skill-authoring-dialog skill-extractor-dialog modal-card--lg">
      {({ titleId }) => draft ? <><h2 id={titleId}>{draft.original ? "编辑抽取规则" : "从此行创建抽取规则"}</h2>
        <label>抽取器标识<Input value={draft.id} disabled={disabled} maxLength={100} onChange={(event) => setDraft({ ...draft, id: event.target.value })} /></label>
        <p>点击键值对会选择值；引号保留在捕获组外。按住 Shift 点击两个片段可选择它们之间的文本。</p>
        <div role="group" aria-label="样例片段" className="skill-extractor-tokens">{tokens.map((token, index) => <Button key={token.start} variant="outline" size="sm"
          disabled={disabled} aria-label={`片段 ${token.text}`} aria-pressed={draft.segments.some((segment) => segment.start < token.end && segment.end > token.start)}
          onClick={(event) => choose(index, event.shiftKey)}>{token.text}</Button>)}</div>
        {draft.segments.length ? <DataTable fluid ariaLabel="选中片段字段" rows={draft.segments} rowKey={(row) => String(row.start)} emptyMessage="点击上方片段选择字段。" columns={[
          { key: "text", header: "片段", render: (row) => <code>{draft.line.slice(row.start, row.end)}</code> },
          { key: "name", header: "字段名", render: (row) => <Input aria-label={`片段 ${draft.line.slice(row.start, row.end)} 的字段名`} disabled={disabled} value={row.name} maxLength={100}
            onChange={(event) => setDraft({ ...draft, pattern: undefined, manuallyEdited: false, segments: draft.segments.map((segment) => segment === row ? { ...row, name: event.target.value } : segment) })} /> },
          { key: "type", header: "类型", render: (row) => <SelectControl ariaLabel={`字段 ${row.name} 的类型`} disabled={disabled} value={row.type}
            options={(["int", "uint", "hex", "float", "string", "quoted", "bytes", "hexbytes", "base64bytes"] as const).map((value) => ({ value, label: { int: "整数", uint: "非负整数", hex: "十六进制", float: "小数", string: "文本", quoted: "引号内文本", bytes: "字节（bytes）", hexbytes: "十六进制字节（hexbytes）", base64bytes: "Base64 字节（base64bytes）" }[value] }))}
            onValueChange={(type) => setDraft({ ...draft, pattern: undefined, manuallyEdited: false, segments: draft.segments.map((segment) => segment === row ? { ...row, type } : segment) })} /> },
          { key: "remove", header: "操作", render: (row) => <Button variant="ghost" size="sm" disabled={disabled} onClick={() => setDraft({ ...draft, pattern: undefined, manuallyEdited: false, segments: draft.segments.filter((segment) => segment !== row) })}>移除 {row.name}</Button> }
        ]} /> : <p>点击上方片段选择字段。</p>}
        <label className="skill-extractor-option"><input type="checkbox" checked={draft.generalizeNumbers} disabled={disabled || draft.pattern !== undefined} onChange={(event) => setDraft({ ...draft, generalizeNumbers: event.target.checked })} />泛化未选中的数字（时间戳、计数）</label>
        <Button variant="link" className="skill-extractor-disclosure" aria-expanded={draft.advanced} onClick={() => setDraft({ ...draft, advanced: !draft.advanced })}>
          {draft.advanced ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}高级</Button>
        {draft.advanced ? <label>RE2 模式<Textarea className="font-mono" spellCheck={false} disabled={disabled} value={draft.pattern ?? result?.pattern ?? ""} maxLength={512} aria-invalid={!!current?.error}
          onChange={(event) => setDraft({ ...draft, pattern: event.target.value, manuallyEdited: true })} /></label> : result ? <pre className="skill-extractor-line" aria-label="生成模式">{result.pattern}</pre> : null}
        {draft.manuallyEdited ? <p role="status">已手动编辑，模式不再随片段自动生成。</p> : null}
        {draft.pattern !== undefined && draft.segments.length ? <Button variant="outline" onClick={() => setDraft({ ...draft, pattern: undefined, manuallyEdited: false })}>按片段重新生成</Button> : null}
        <div aria-live="polite">{pending ? <p role="status">正在校验 RE2 并计算覆盖率…</p> : current?.error ? <p role="alert">{current.error}</p> : result ? <>
          <p>命中 {result.matchCount} / {result.totalLines} 行 · 覆盖率 {(result.coverage * 100).toFixed(1)}%</p>
          {lines.length > 500 ? <p>仅对前 500 行计算覆盖率。</p> : null}
          <ul aria-label="首批匹配行">{result.matchedLines.map((match) => <li key={match.line}>第 {match.line} 行：<code>{match.text}</code></li>)}</ul>
        </> : <p>选择片段后显示模式、命中数与覆盖率。</p>}</div>
        {validation && !validation.success ? <p role="alert">抽取规则配置无效，请检查规则标识、模式和字段。</p> : null}
        <div className="dialog-actions"><Button variant="outline" onClick={() => setDraft(null)}>取消</Button>
          <Button disabled={disabled || pending || !next || !validation?.success} onClick={() => { if (next) { onChange(next); setDraft(null); } }}>保存抽取规则</Button></div>
      </> : null}
    </ModalDialog>
  </section>;
}
