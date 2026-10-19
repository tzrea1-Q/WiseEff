import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, ChevronUp, Trash2, X } from "lucide-react";
import { listSignalFields, logSkillSpecSchema } from "@wiseeff/dto-schemas";
import { SelectControl } from "@/components/common/SelectControl";
import { SectionEmpty } from "@/components/common/SectionState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { SignalPreview, SkillSpec, SkillSample, SkillWorkspaceRepository } from "./types";

type RuleSet = NonNullable<SkillSpec["signalRules"]>;
type Rule = RuleSet["rules"][number];
type Condition = Rule["anyOf"][number];
type FieldCondition = Extract<Condition, { type: "field" }>;
const defaults = { conclusion: "No rule-based findings were detected.", impact: "Review matching log lines and their context.", severity: "Info" as const, confidence: 0.5, suggestedActions: [] };
const emptyRules = (): RuleSet => ({ rules: [], noHit: { ...defaults }, hitDefaults: { ...defaults } });
const scalarText = (value: unknown) => value === undefined ? "" : String(value);
const parseScalar = (text: string): NonNullable<FieldCondition["value"]> => { try { return JSON.parse(text) as NonNullable<FieldCondition["value"]>; } catch { return text; } };
const numberInput = (text: string) => text.trim() ? Number(text) : NaN;
const severityLabels = { Critical: "严重", Warning: "警告", Info: "信息" };
const comparisonLabels = { lt: "小于", lte: "小于或等于", gt: "大于", gte: "大于或等于", eq: "等于", neq: "不等于" };
const fieldLeafLabel = (path: string) => path.split(".fields.").at(-1)!.replace(/\.meaning$/, " 含义").replace(/\.value$/, "");
const fieldOptionLabel = (path: string, unit?: string) => <span className="skill-field-option">
  <strong>{fieldLeafLabel(path)}{unit ? `（${unit}）` : ""}</strong>{" "}
  <span className="skill-field-path"><bdi dir="ltr">{path}</bdi></span>
</span>;

function conditionSummary(condition: Condition): string {
  switch (condition.type) {
    case "text": return `消息匹配 ${condition.pattern || "（待填写）"}`;
    case "field": {
      const decoded = condition.field.includes(".fields.");
      return `${decoded ? fieldLeafLabel(condition.field) : condition.field || "（待选择字段）"}${condition.operator === "range" ? ` 在 ${condition.min} 至 ${condition.max} 之间`
        : condition.operator === "in" ? ` 属于 ${Array.isArray(condition.values) ? condition.values.map(scalarText).join("、") : "（待填写）"}` : ` ${decoded ? "=" : "等于"} ${scalarText(condition.value)}`}${decoded ? `（${condition.field.split(".fields.")[0]}）` : ""}`;
    }
    case "window": return `${condition.seconds} 秒内 ${conditionSummary(condition.condition)} 达 ${condition.count} 次`;
    case "severityToken": return `日志级别为 ${condition.severity} 且包含 ${condition.token}`;
    case "numericComparison": return `${condition.leftTokens.join(" / ")} ${comparisonLabels[condition.operator]} ${condition.rightTokens.join(" / ")}`;
  }
}

function ScalarInput({ value, onChange, disabled, label }: { value: FieldCondition["value"]; onChange: (value: FieldCondition["value"]) => void; disabled: boolean; label: string }) {
  const encoded = scalarText(value);
  const [draft, setDraft] = useState({ encoded, text: encoded });
  if (draft.encoded !== encoded) setDraft({ encoded, text: encoded });
  return <Input aria-label={label} placeholder="值" disabled={disabled} value={draft.text} onChange={(event) => {
    const text = event.target.value, next = parseScalar(text);
    setDraft({ encoded: scalarText(next), text }); onChange(next);
  }} />;
}

function SetInput({ values, onChange, disabled, label }: { values: FieldCondition["values"]; onChange: (values: FieldCondition["values"]) => void; disabled: boolean; label: string }) {
  const encoded = Array.isArray(values) ? values.map(scalarText).join(", ") : String(values ?? "");
  const [draft, setDraft] = useState({ encoded, text: encoded });
  if (draft.encoded !== encoded) setDraft({ encoded, text: encoded });
  return <Input aria-label={label} placeholder="集合值，以逗号分隔" disabled={disabled} value={draft.text} onChange={(event) => {
    const text = event.target.value, next = text.split(",").map((value) => parseScalar(value.trim()));
    setDraft({ encoded: next.map(scalarText).join(", "), text }); onChange(next);
  }} />;
}

export function SignalsSection({ skillId, spec, onChange, disabled, sample, repository, onHit }: {
  skillId: string; spec: SkillSpec; onChange: (spec: SkillSpec) => void; disabled: boolean; sample: SkillSample | null;
  repository?: Partial<SkillWorkspaceRepository>; onHit: (line: number) => void;
}) {
  const rules = spec.signalRules?.rules ?? [];
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [preview, setPreview] = useState<SignalPreview | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const validation = useMemo(() => logSkillSpecSchema.safeParse(spec), [spec]);
  const issues = validation.success ? [] : validation.error.issues.filter((issue) => issue.path[0] === "signalRules");
  useEffect(() => {
    let active = true;
    setPreview(null); setPending(false); setError("");
    const signalRules = spec.signalRules;
    if (!validation.success || !sample || !signalRules || !repository?.signalPreview) return;
    const timer = window.setTimeout(() => {
      setPending(true);
      void repository.signalPreview!(skillId, { signalRules, ...(spec.parsing ? { parsing: spec.parsing } : {}), ...(spec.formatProfile ? { formatProfile: spec.formatProfile } : {}) })
        .then((result) => { if (active) setPreview(result); })
        .catch(() => { if (active) setError("预览失败，请修改规则或样例后重试。"); })
        .finally(() => { if (active) setPending(false); });
    }, 400);
    return () => { active = false; window.clearTimeout(timer); };
  }, [skillId, spec, sample, repository, validation.success]);
  const update = (next: Rule[]) => onChange({ ...spec, signalRules: { ...(spec.signalRules ?? emptyRules()), rules: next } });
  const updateRule = (index: number, patch: Partial<Rule>) => update(rules.map((rule, i) => i === index ? { ...rule, ...patch } : rule));
  const { fields, truncated: fieldsTruncated } = useMemo(() => listSignalFields(spec.parsing), [spec.parsing]);
  const resolveField = (path: string) => fields.find((item) => item.path === path) ?? (fieldsTruncated ? listSignalFields(spec.parsing, path).fields[0] : undefined);
  const fieldOptions = useMemo(() => {
    const groups = new Map<string, typeof fields>();
    for (const field of fields) {
      const group = [field.extractor, field.decoder ?? "抽取值"].join(" › ");
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group)!.push(field);
    }
    return [...groups].flatMap(([group, fields]) => [{ value: `group:${group}`, label: group, disabled: true },
      ...fields.map((field) => ({ value: field.path, label: fieldOptionLabel(field.path, field.unit) }))]);
  }, [fields]);
  const newFieldCondition = (field: string, operator: FieldCondition["operator"] = "equals"): FieldCondition => {
    const definition = resolveField(field);
    if (operator === "range" && definition?.type !== "number") operator = "equals";
    return { type: "field", field, operator, ...(operator === "equals" ? { value: definition?.values?.[0] ?? (definition?.type === "number" ? 0 : definition?.type === "boolean" ? false : "") }
      : operator === "range" ? { min: 0, max: 100 } : { values: [] }) };
  };
  const pathIssues = (path: (string | number)[]) => issues.filter((issue) => path.every((part, index) => issue.path[index] === part));
  const invalidRuleIds = rules.filter((_, index) => pathIssues(["signalRules", "rules", index]).length).map((rule) => rule.id);
  if (invalidRuleIds.some((id) => !expanded.has(id))) setExpanded(new Set([...expanded, ...invalidRuleIds]));
  const fieldError = (path: (string | number)[], exact = false) => {
    const matches = pathIssues(path).filter((issue) => !exact || issue.path.length === path.length);
    return matches.length ? <p className="skill-rule-error" role="alert">{matches.map((issue) => `${issue.path.join(".")}：${issue.message}`).join("；")}</p> : null;
  };
  const conditionEditor = (condition: Condition, path: (string | number)[], change: (condition: Condition) => void, remove?: () => void, nested = false) => {
    const label = `规则 ${Number(path[2]) + 1} 条件 ${Number(path[4]) + 1}${nested ? "子条件" : ""}`;
    const legacy = condition.type === "numericComparison" || condition.type === "severityToken";
    const field = condition.type === "field" ? resolveField(condition.field) : undefined;
    const values = condition.type === "field" && Array.isArray(condition.values) ? condition.values : [];
    return <div className={nested ? "skill-signal-subcondition" : "skill-signal-condition"}>
      <div className={`skill-condition-row${condition.type === "field" ? " skill-condition-row--field" : ""}`}>
        {legacy ? <div className="skill-condition-legacy"><span>{conditionSummary(condition)}</span><small>仅可在代码视图编辑</small></div> : <>
          <SelectControl className="skill-condition-type" ariaLabel={`${label}类型`} value={condition.type} disabled={disabled} options={[
            { value: "text", label: "消息匹配" }, { value: "field", label: "抽取字段" }, ...(!nested ? [{ value: "window", label: "时间窗内计数" }] : [])
          ]} onValueChange={(type) => change(type === "field" ? newFieldCondition(fields[0]?.path ?? "")
            : type === "window" ? { type: "window", condition: { type: "text", pattern: "" }, count: 2, seconds: 10 } : { type: "text", pattern: "" })} />
          {condition.type === "text" ? <>
            <Input className="skill-condition-value" aria-label={`${label}消息正则`} placeholder="消息正则" value={condition.pattern} disabled={disabled} aria-invalid={!!pathIssues([...path, "pattern"]).length}
              onChange={(event) => change({ ...condition, pattern: event.target.value })} />
            <Input className="skill-condition-flags" aria-label={`${label}正则标记`} value={condition.flags ?? ""} disabled={disabled} placeholder="i / m / s" aria-invalid={!!pathIssues([...path, "flags"]).length}
              onChange={(event) => change({ ...condition, flags: event.target.value })} />
          </> : condition.type === "field" ? <>
            <SelectControl className="skill-condition-field" title={condition.field} ariaLabel={`${label}抽取字段：${condition.field}`} value={condition.field} disabled={disabled} options={[
              ...(!fields.some((item) => item.path === condition.field) ? [{ value: condition.field, label: fieldOptionLabel(condition.field || "请先配置抽取字段", field?.unit) }] : []), ...fieldOptions
            ]} onValueChange={(field) => change(newFieldCondition(field, condition.operator))} ariaInvalid={!!pathIssues([...path, "field"]).length} />
            <SelectControl<FieldCondition["operator"]> className="skill-condition-operator" ariaLabel={`${label}比较方式`} value={condition.operator} disabled={disabled} options={[
              { value: "equals", label: "等于" }, ...(!field || field.type === "number" || condition.operator === "range" ? [{ value: "range" as const, label: "在范围内" }] : []), { value: "in", label: "属于集合" }
            ]} onValueChange={(operator) => change(newFieldCondition(condition.field, operator))} />
            <div className="skill-condition-value">{condition.operator === "equals" ? field?.values?.length ? <SelectControl ariaLabel={`${label}值`} disabled={disabled} value={String(condition.value ?? "")}
              options={[...(!field.values.includes(scalarText(condition.value)) ? [{ value: scalarText(condition.value), label: scalarText(condition.value) || "选择枚举含义" }] : []), ...field.values.map((value) => ({ value, label: value }))]}
              onValueChange={(value) => change({ ...condition, value })} /> : <ScalarInput label={`${label}值`} disabled={disabled} value={condition.value} onChange={(value) => change({ ...condition, value })} />
              : condition.operator === "range" ? <div className="skill-rule-range">{(["min", "max"] as const).map((key) => <Input key={key}
                aria-label={`${label}${key === "min" ? "最小值" : "最大值"}`} placeholder={key === "min" ? "最小值" : "最大值"} type="number" disabled={disabled} value={Number.isNaN(condition[key]) ? "" : condition[key] ?? ""}
                onChange={(event) => change({ ...condition, [key]: numberInput(event.target.value) })} />)}</div>
              : field?.values?.length ? <div className="skill-rule-hits" role="group" aria-label={`${label}集合`}>{[...new Set([...field.values, ...values.map(String)])].map((value) => <label className="skill-enum-option" key={value}>
                <input type="checkbox" disabled={disabled} checked={values.some((item) => String(item) === value)} onChange={(event) => change({ ...condition, values: event.target.checked ? [...values, value] : values.filter((item) => String(item) !== value) })} />{value}</label>)}</div>
              : <SetInput label={`${label}集合`} disabled={disabled} values={condition.values} onChange={(values) => change({ ...condition, values })} />}</div>
          </> : condition.type === "window" ? <>
            <Input className="skill-condition-number" aria-label={`${label}匹配次数`} title="匹配次数" type="number" min={1} step={1} disabled={disabled} value={Number.isNaN(condition.count) ? "" : condition.count}
              onChange={(event) => change({ ...condition, count: numberInput(event.target.value) })} /><span>次 /</span>
            <Input className="skill-condition-number" aria-label={`${label}时间窗（秒）`} title="时间窗（秒）" type="number" min={0} step="any" disabled={disabled} value={Number.isNaN(condition.seconds) ? "" : condition.seconds}
              onChange={(event) => change({ ...condition, seconds: numberInput(event.target.value) })} /><span>秒内</span>
            {conditionEditor(condition.condition, [...path, "condition"], (sub) => change({ ...condition, condition: sub as Extract<Condition, { type: "text" | "field" }> }), undefined, true)}
          </> : null}
        </>}
        {remove ? <Button className="skill-condition-remove" variant="ghost" size="icon-sm" disabled={disabled} aria-label={`删除${label}`} title="删除条件" onClick={remove}><X /></Button> : null}
      </div>
      {fieldError(path)}
    </div>;
  };
  return <section className="skill-section skill-signals-section" aria-label="信号规则"><h2>信号</h2><p>当条件满足时，产生指定名称和级别的信号。多个条件之间为“或”；规则按列表顺序运行。</p>
    {fieldsTruncated ? <p className="skill-signal-hint" role="status">字段较多，选择器仅显示部分路径；其余路径可在代码视图中配置，保存和预览仍会完整校验。</p> : null}
    {!sample ? <p className="skill-signal-hint">请先在右侧上传样例日志，规则命中会自动显示。</p> : <p className="skill-signal-hint">{pending ? "正在预览样例命中…" : `使用右侧样例日志：${sample.fileName}`}</p>}
    {error ? <p role="alert" className="skill-rule-error">{error}</p> : null}
    {preview?.truncated ? <p role="status">{preview.reason === "time_cap" ? "预览达到时间上限，已返回部分命中。" : preview.reason === "line_cap" ? "预览达到行数上限，已返回部分命中。" : preview.reason === "event_cap" ? "预览达到解码事件上限，已返回部分命中。" : "预览达到处理上限，已返回部分命中。"}</p> : null}
    {preview?.issues.map((issue, i) => <p role="alert" key={i}>{issue.path.join(".")}：{issue.message}</p>)}
    {fieldError(["signalRules", "rules"], true)}
    {!rules.length ? <SectionEmpty message="还没有技能信号规则；添加一条规则后在右侧样例上查看命中。" /> : null}
    {rules.map((rule, index) => {
      const invalid = !!pathIssues(["signalRules", "rules", index]).length;
      const open = expanded.has(rule.id) || invalid;
      const hits = preview?.hits.filter((hit) => hit.ruleId === rule.id);
      const severity = rule.severity ?? rule.analysis.severity?.value ?? spec.signalRules?.hitDefaults.severity ?? "Info";
      const visibleConditions = rule.anyOf.slice(0, 2);
      const conditions = (visibleConditions.every((condition) => condition.type === "text")
        ? `消息匹配 ${visibleConditions.map((condition) => condition.pattern || "（待填写）").join(" / ")}`
        : visibleConditions.map(conditionSummary).join(" / ")) + (rule.anyOf.length > 2 ? ` / +${rule.anyOf.length - 2}` : "");
      const hitLabel = hits ? `命中 ${hits.length} 次` : "命中待预览";
      const summary = `当 ${conditions} 时，产生 ${rule.name ?? rule.id} · ${severityLabels[severity]} · ${hitLabel}`;
      return <section className="skill-signal-rule" aria-label={`规则 ${index + 1}`} key={rule.id}>
        <header className="skill-rule-header"><span className="skill-rule-summary" title={summary}><span className="skill-rule-summary-condition">当 {conditions}</span>{" "}<span>时，产生</span>{" "}<span className="skill-rule-summary-name">{rule.name ?? rule.id}</span>{" "}<span>· {severityLabels[severity]} · {hitLabel}</span></span>
          <div className="skill-rule-actions"><Button variant="ghost" size="icon-sm" disabled={disabled || index === 0} aria-label={`上移规则 ${index + 1}`} title="上移" onClick={() => { const next = [...rules]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; update(next); }}><ArrowUp /></Button>
            <Button variant="ghost" size="icon-sm" disabled={disabled || index === rules.length - 1} aria-label={`下移规则 ${index + 1}`} title="下移" onClick={() => { const next = [...rules]; [next[index + 1], next[index]] = [next[index], next[index + 1]]; update(next); }}><ArrowDown /></Button>
            <Button variant="ghost" size="icon-sm" disabled={disabled} aria-label={`删除规则 ${index + 1}`} title="删除" onClick={() => update(rules.filter((_, i) => i !== index))}><Trash2 /></Button>
            <Button variant="ghost" size="icon-sm" aria-label={`${open ? "收起" : "展开"}规则 ${index + 1}`} title={open ? "收起" : "展开"} aria-expanded={open} aria-controls={`signal-rule-${rule.id}`} disabled={invalid} onClick={() => setExpanded((value) => { const next = new Set(value); if (open) next.delete(rule.id); else next.add(rule.id); return next; })}>{open ? <ChevronUp /> : <ChevronDown />}</Button>
          </div>
        </header>
        <div id={`signal-rule-${rule.id}`} hidden={!open}>{open ? <div className="skill-rule-body">
          {rule.anyOf.map((condition, conditionIndex) => <div key={conditionIndex}>{conditionEditor(condition, ["signalRules", "rules", index, "anyOf", conditionIndex],
            (next) => updateRule(index, { anyOf: rule.anyOf.map((value, i) => i === conditionIndex ? next : value) }), rule.anyOf.length > 1 ? () => updateRule(index, { anyOf: rule.anyOf.filter((_, i) => i !== conditionIndex) }) : undefined)}</div>)}
          {fieldError(["signalRules", "rules", index, "anyOf"], true)}
          <Button className="skill-rule-add" variant="link" size="sm" disabled={disabled} onClick={() => updateRule(index, { anyOf: [...rule.anyOf, { type: "text", pattern: "" }] })}>添加或条件</Button>
          <div className="skill-rule-output"><label>信号名称<Input aria-label={`规则 ${index + 1}名称`} value={rule.name ?? rule.id} disabled={disabled} onChange={(event) => updateRule(index, { name: event.target.value,
            ...(rule.inference === rule.name || rule.inference === "Signal rule matched." ? { inference: event.target.value } : {}) })} />{fieldError(["signalRules", "rules", index, "name"])}</label>
            <label>级别<SelectControl ariaLabel={`规则 ${index + 1}级别`} value={severity} disabled={disabled}
              options={Object.entries(severityLabels).map(([value, label]) => ({ value, label }))} onValueChange={(severity) => updateRule(index, { severity: severity as Rule["severity"] })} /></label></div>
          {hits?.length ? <div className="skill-rule-hits" aria-label={`${rule.name ?? rule.id}命中行`}>{hits.map((hit) => <Button variant="outline" size="xs" key={hit.lineNumber} title={hit.excerpt} aria-label={`第 ${hit.lineNumber} 行：${hit.excerpt}`} onClick={() => onHit(hit.lineNumber)}>L{hit.lineNumber}</Button>)}</div> : null}
          {hits && !hits.length ? <p className="skill-signal-hint">样例中未命中此规则。</p> : null}
        </div> : null}</div>
      </section>;
    })}
    <Button className="skill-rule-add" variant="outline" disabled={disabled} onClick={() => {
      const id = `signal-${crypto.randomUUID()}`; setExpanded((value) => new Set([...value, id]));
      update([...rules, { id, name: "新信号", severity: "Warning", anyOf: [{ type: "text", pattern: "" }], stageId: "pattern", inference: "新信号", suggestedAction: "Inspect matching lines and their context.", analysis: { suggestedActions: [] } }]);
    }}>添加信号规则</Button>
    {issues.length ? <p role="alert">请修正信号规则中的字段错误后保存或预览。</p> : null}
  </section>;
}
