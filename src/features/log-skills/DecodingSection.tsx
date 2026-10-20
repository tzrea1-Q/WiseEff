import { useDeferredValue, useEffect, useId, useMemo, useState } from "react";
import { CircleAlert, CircleCheck } from "lucide-react";
import { stringify } from "yaml";
import { parsingSpecSchema, registerCaseKey, logSkillSpecSchema } from "@wiseeff/dto-schemas";
import { matchSkillFile } from "@/domain/logs/fileApplicability";
import { ModalDialog } from "@/components/common/ModalDialog";
import { SelectControl } from "@/components/common/SelectControl";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ViewSwitch } from "@/components/ui/view-switch";
import { TabPanel } from "@/components/ui/tab-panel";
import { decodedValueText } from "@/features/log-analysis/DecodedFields";
import { boundedSamplePreview, parseParsingYaml } from "./ParsingSection";
import { parseRegisterBits, parseRegisterTable, registerPasteIssue, type Register } from "./registerTable";
import { FrameEditor, renameFrameReferences } from "./FrameEditor";
import { decodedOccurrences } from "./decodedOccurrences";
import type { ParsePreview, SkillSpec, SkillWorkspaceRepository, SkillSample } from "./types";

type Parsing = NonNullable<SkillSpec["parsing"]>;
type Decoded = ParsePreview["events"][number]["fields"][string];
const decodingErrorMessages: Record<string, string> = {
  register_case: "未匹配寄存器映射。", unmatched_register: "未匹配寄存器映射。",
  register_range: "寄存器数值超出位宽或物理值范围。", register_precision: "寄存器数值换算超出安全精度范围。",
  event_size: "解码事件过大，部分字段已省略。", field_cap: "解码字段数量超过上限，部分字段已省略。",
  byte_cap: "解码字节数超过上限。", invalid_field: "字段值无法按声明的类型解析。",
  max_lines: "多行日志组超过最大行数。", match_input_cap: "日志内容超过解析长度上限。", line_cap: "日志行超过长度上限。",
  time_cap: "解码达到时间上限，已返回完成的部分。", event_cap: "解码事件数量超过上限，已返回完成的部分。",
  output_field_cap: "解码字段总数超过上限，已返回完成的部分。", output_byte_cap: "解码输出大小超过上限，已返回完成的部分。"
};
const isRegisterCaseError = (code: string) => code === "register_case" || code === "unmatched_register";
function nextId(prefix: string, entries: object) { let index = 1; while (Object.hasOwn(entries, `${prefix}${index}`)) index++; return `${prefix}${index}`; }
// Keep path-invalid form drafts editable; arbitrary malformed YAML stays in code view.
function formSpec(value: unknown): value is Parsing {
  if (!value || typeof value !== "object") return false;
  const spec = value as Parsing;
  return spec.schemaVersion === "parsing/v1" && Array.isArray(spec.extractors)
    && spec.extractors.every((extractor) => extractor && typeof extractor.id === "string" && extractor.fields && typeof extractor.fields === "object"
      && Object.values(extractor.fields).every((field) => field && typeof field.type === "string"))
    && (!spec.registers || Object.values(spec.registers).every((register) => register && [8, 16, 32, 64].includes(register.width) && Array.isArray(register.fields)
      && register.fields.every((field) => field && typeof field.name === "string" && (typeof field.bits === "string" || Array.isArray(field.bits) && field.bits.length === 2 && field.bits.every(Number.isInteger)))))
    && (!spec.registerMaps || Object.values(spec.registerMaps).every((map) => map && typeof map.selectBy === "string" && map.cases && typeof map.cases === "object"))
    && (!spec.frames || Object.values(spec.frames).every((frame) => frame && Array.isArray(frame.fields) && frame.fields.every((field) => field && typeof field.name === "string" && typeof field.type === "string"
      && (field.type !== "checksum" || Array.isArray(field.range) && field.range.length === 2 && field.range.every(Number.isFinite)))));
}

export function RegisterBitBar({ register, values }: { register: Register; values?: Record<string, Decoded> }) {
  const segments = register.fields.filter((field) => Array.isArray(field.bits) && field.bits[0] < register.width && field.bits[1] >= 0 && field.bits[0] >= field.bits[1]).sort((a, b) => b.bits[0] - a.bits[0]);
  const columns = { gridTemplateColumns: `repeat(${register.width}, minmax(0, 1fr))` };
  const boundaries = new Set(segments.flatMap((field) => field.bits));
  const labels = new Set([register.width - 1, 0]);
  if (register.width >= 32) {
    // Two-digit labels borrow space from blank cells; omit adjacent boundaries.
    for (const bit of [...Array.from({ length: register.width / 4 }, (_, i) => i * 4), ...boundaries]) {
      if ([...labels].every((label) => Math.abs(label - bit) >= 3)) labels.add(bit);
    }
  }
  const fields = segments.map((field, index) => {
    const decoded = values?.[field.name];
    const scalar = decoded && typeof decoded === "object" && "value" in decoded ? decoded.value : decoded;
    const meaning = decoded && typeof decoded === "object" && "meaning" in decoded ? decoded.meaning : undefined;
    const unit = decoded && typeof decoded === "object" && "unit" in decoded ? decoded.unit : undefined;
    const text = scalar === undefined ? "—" : `${decodedValueText(scalar)}${unit ? ` ${unit}` : ""}`;
    const nonzero = scalar !== undefined && scalar !== null && scalar !== false && scalar !== 0 && scalar !== "0";
    return { field, index, text, meaning, nonzero };
  });
  return <div className="skill-bit-bar" role="group" aria-label={`寄存器位条 · ${register.width} 位，高位到低位`}>
    <div className="skill-bit-layout" style={columns}>
      <div className="skill-bit-ruler" role="list" aria-label="位编号，高位到低位">{Array.from({ length: register.width }, (_, index) => register.width - index - 1).map((bit, index) => <span role="listitem" key={bit}
        aria-label={`位 ${bit}`} title={`位 ${bit}`} style={{ gridColumn: index + 1, gridRow: 1 }}>{register.width < 32 || labels.has(bit) ? <span className="skill-bit-label">{bit}</span> : null}</span>)}</div>
    <div className="skill-bit-segments">{fields.map(({ field, index, text, nonzero }) => <div key={index} className="skill-bit-segment" data-tone={index % 4} data-nonzero={nonzero || undefined}
      title={`${field.name} [${field.bits.join(":")}]${field.description ? ` · ${field.description}` : ""}`}
      style={{ gridColumn: `${register.width - field.bits[0]} / span ${field.bits[0] - field.bits[1] + 1}`, gridRow: 2 }}>
      <strong className="skill-bit-name">{field.name || "未命名"}</strong>
      <span className="skill-bit-value" aria-label={`${field.name} 的值${nonzero ? "（非零）" : ""}`}>{text}</span>
    </div>)}</div>
    </div>
    {values ? <ul className="skill-bit-legend" aria-label="解码字段图例">{fields.map(({ field, index, text, meaning, nonzero }) => <li key={index} data-tone={index % 4} data-nonzero={nonzero || undefined}
      title={`${field.name} [${field.bits.join(":")}]${field.description ? ` · ${field.description}` : ""}`}>
      <span className="skill-bit-swatch" aria-hidden="true" /><span className="skill-bit-legend-value">{field.name || "未命名"} = {text}{meaning ? ` · ${meaning}` : ""}</span>
    </li>)}</ul> : null}
  </div>;
}

function EnumEditor({ value, onChange, disabled, label }: { value?: unknown; onChange: (value: unknown) => void; disabled: boolean; label: string }) {
  const text = typeof value === "string" ? value : value ? JSON.stringify(value) : "";
  const error = typeof value === "string";
  const errorId = useId();
  return <><Input aria-label={label} aria-invalid={error} aria-describedby={error ? errorId : undefined} disabled={disabled} value={text} placeholder={'{"0":"normal"}'} onChange={(event) => {
    const next = event.target.value;
    try {
      const parsed: unknown = next.trim() ? JSON.parse(next) : undefined;
      if (parsed !== undefined && (!parsed || Array.isArray(parsed) || typeof parsed !== "object" || Object.values(parsed).some((item) => typeof item !== "string"))) throw new Error();
      onChange(parsed);
    } catch { onChange(next); }
  }} />{error ? <span id={errorId} role="alert">枚举需为值到含义的 JSON 对象。</span> : null}</>;
}

export function DecodingSection({ skillId, yaml, onChange, disabled, repository, sample, selectedLine, files }: {
  skillId: string; yaml: string; onChange: (text: string) => void; disabled: boolean; repository?: Partial<SkillWorkspaceRepository>;
  sample?: SkillSample | null; selectedLine?: number | null; files?: SkillSpec["files"];
}) {
  const id = useId();
  const [view, setView] = useState("form");
  const [registerId, setRegisterId] = useState("");
  const [mapIdSelection, setMapIdSelection] = useState("");
  const [deleting, setDeleting] = useState<{ label: string; remove: () => void } | null>(null);
  const [occurrence, setOccurrence] = useState<{ register: string; line: typeof selectedLine; key: string } | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [paste, setPaste] = useState("");
  const deferredPaste = useDeferredValue(paste);
  const [outcome, setOutcome] = useState<{ yaml: string; sample: SkillSample; files: SkillSpec["files"]; line: number; preview?: ParsePreview; error?: string } | null>(null);
  const parsed = useMemo(() => parseParsingYaml(yaml), [yaml]);
  const validation = useMemo(() => parsingSpecSchema.safeParse(parsed.value), [parsed.value]);
  const skillMatched = !!sample && logSkillSpecSchema.safeParse({ schemaVersion: "skill/v1", files }).success
    && matchSkillFile(files, sample.contentFilePath ?? sample.fileName).skillMatched;
  const current = skillMatched && outcome && outcome.yaml === yaml && outcome.sample === sample && outcome.files === files && outcome.line === selectedLine ? outcome : null;
  const preview = current?.preview;
  const error = current?.error;
  const pending = skillMatched && !!selectedLine && validation.success && !!repository?.parsePreview && !current;
  const spec = formSpec(parsed.value) ? parsed.value : null;
  const registers = spec?.registers ?? {};
  const activeId = Object.hasOwn(registers, registerId) ? registerId : Object.keys(registers)[0] ?? "";
  const register = registers[activeId];
  const maps = spec?.registerMaps ?? {};
  const mapId = Object.hasOwn(maps, mapIdSelection) ? mapIdSelection : Object.keys(maps)[0] ?? "";
  const map = maps[mapId];
  const pasteIssue = useMemo(() => registerPasteIssue(paste), [paste]);
  const rows = useMemo(() => registerPasteIssue(deferredPaste) ? [] : parseRegisterTable(deferredPaste, register?.width ?? 8), [deferredPaste, register?.width]);
  const validRows = rows.filter((row) => row.field);
  const invalidCount = rows.length - validRows.length;
  const pastePending = paste !== deferredPaste;
  const write = (next: Parsing) => onChange(stringify(next));
  const updateRegister = (next: Register) => spec && write({ ...spec, registers: { ...registers, [activeId]: next } });
  // Raw invalid inputs must reach YAML too, so the workspace cannot save an older valid value.
  const updateField = (index: number, patch: Record<string, unknown>) => updateRegister({ ...register, fields: register.fields.map((field, i) => i === index ? { ...field, ...patch } : field) });
  const storedPreview = useMemo(() => boundedSamplePreview(sample?.content ?? ""), [sample]);
  useEffect(() => {
    let active = true;
    if (!sample || !skillMatched || !selectedLine || !validation.success || !repository?.parsePreview) return;
    void repository.parsePreview(skillId, { parsing: parsed.value, sampleText: storedPreview.content, fileName: sample.contentFilePath ?? sample.fileName })
      .then((result) => { if (active) setOutcome({ yaml, sample, files, line: selectedLine, preview: result }); })
      .catch(() => { if (active) setOutcome({ yaml, sample, files, line: selectedLine, error: "样例解码失败，请重新选择样例行或检查规则。" }); });
    return () => { active = false; };
  }, [skillId, yaml, sample, files, skillMatched, selectedLine, repository, validation.success, parsed.value, storedPreview.content]);
  const selectedEvents = preview?.events.filter((event) => selectedLine && event.line <= selectedLine && (event.endLine ?? event.line) >= selectedLine) ?? [];
  const occurrences = spec ? decodedOccurrences(spec, selectedEvents).filter((item) => "register" in item.decoder && item.decoder.register === activeId) : [];
  const matching = (occurrence?.register === activeId && occurrence.line === selectedLine ? occurrences.find((item) => item.key === occurrence.key) : undefined) ?? occurrences[0];
  const matchingValue = matching?.value;
  const values = matchingValue && typeof matchingValue === "object" && "fields" in matchingValue ? matchingValue.fields : undefined;
  const unmatchedMaps = [...new Set(selectedEvents.flatMap((event) => Object.values(spec?.extractors.find((extractor) => extractor.id === event.extractor)?.fields ?? {}).flatMap((binding) => {
    if (!("decode" in binding) || !binding.decode || !("registerMap" in binding.decode)) return [];
    const mapId = binding.decode.registerMap, map = spec?.registerMaps?.[mapId];
    if (!map || map.default) return [];
    const selector = event.fields[map.selectBy];
    if (selector === undefined) return [];
    const scalar = selector && typeof selector === "object" && "value" in selector ? selector.value : selector;
    if (Object.keys(map.cases).some((key) => registerCaseKey(key) === registerCaseKey(String(scalar)))) return [];
    const raw = selector && typeof selector === "object" && "raw" in selector ? selector.raw : decodedValueText(selector);
    return [`${map.selectBy}=${raw} 未匹配寄存器映射 ${mapId}`];
  })))];
  const eventErrors = selectedEvents.flatMap((event) => event.errors ?? []);
  const visibleErrors = eventErrors.filter((issue) => !unmatchedMaps.length || !isRegisterCaseError(issue.code));
  const fieldNames = [...new Set(spec?.extractors.flatMap((extractor) => Object.keys(extractor.fields)) ?? [])];
  return <section className="skill-section skill-decoding" aria-label="解码"><h2>解码</h2>
    {sample && !skillMatched ? <p>此文件未匹配技能，仅通用分析；不会运行技能解码预览。</p> : null}
    <ViewSwitch variant="tabs" ariaLabel="解码视图" value={view} onValueChange={setView} items={[
      { value: "form", label: "表单", id: `${id}-form`, panelId: `${id}-form-panel` },
      { value: "code", label: "代码视图", id: `${id}-code`, panelId: `${id}-code-panel` }
    ]} />
    {parsed.error ? <p role="alert">解析规则语法无效，请在代码视图检查缩进和格式。</p> : !validation.success ? <p role="alert">解码配置无效，请检查寄存器、映射、帧和字段绑定。</p> : null}
    <TabPanel id={`${id}-code-panel`} aria-labelledby={`${id}-code`} hidden={view !== "code"}>
      <label>代码视图 · YAML<Textarea spellCheck={false} className="font-mono" disabled={disabled} value={yaml} onChange={(event) => onChange(event.target.value)} /></label>
    </TabPanel>
    <TabPanel id={`${id}-form-panel`} aria-labelledby={`${id}-form`} hidden={view !== "form"}>
      {!spec ? <p>请先在代码视图修复规范结构。</p> : <>
        <section aria-label="寄存器"><h3>寄存器</h3>
          <div className="skill-register-toolbar"><label>选择寄存器<SelectControl ariaLabel="选择寄存器" value={activeId} onValueChange={setRegisterId}
            options={Object.keys(registers).map((value) => ({ value, label: value }))} placeholder="暂无寄存器" /></label>
            <Button variant="outline" disabled={disabled} onClick={() => { const key = nextId("register", registers); write({ ...spec, registers: { ...registers, [key]: { width: 8, fields: [] } } }); setRegisterId(key); }}>新增寄存器</Button></div>
          {register ? <>
            <div className="skill-register-toolbar"><label>寄存器标识<Input value={activeId} disabled={disabled} onChange={(event) => {
              const key = event.target.value;
              if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,99}$/.test(key) || Object.hasOwn(registers, key)) return;
              const next = { ...registers }; delete next[activeId]; next[key] = register;
              const registerMaps = spec.registerMaps && Object.fromEntries(Object.entries(spec.registerMaps).map(([mapId, map]) => [mapId, { ...map,
                cases: Object.fromEntries(Object.entries(map.cases).map(([address, target]) => [address, target === activeId ? key : target])), ...(map.default === activeId ? { default: key } : {}) }]));
              write(renameFrameReferences({ ...spec, registers: next, ...(registerMaps ? { registerMaps } : {}) }, "register", activeId, key)); setRegisterId(key);
            }} /></label><label>位宽<SelectControl ariaLabel="寄存器位宽" disabled={disabled} value={String(register.width)} onValueChange={(value) => updateRegister({ ...register, width: Number(value) as Register["width"] })}
              options={[8, 16, 32, 64].map((width) => ({ value: String(width), label: `${width} 位` }))} /></label></div>
            <p>{selectedLine ? `样例第 ${selectedLine} 行${pending ? " · 解码中…" : ""}` : "选择右侧样例行，查看位段的解码值。"}</p>
            {error ? <p role="alert">{error}</p> : null}
            {preview?.issues.length ? <p role="alert">解码预览未完成，请检查规则和样例内容后重试。</p> : null}
            {storedPreview.truncated ? <p role="status">样例预览仅处理 1 MiB 内的完整行；超出范围的样例行没有解码值。</p> : null}
            {preview?.truncated ? <p role="status">{preview.reason === "output_field_cap" ? "预览达到 32768 个字段输出上限，仅显示已完成的解码结果。"
              : preview.reason === "output_byte_cap" ? "预览达到 4 MiB 输出上限，仅显示已完成的解码结果。"
              : preview.reason === "time_cap" ? "预览达到 100 ms 时间上限，仅显示已完成的解码结果。"
              : preview.reason === "line_cap" ? "预览仅处理前 5000 行；超出范围的样例行没有解码值。"
              : "预览仅显示前 500 个事件；超出范围的样例行没有解码值。"}</p> : null}
            {visibleErrors.map((issue, index) => <p role="alert" key={index}>{issue.field ? `${issue.field}：` : ""}{Object.hasOwn(decodingErrorMessages, issue.code) ? decodingErrorMessages[issue.code] : "解码失败，请检查字段定义和样例内容。"}</p>)}
            {preview && !matchingValue && !unmatchedMaps.length && !visibleErrors.length ? <p>此行未产生该寄存器的解码字段；请检查抽取字段绑定与映射。</p> : null}
            {matching ? <p aria-label="寄存器样例路径">{matching.path.join(" › ")}</p> : null}
            {occurrences.length > 1 ? <label>寄存器解码位置<SelectControl ariaLabel="寄存器解码位置" value={matching?.key ?? ""} options={occurrences.map((item) => ({ value: item.key, label: item.path.join(" › ") }))}
              onValueChange={(key) => setOccurrence({ register: activeId, line: selectedLine, key })} /></label> : null}
            <RegisterBitBar register={register} values={values} />
            {unmatchedMaps.map((message) => <p key={message} className="skill-register-unmatched" role="status"><CircleAlert aria-hidden="true" />{message}</p>)}
            <div className="skill-register-toolbar"><Button variant="outline" disabled={disabled} onClick={() => updateRegister({ ...register, fields: [...register.fields, { bits: [0, 0], name: nextId("FIELD", Object.fromEntries(register.fields.map((field) => [field.name, true]))) }] })}>新增字段</Button>
              <Button variant="outline" disabled={disabled} onClick={() => { setPaste(""); setPasteOpen(true); }}>粘贴寄存器表</Button></div>
            <Table aria-label="寄存器字段表"><TableHeader><TableRow>{["位 [高:低]", "名称", "物理值", "含义与说明", "操作"].map((name) => <TableHead key={name}>{name}</TableHead>)}</TableRow></TableHeader>
              <TableBody>{register.fields.map((field, index) => <TableRow key={index}>
                <TableCell><Input aria-label={`字段 ${index + 1} 位范围`} disabled={disabled} aria-invalid={!Array.isArray(field.bits)} value={Array.isArray(field.bits) ? field.bits.join(":") : String(field.bits)}
                  onChange={(event) => updateField(index, { bits: event.target.value })} onBlur={(event) => { const bits = parseRegisterBits(event.target.value); if (bits) updateField(index, { bits }); }} /></TableCell>
                <TableCell><Input aria-label={`字段 ${index + 1} 名称`} disabled={disabled} value={field.name} onChange={(event) => updateField(index, { name: event.target.value })} /></TableCell>
                <TableCell><div className="skill-register-properties">
                  {(["scale", "offset"] as const).map((key) => <label key={key}>{key === "scale" ? "比例" : "偏移"}<Input type="number" step="any" aria-label={`字段 ${index + 1} ${key === "scale" ? "比例" : "偏移"}`} disabled={disabled} value={field[key] ?? ""} onChange={(event) => updateField(index, { [key]: event.target.value === "" ? undefined : Number(event.target.value) })} /></label>)}
                  <label>单位<Input aria-label={`字段 ${index + 1} 单位`} disabled={disabled} value={field.unit ?? ""} onChange={(event) => updateField(index, { unit: event.target.value || undefined })} /></label>
                  <label>有符号<input type="checkbox" aria-label={`字段 ${index + 1} 有符号`} disabled={disabled} checked={field.signed ?? false} onChange={(event) => updateField(index, { signed: event.target.checked })} /></label>
                </div></TableCell>
                <TableCell><div className="skill-register-properties"><div><span>枚举 JSON</span><EnumEditor label={`字段 ${index + 1} 枚举`} disabled={disabled} value={field.enum} onChange={(value) => updateField(index, { enum: value })} /></div>
                  <label>说明<Input aria-label={`字段 ${index + 1} 说明`} disabled={disabled} value={field.description ?? ""} onChange={(event) => updateField(index, { description: event.target.value || undefined })} /></label></div></TableCell>
                <TableCell><Button variant="ghost" size="sm" aria-label={`删除字段 ${index + 1}`} disabled={disabled} onClick={() => setDeleting({ label: "删除字段", remove: () => updateRegister({ ...register, fields: register.fields.filter((_, i) => i !== index) }) })}>删除</Button></TableCell>
              </TableRow>)}</TableBody></Table>
          </> : <p>添加寄存器后，编辑位段和物理含义。</p>}
        </section>
        <section aria-label="寄存器映射"><h3>寄存器映射</h3>
          <div className="skill-register-toolbar"><label>选择映射<SelectControl ariaLabel="选择映射" value={mapId} onValueChange={setMapIdSelection}
            options={Object.keys(maps).map((value) => ({ value, label: value }))} placeholder="暂无映射" /></label>
            <Button variant="outline" disabled={disabled} onClick={() => { const key = nextId("map", maps); write({ ...spec, registerMaps: { ...maps, [key]: { selectBy: fieldNames[0] ?? "", cases: {} } } }); setMapIdSelection(key); }}>新增映射</Button></div>
          {map ? <fieldset key={mapId} className="skill-register-map"><legend>映射设置</legend>
            <label>选择依据字段<SelectControl ariaLabel={`${mapId} 选择依据字段`} disabled={disabled} value={map.selectBy} options={fieldNames.map((value) => ({ value, label: value }))}
              onValueChange={(selectBy) => write({ ...spec, registerMaps: { ...spec.registerMaps, [mapId]: { ...map, selectBy } } })} /></label>
            {Object.entries(map.cases).map(([address, target], index) => <div className="skill-register-toolbar" key={index}>
              <label>地址 / 消息值<Input aria-label={`${mapId} 条件 ${index + 1}`} disabled={disabled} value={address} onChange={(event) => {
                if (event.target.value !== address && Object.hasOwn(map.cases, event.target.value)) return;
                const cases = Object.fromEntries(Object.entries(map.cases).map(([key, value]) => [key === address ? event.target.value : key, value]));
                write({ ...spec, registerMaps: { ...spec.registerMaps, [mapId]: { ...map, cases } } });
              }} /></label><label>寄存器<SelectControl ariaLabel={`${mapId} 寄存器 ${index + 1}`} disabled={disabled} value={target} options={Object.keys(registers).map((value) => ({ value, label: value }))}
                onValueChange={(value) => write({ ...spec, registerMaps: { ...spec.registerMaps, [mapId]: { ...map, cases: { ...map.cases, [address]: value } } } })} /></label>
              <Button variant="ghost" disabled={disabled} aria-label={`${mapId} 删除条件 ${index + 1}`} onClick={() => setDeleting({ label: "删除条件", remove: () => { const cases = { ...map.cases }; delete cases[address]; write({ ...spec, registerMaps: { ...spec.registerMaps, [mapId]: { ...map, cases } } }); } })}>删除</Button>
            </div>)}
            <Button variant="outline" disabled={disabled || !activeId} onClick={() => { let address = 0; while (Object.hasOwn(map.cases, String(address))) address++; write({ ...spec, registerMaps: { ...spec.registerMaps, [mapId]: { ...map, cases: { ...map.cases, [address]: activeId } } } }); }}>新增条件</Button>
            <label>默认寄存器<SelectControl ariaLabel={`${mapId} 默认寄存器`} disabled={disabled} value={map.default ?? ""} options={[{ value: "", label: "不匹配时报错" }, ...Object.keys(registers).map((value) => ({ value, label: value }))]}
              onValueChange={(value) => write({ ...spec, registerMaps: { ...spec.registerMaps, [mapId]: { ...map, default: value || undefined } } })} /></label>
            <Button variant="ghost" disabled={disabled} onClick={() => setDeleting({ label: "删除映射", remove: () => { const registerMaps = { ...spec.registerMaps }; delete registerMaps[mapId]; write({ ...spec, registerMaps }); } })}>删除映射</Button>
          </fieldset> : <p>添加映射后，配置条件和目标寄存器。</p>}
        </section>
        <FrameEditor spec={spec} onChange={write} disabled={disabled} events={selectedEvents} selectedLine={selectedLine} pending={pending} error={error} />
        <section aria-label="抽取字段绑定"><h3>抽取字段绑定</h3>
          {spec.extractors.flatMap((extractor, index) => Object.entries(extractor.fields).filter(([, field]) => ["int", "uint", "hex", "bytes", "hexbytes", "base64bytes"].includes(field.type)).map(([name, field]) => <label key={`${index}-${name}`}>{extractor.id}.{name}
            <SelectControl ariaLabel={`${extractor.id}.${name} 解码器`} disabled={disabled} value={"decode" in field && field.decode ? "register" in field.decode ? `register:${field.decode.register}` : "frame" in field.decode ? `frame:${field.decode.frame}` : `registerMap:${field.decode.registerMap}` : ""}
              options={[{ value: "", label: "无解码器" }, ...(["int", "uint", "hex"].includes(field.type) ? [...Object.keys(registers).map((value) => ({ value: `register:${value}`, label: `寄存器 · ${value}` })), ...Object.keys(spec.registerMaps ?? {}).map((value) => ({ value: `registerMap:${value}`, label: `映射 · ${value}` }))] : []), ...(["hex", "bytes", "hexbytes", "base64bytes"].includes(field.type) ? Object.keys(spec.frames ?? {}).map((value) => ({ value: `frame:${value}`, label: `帧 · ${value}` })) : [])]}
              onValueChange={(value) => { const [kind, target] = value.split(":"); const next = { ...field }; if ("decode" in next) delete next.decode;
                const bound = { ...next, ...(target ? { decode: kind === "register" ? { register: target } : kind === "frame" ? { frame: target } : { registerMap: target } } : {}) } as typeof field;
                write({ ...spec, extractors: spec.extractors.map((item, i) => i === index ? { ...item, fields: { ...item.fields, [name]: bound } } : item) }); }} />
          </label>))}
          {!spec.extractors.length ? <p>先在“样例与解析”添加数值抽取字段，再绑定寄存器或映射。</p> : null}
        </section>
      </>}
    </TabPanel>
    <ConfirmDialog open={!!deleting} title={`${deleting?.label ?? "删除"}？`} description="此项内容将从当前草稿中移除。" tone="danger" confirmLabel={deleting?.label ?? "删除"}
      onCancel={() => setDeleting(null)} onConfirm={() => { deleting?.remove(); setDeleting(null); }} />
    <ModalDialog open={pasteOpen} onDismiss={() => setPasteOpen(false)} describedBy className="skill-authoring-dialog skill-register-paste-dialog modal-card--lg">
      {({ titleId, descriptionId }) => <><h2 id={titleId}>粘贴寄存器表</h2><p id={descriptionId}>粘贴位、名称、说明三列，支持制表符、逗号、多空格或竖线分隔。最多 64 KiB、512 行。确认后将替换当前寄存器的全部字段，仅导入有效行。</p>
        <label htmlFor={`${id}-paste`}>数据手册表格</label><Textarea id={`${id}-paste`} aria-invalid={!!pasteIssue} aria-describedby={pasteIssue ? `${id}-paste-limit` : descriptionId} value={paste} onChange={(event) => setPaste(event.target.value)} />
        {pasteIssue ? <p id={`${id}-paste-limit`} className="skill-register-paste-limit" role="alert">{pasteIssue}</p> : null}
        <p role="status" className="skill-register-paste-summary">{pastePending ? "正在解析…" : pasteIssue ? "请缩小粘贴范围后重试。" : `可导入 ${validRows.length} 行 · ${invalidCount} 行无法识别`}</p>
        <Table aria-label="寄存器表预览"><TableHeader><TableRow><TableHead>行</TableHead><TableHead>字段 / 原文</TableHead><TableHead>结果</TableHead></TableRow></TableHeader>
          <TableBody>{!pasteIssue && !pastePending ? rows.map((row) => <TableRow key={row.line} data-tone={row.reason ? "invalid" : "valid"} aria-describedby={`${id}-paste-row-${row.line}`}><TableCell>{row.line}</TableCell><TableCell>{row.field ? `[${row.field.bits.join(":")}] ${row.field.name} ${row.field.description ?? ""}` : row.text}</TableCell><TableCell><span className="skill-register-paste-result" id={`${id}-paste-row-${row.line}`}>{row.reason ? <CircleAlert aria-hidden="true" /> : <CircleCheck aria-hidden="true" />}{row.reason ?? "可导入"}</span></TableCell></TableRow>) : null}</TableBody></Table>
        <div className="dialog-actions"><Button variant="outline" onClick={() => setPasteOpen(false)}>取消</Button>
          <Button disabled={disabled || !!pasteIssue || pastePending || !validRows.length} onClick={() => { updateRegister({ ...register, fields: validRows.flatMap((row) => row.field ? [row.field] : []) }); setPasteOpen(false); }}>替换当前字段并导入（{validRows.length}）</Button></div>
      </>}
    </ModalDialog>
  </section>;
}
