import { useEffect, useRef, useState } from "react";
import { DataTable } from "@/components/admin/DataTable";
import { SectionEmpty } from "@/components/common/SectionState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { MAX_PARSE_TESTS, MAX_PARSE_TEST_LINES, MAX_PARSE_TEST_RUN_LINES, parseTestCaseSchema, parseTestsSchema } from "@wiseeff/dto-schemas";
import type { ParseTest, ParseTestRun, SkillSample, SkillSpec, SkillWorkspaceRepository } from "./types";

function fieldExpectations(fields: Record<string, unknown>, prefix = ""): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields).flatMap(([name, value]) => {
    const path = prefix ? `${prefix}.${name}` : name;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return Object.entries(value).flatMap(([key, child]) => key === "raw" ? []
        : child && typeof child === "object" && !Array.isArray(child)
          ? Object.entries(fieldExpectations(child as Record<string, unknown>, `${path}.${key}`))
          : [[`${path}.${key}`, child]]);
    }
    return [[path, value]];
  }));
}
const displayValue = (value: unknown) => JSON.stringify(value) ?? "null";
function enteredValue(text: string): NonNullable<ParseTest["expect"]["fields"]>[string] { try { return JSON.parse(text) as NonNullable<ParseTest["expect"]["fields"]>[string]; } catch { return text; } }

function Expectations({ test, onChange, disabled, onValidityChange }: { test: ParseTest; onChange: (test: ParseTest) => void; disabled: boolean; onValidityChange: (invalid: boolean) => void }) {
  const [rows, setRows] = useState(() => Object.entries(test.expect.fields ?? {}).map(([path, value]) => ({ path, value: displayValue(value) })));
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState("");
  const paths = rows.map((row) => row.path.trim()).filter(Boolean);
  const duplicatePaths = new Set(paths).size !== paths.length;
  const codeEdited = code !== null && code !== JSON.stringify(test.expect, null, 2);
  useEffect(() => { onValidityChange(duplicatePaths || codeEdited); }, [duplicatePaths, codeEdited, onValidityChange]);
  useEffect(() => () => onValidityChange(false), [onValidityChange]);
  const updateRows = (next: typeof rows) => {
    setRows(next);
    const paths = next.map((row) => row.path.trim()).filter(Boolean);
    if (new Set(paths).size !== paths.length) return;
    const fields = Object.fromEntries(next.filter((row) => row.path.trim()).map((row) => [row.path.trim(), enteredValue(row.value)]));
    const checked = parseTestCaseSchema.safeParse({ ...test, expect: { ...test.expect, fields } });
    onChange({ ...test, expect: { ...test.expect, fields } });
    setError(checked.success ? "" : "字段路径或期望值无效，请检查后重试。");
  };
  return <section aria-label="期望字段"><h3>期望字段</h3><p>按字段路径匹配；数值默认比较 value，校验原始文本时请明确填写 .raw。可删除不需要的期望。</p>
    <DataTable ariaLabel="期望字段表" rows={rows.map((row, index) => ({ ...row, index }))} rowKey={(row) => String(row.index)} pageSize={200} columns={[
      { key: "path", header: "字段路径", render: (row) => <Input aria-label={`期望字段 ${row.index + 1} 路径`} disabled={disabled} value={row.path}
        onChange={(event) => updateRows(rows.map((item, index) => index === row.index ? { ...item, path: event.target.value } : item))} /> },
      { key: "value", header: "期望", render: (row) => <Input aria-label={`期望字段 ${row.index + 1} 值`} disabled={disabled} value={row.value}
        onChange={(event) => updateRows(rows.map((item, index) => index === row.index ? { ...item, value: event.target.value } : item))} /> },
      { key: "remove", header: "操作", render: (row) => <Button variant="outline" size="sm" disabled={disabled} aria-label={`删除期望字段 ${row.index + 1}`} onClick={() => updateRows(rows.filter((_, index) => index !== row.index))}>删除</Button> }
    ]} emptyMessage="尚无字段期望；可新增字段，或仅检查信号。" />
    <Button variant="outline" disabled={disabled || rows.length >= 200} onClick={() => updateRows([...rows, { path: "", value: "" }])}>新增期望字段</Button>
    <label>期望信号（名称或 ID，每行一个）<Textarea disabled={disabled} value={(test.expect.signals ?? []).join("\n")} onChange={(event) => onChange({ ...test, expect: { ...test.expect, signals: event.target.value.split("\n").filter(Boolean) } })} /></label>
    <label className="skill-test-checkbox"><input type="checkbox" disabled={disabled} checked={test.expect.exactSignals ?? false}
      onChange={(event) => onChange({ ...test, expect: { ...test.expect, exactSignals: event.target.checked } })} />精确匹配信号集合（不允许多余信号）</label>
    <Button variant="outline" disabled={disabled} onClick={() => { setError(""); setCode(code === null ? JSON.stringify(test.expect, null, 2) : null); }}>代码视图 · JSON</Button>
    {code !== null ? <><label>期望代码<Textarea disabled={disabled} value={code} onChange={(event) => setCode(event.target.value)} /></label>
      <Button variant="outline" disabled={disabled} onClick={() => {
        try { const checked = parseTestCaseSchema.safeParse({ ...test, expect: JSON.parse(code) });
          if (!checked.success) throw new Error("invalid");
          onChange(checked.data); setRows(Object.entries(checked.data.expect.fields ?? {}).map(([path, value]) => ({ path, value: displayValue(value) }))); setCode(null); setError("");
        } catch { setError("期望 JSON 无效，请检查字段路径和信号列表。"); }
      }}>应用期望代码</Button></> : null}
    {duplicatePaths || error ? <p role="alert">{duplicatePaths ? "字段路径重复，请修改后保存。" : error}</p> : null}
  </section>;
}

export function ParseTestsSection({ skillId, spec, setSpec, disabled, repository, sample, selectedLine, result, onRun, onBusyChange, onValidityChange }: {
  skillId: string; spec: SkillSpec; setSpec: (spec: SkillSpec) => void; disabled: boolean; repository?: Partial<SkillWorkspaceRepository>;
  sample: SkillSample | null; selectedLine: number | null; result: ParseTestRun | null; onRun: () => void;
  onBusyChange: (busy: boolean) => void; onValidityChange: (invalid: boolean) => void;
}) {
  const tests = spec.parseTests ?? [];
  const validation = parseTestsSchema.safeParse(tests);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const addingRef = useRef(false);
  const [error, setError] = useState("");
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; if (addingRef.current) onBusyChange(false); }; }, [onBusyChange]);
  const test = tests.find((item) => item.id === selectedId) ?? tests.find((item) => result?.results.some((entry) => entry.id === item.id && !entry.passed)) ?? tests[0];
  const outcome = result?.results.find((item) => item.id === test?.id);
  const update = (next: ParseTest) => setSpec({ ...spec, parseTests: tests.map((item) => item.id === next.id ? next : item) });
  const add = async () => {
    addingRef.current = true; setAdding(true); onBusyChange(true); setError("");
    const line = sample && selectedLine ? sample.content.split(/\r?\n/)[selectedLine - 1] : "";
    try {
      if ((line?.length ?? 0) > 6144) { setError("所选样例行超过 6144 字符，请选择较短的一行。"); return; }
      const preview = line && spec.parsing && repository?.parsePreview ? await repository.parsePreview(skillId, { parsing: spec.parsing, sampleText: line, fileName: sample?.fileName })
        .catch(() => { if (active.current) setError("解析预览暂时不可用，已使用样例行新增测试；请补充期望。"); return null; }) : null;
      if (!active.current) return;
      if (preview && (!preview.valid || preview.truncated)) { setError("当前解析预览未完成，已使用样例行新增测试；请补充期望。"); }
      const next = parseTestCaseSchema.parse({ id: crypto.randomUUID(), name: `解析测试 ${tests.length + 1}`, lines: [line ?? ""], ...(sample ? { fileName: sample.fileName } : {}),
        expect: { fields: preview?.valid ? fieldExpectations(preview.events[0]?.fields ?? {}) : {} } });
      const checked = parseTestsSchema.safeParse([...tests, next]);
      if (!checked.success) { setError("测试超出数量、行数或字符上限，请删减样例或期望后重试。"); return; }
      setSpec({ ...spec, parseTests: checked.data }); setSelectedId(next.id);
    } catch { setError("无法从样例创建测试，请检查解析规则和样例行后重试。"); }
    finally { addingRef.current = false; if (active.current) { setAdding(false); onBusyChange(false); } }
  };
  return <section className="skill-section skill-parse-tests" aria-label="测试"><h2>测试</h2>
    <p>样例行与期望字段、信号随版本保存。保存草稿和发布前运行；失败不会阻止发布。</p>
    <div className="skill-register-toolbar"><Button disabled={disabled || adding || tests.length >= MAX_PARSE_TESTS} aria-busy={adding} onClick={() => void add()}>新增测试</Button>
      <Button variant="outline" disabled={disabled || adding || !validation.success || !repository?.runSkillParseTests} onClick={onRun}>运行测试</Button>
      <span>{tests.length} / {MAX_PARSE_TESTS} 个测试{sample && selectedLine ? ` · 使用样例第 ${selectedLine} 行` : ""}</span></div>
    {error ? <p role="alert">{error}</p> : null}
    {!validation.success ? <p role="alert">测试配置无效：请检查名称、字段路径及样例行数、字符上限后保存。</p> : null}
    <DataTable ariaLabel="解析测试列表" rows={tests} rowKey={(item) => item.id} selectedRowKey={test?.id} onRowClick={(item) => setSelectedId(item.id)} columns={[
      { key: "name", header: "测试", render: (item) => <Button variant="link" onClick={() => setSelectedId(item.id)}>{item.name}</Button> },
      { key: "lines", header: "样例行", render: (item) => `${item.lines.length} 行` },
      { key: "status", header: "状态", render: (item) => { const run = result?.results.find((entry) => entry.id === item.id); return run ? run.passed ? "通过" : "失败" : "未运行"; } }
    ]} emptyState={<SectionEmpty message="添加解析测试，检查规则更改是否影响预期字段和信号。" />} />
    {test ? <section aria-label={`编辑测试 ${test.name}`} key={test.id}>
      <label>测试名称<Input disabled={disabled} maxLength={200} value={test.name} onChange={(event) => update({ ...test, name: event.target.value })} /></label>
      <label>测试文件名<Input disabled={disabled} maxLength={1024} value={test.fileName ?? ""} onChange={(event) => { const next = { ...test }; if (event.target.value) next.fileName = event.target.value; else delete next.fileName; update(next); }} /></label>
      <label>测试样例行<Textarea disabled={disabled} value={test.lines.join("\n")} onChange={(event) => update({ ...test, lines: event.target.value.split(/\r?\n/) })} /></label>
      <p>每个测试最多 {MAX_PARSE_TEST_LINES} 行，每行最多 6144 字符；全部测试共用 1 MiB 字符和 {MAX_PARSE_TEST_RUN_LINES} 行上限。</p>
      <Expectations test={test} onChange={update} disabled={disabled} onValidityChange={onValidityChange} />
      <Button variant="outline" disabled={disabled} onClick={() => { setSpec({ ...spec, parseTests: tests.filter((item) => item.id !== test.id) }); setSelectedId(null); }}>删除测试</Button>
      {outcome ? <section aria-label="测试结果"><h3>{outcome.passed ? "通过" : "失败"}</h3>
        {outcome.error ? <p role="alert">{outcome.error}</p> : null}
        {outcome.diffs.length ? <DataTable ariaLabel="解析测试差异" rows={outcome.diffs.map((diff, index) => ({ ...diff, index }))} rowKey={(diff) => String(diff.index)} columns={[
          { key: "path", header: "字段路径", render: (diff) => <code>{diff.path}</code> },
          { key: "expected", header: "期望", render: (diff) => <code>{displayValue(diff.expected)}</code> },
          { key: "actual", header: "实际", render: (diff) => <code>{diff.missing ? "字段缺失" : displayValue(diff.actual)}</code> }
        ]} /> : null}
        {outcome.missingSignals.length ? <p>缺少信号：{outcome.missingSignals.join("、")}</p> : null}
        {outcome.unexpectedSignals.length ? <p>多余信号：{outcome.unexpectedSignals.join("、")}</p> : null}
      </section> : null}
    </section> : null}
    {result?.truncated ? <p role="status">测试达到执行上限；未完成的测试计为失败。</p> : null}
  </section>;
}
