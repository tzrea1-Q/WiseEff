import { useEffect, useMemo, useRef, useState } from "react";
import { CircleAlert } from "lucide-react";
import { SelectControl } from "@/components/common/SelectControl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { decodedValueText } from "@/features/log-analysis/DecodedFields";
import { decodedOccurrences } from "./decodedOccurrences";
import type { ParsePreview, SkillSpec } from "./types";

type Parsing = NonNullable<SkillSpec["parsing"]>;
type Frame = NonNullable<Parsing["frames"]>[string];
type Field = Frame["fields"][number];
type Decoded = ParsePreview["events"][number]["fields"][string];
const types = ["uint", "int", "bytes", "register", "frame", "switch", "repeat", "tlv", "checksum"] as const;
const endianOptions = [{ value: "", label: "继承帧字节序" }, { value: "big", label: "大端" }, { value: "little", label: "小端" }];
const pathOrNumber = (value: string) => /^\d+$/.test(value) ? Number(value) : value;
function nextId(prefix: string, entries: object) { let index = 1; while (Object.hasOwn(entries, `${prefix}${index}`)) index++; return `${prefix}${index}`; }

function fixedLength(field: Field, frameLength: (id: string) => number | undefined): number | undefined {
  if (field.type === "switch" || field.type === "tlv" || field.type === "repeat" && typeof field.count !== "number") return;
  if ("length" in field && typeof field.length === "number") return field.length;
  if ("length" in field && typeof field.length === "string") return;
  if (field.type === "frame" || field.type === "repeat") {
    const length = frameLength(field.frame);
    if (length === undefined) return;
    const total = field.type === "repeat" ? length * Number(field.count) * (field.multiplier ?? 1) : length;
    return Number.isSafeInteger(total) ? total : undefined;
  }
}

function staticFrameLengths(frames: Record<string, Frame>) {
  const lengths = new Map<string, number | undefined>();
  const lengthOf = (id: string): number | undefined => {
    if (lengths.has(id)) return lengths.get(id);
    lengths.set(id, undefined); // Break cycles in invalid drafts without expanding references again.
    const frame = frames[id]; if (!frame) return;
    let total = 0;
    for (const field of frame.fields) {
      const length = fixedLength(field, lengthOf);
      if (length === undefined || !Number.isSafeInteger(total + length)) return;
      total += length;
    }
    lengths.set(id, total); return total;
  };
  for (const id of Object.keys(frames)) lengthOf(id);
  return lengths;
}

export function frameOffsets(frame: Frame, frames: Record<string, Frame>, lengths = staticFrameLengths(frames)) {
  let offset = 0, after = "";
  return frame.fields.map((field) => {
    const length = fixedLength(field, (id) => lengths.get(id));
    const result = { offset: after ? `+${offset} after ${after}` : String(offset), length };
    if (length === undefined) { after = field.name; offset = 0; } else offset += length;
    return result;
  });
}

export function renameFrameReferences(parsing: Parsing, kind: "frame" | "register", previous: string, next: string): Parsing {
  const reference = (value: { frame: string } | { register: string }): { frame: string } | { register: string } => {
    if (!value || typeof value !== "object") return value;
    if (kind === "frame" && "frame" in value && value.frame === previous) return { frame: next };
    if (kind === "register" && "register" in value && value.register === previous) return { register: next };
    return value;
  };
  return { ...parsing, frames: Object.fromEntries(Object.entries(parsing.frames ?? {}).map(([id, frame]) => [id, { ...frame, fields: frame.fields.map((field) => {
    const updated = { ...field };
    if (kind === "frame" && "frame" in updated && updated.frame === previous) updated.frame = next;
    if (kind === "register" && "register" in updated && updated.register === previous) updated.register = next;
    if (updated.type === "switch" || updated.type === "tlv") {
      if (updated.cases && typeof updated.cases === "object") updated.cases = Object.fromEntries(Object.entries(updated.cases).map(([key, value]) => [key, reference(value)]));
      if (updated.type === "switch" && updated.default) updated.default = reference(updated.default) as typeof updated.default;
    }
    return updated;
  }) }])), extractors: parsing.extractors.map((extractor) => ({ ...extractor,
    fields: Object.fromEntries(Object.entries(extractor.fields).map(([name, field]) => [name, "decode" in field && field.decode && kind in field.decode
      ? { ...field, decode: reference(field.decode as { frame: string } | { register: string }) } : field])) as typeof extractor.fields
  })) };
}

function JsonOption({ label, value, disabled, onChange }: { label: string; value: unknown; disabled: boolean; onChange: (value: unknown) => void }) {
  const invalid = typeof value === "string";
  return <label>{label}<Input aria-label={label} disabled={disabled} aria-invalid={invalid} value={typeof value === "string" ? value : value === undefined ? "" : JSON.stringify(value)}
    onChange={(event) => { try { onChange(event.target.value ? JSON.parse(event.target.value) : undefined); } catch { onChange(event.target.value); } }} />{invalid ? <span role="alert">请输入有效的 JSON。</span> : null}</label>;
}

function fieldDefault(type: Field["type"], name: string, frames: Record<string, Frame>, registers: NonNullable<Parsing["registers"]>): Field {
  const frame = Object.keys(frames)[0] ?? "", register = Object.keys(registers)[0] ?? "";
  switch (type) {
    case "uint": case "int": case "bytes": return { name, type, length: 1 };
    case "register": return { name, type, length: 1, register };
    case "frame": return { name, type, frame };
    case "switch": return { name, type, on: "", cases: {} };
    case "repeat": return { name, type, frame, count: 1 };
    case "tlv": return { name, type, tagSize: 1, lengthSize: 1, cases: {} };
    case "checksum": return { name, type, algorithm: "sum8", range: [0, 1], length: 1 };
  }
}

function frameErrorText(issue: { code: string; message: string }): string {
  const short = /^Field (.+) requires (\d+) bytes at offset (\d+); only (\d+) remain$/.exec(issue.message);
  if (issue.code === "frame_range" && short) return `字段 ${short[1]} 需要 ${short[2]} 个字节（偏移 ${short[3]}），仅剩 ${short[4]} 个字节`;
  const messages: Record<string, string> = {
    frame_encoding: "帧必须包含完整的十六进制字节。", frame_length: "帧长度必须为 0 至 4096 个字节的整数。",
    frame_depth: "帧和寄存器嵌套超过 8 层。", frame_reference: "找不到先前解码字段或引用的帧、寄存器。",
    frame_elements: "帧展开元素超过每事件 1024 个的上限。", frame_range: "字段字节不足、长度不匹配或校验范围无效，请检查帧布局。",
    repeat_count: "重复次数必须为 0 至 256 的整数（包含倍数）。", tlv_items: "TLV 项数超过 256 个的上限。",
    checksum_mismatch: "校验和不匹配，请检查帧字节。", unmatched_switch: "未匹配到帧或寄存器分支，请检查选择字段与默认分支。"
  };
  return messages[issue.code] ?? "帧解码失败，请检查字段定义和样例内容。";
}

function frameValueText(field: Field, value: Decoded): string {
  const text = decodedValueText(value);
  if (field.type !== "uint" && field.type !== "int") return text;
  if (value && typeof value === "object" && "value" in value && (value.unit !== undefined || value.meaning !== undefined)) return text;
  const scalar = value && typeof value === "object" && "value" in value ? value.value : value;
  if (!(typeof scalar === "number" && Number.isSafeInteger(scalar) || typeof scalar === "string" && /^[+-]?\d+$/.test(scalar))) return text;
  const integer = BigInt(scalar);
  return `${text} (${integer < 0n ? "-" : ""}0x${(integer < 0n ? -integer : integer).toString(16)})`;
}

export function FrameEditor({ spec, onChange, disabled, events, selectedLine, pending, error }: {
  spec: Parsing; onChange: (spec: Parsing) => void; disabled: boolean; events: ParsePreview["events"]; selectedLine?: number | null; pending: boolean; error?: string;
}) {
  const [selection, setSelection] = useState<{ id: string; line: typeof selectedLine } | null>(null);
  const setSelectedId = (id: string) => setSelection({ id, line: selectedLine });
  const [fieldSelection, setFieldSelection] = useState<{ frame: string; index: number; item?: string; line: typeof selectedLine } | null>(null);
  const setSelected = (value: { frame: string; index: number; item?: string } | null) => setFieldSelection(value ? { ...value, line: selectedLine } : null);
  const selected = fieldSelection?.line === selectedLine ? fieldSelection : null;
  const frames = spec.frames ?? {}, registers = spec.registers ?? {};
  const occurrences = useMemo(() => decodedOccurrences(spec, events), [spec, events]);
  const roots = occurrences.filter((item) => "frame" in item.decoder && item.path.length === 1);
  const root = roots.find(({ value }) => value && typeof value === "object" && "fields" in value && value.fields) ?? roots[0];
  const bound = spec.extractors.flatMap((extractor) => Object.values(extractor.fields).flatMap((field) => "decode" in field && field.decode && "frame" in field.decode ? [field.decode.frame] : []));
  const activeId = selection && selection.line === selectedLine && Object.hasOwn(frames, selection.id) ? selection.id
    : root && "frame" in root.decoder ? root.decoder.frame : bound.find((id) => Object.hasOwn(frames, id)) ?? Object.keys(frames)[0] ?? "";
  const frame = frames[activeId];
  const update = (next: Frame) => onChange({ ...spec, frames: { ...frames, [activeId]: next } });
  const patch = (index: number, change: Record<string, unknown>) => update({ ...frame, fields: frame.fields.map((field, i) => i === index ? { ...field, ...change } as Field : field) });
  const matched = (root && "frame" in root.decoder && root.decoder.frame === activeId ? root : occurrences.find((item) => "frame" in item.decoder && item.decoder.frame === activeId))?.value;
  const decoded = matched && typeof matched === "object" && "fields" in matched ? matched.fields : undefined;
  const raw = matched && typeof matched === "object" && "value" in matched && matched.value && typeof matched.value === "object" && "hex" in matched.value
    ? matched.value.hex : matched && typeof matched === "object" && "raw" in matched ? matched.raw.replace(/0x/gi, "").replace(/\s/g, "") : "";
  const bytes = /^[\da-f]*$/i.test(raw) && raw.length % 2 === 0 ? raw.match(/../g) ?? [] : [];
  const spanOf = (value: Decoded | undefined) => {
    return value && typeof value === "object" && "byteOffset" in value && typeof value.byteOffset === "number" && "byteLength" in value && typeof value.byteLength === "number"
      ? { offset: value.byteOffset - (matched && typeof matched === "object" && "byteOffset" in matched ? matched.byteOffset ?? 0 : 0), length: value.byteLength } : null;
  };
  const spans = frame?.fields.map((field) => spanOf(decoded?.[field.name])) ?? [];
  const repeatItems = frame?.fields.map((field) => {
    const value = decoded?.[field.name];
    return field.type === "repeat" && value && typeof value === "object" && "fields" in value && value.fields
      ? Object.entries(value.fields).map(([key, value]) => ({ key, value, span: spanOf(value) })) : [];
  }) ?? [];
  const selectedField = selected?.frame === activeId && (selected.item === undefined || repeatItems[selected.index]?.some((item) => item.key === selected.item)) ? selected.index : -1;
  const selectedSpan = selected?.item !== undefined ? repeatItems[selectedField]?.find((item) => item.key === selected.item)?.span : spans[selectedField];
  const lengths = useMemo(() => staticFrameLengths(frames), [frames]);
  const offsets = useMemo(() => frame ? frameOffsets(frame, frames, lengths) : [], [frame, frames, lengths]);
  const selectedName = frame?.fields[selectedField]?.name ? `${frame.fields[selectedField].name}${selected?.item !== undefined ? ` › ${selected.item}` : ""}` : undefined;
  const frameOptions = Object.keys(frames).map((value) => ({ value, label: value }));
  const registerOptions = [{ value: "", label: "无寄存器" }, ...Object.keys(registers).map((value) => ({ value, label: value }))];
  const hexRef = useRef<HTMLDivElement>(null);
  const [bytesPerRow, setBytesPerRow] = useState(4);
  useEffect(() => {
    const hex = hexRef.current; if (!hex) return;
    const measure = () => {
      const row = hex.querySelector<HTMLElement>(".skill-frame-hex-row"), gutter = row?.querySelector<HTMLElement>(".skill-frame-hex-offset");
      if (!row || !gutter) return;
      const width = hex.getBoundingClientRect().width, cell = gutter.getBoundingClientRect().width;
      if (!width || !cell) return;
      const gap = Number.parseFloat(getComputedStyle(row).columnGap) || 0;
      setBytesPerRow([16, 8, 4].find((count) => cell * (count + 1) + gap * count <= width) ?? 4);
    };
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : undefined;
    observer?.observe(hex); measure();
    return () => observer?.disconnect();
  }, [activeId, bytes.length]);
  return <section aria-label="帧" className="skill-frames"><h3>帧</h3>
    <div className="skill-register-toolbar"><label>选择帧<SelectControl ariaLabel="选择帧" value={activeId} onValueChange={setSelectedId} options={frameOptions} placeholder="暂无帧" /></label>
      <Button variant="outline" disabled={disabled} onClick={() => { const key = nextId("frame", frames); onChange({ ...spec, frames: { ...frames, [key]: { fields: [] } } }); setSelectedId(key); }}>新增帧</Button></div>
    {!frame ? <p>添加帧后，按字节顺序定义字段。</p> : <>
      <div className="skill-register-toolbar"><label>帧标识<Input disabled={disabled} value={activeId} onChange={(event) => {
        const key = event.target.value;
        if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,99}$/.test(key) || Object.hasOwn(frames, key)) return;
        const next = { ...frames }; delete next[activeId]; next[key] = frame;
        onChange(renameFrameReferences({ ...spec, frames: next }, "frame", activeId, key)); setSelectedId(key); setSelected(null);
      }} /></label><label>帧默认字节序<SelectControl ariaLabel="帧默认字节序" disabled={disabled} value={frame.endian ?? "big"} options={endianOptions.slice(1)} onValueChange={(value) => update({ ...frame, endian: value as Frame["endian"] })} /></label>
        <Button variant="ghost" disabled={disabled} onClick={() => { const next = { ...frames }; delete next[activeId]; onChange({ ...spec, frames: next }); }}>删除帧</Button></div>
      <p>{selectedLine ? `帧样例第 ${selectedLine} 行${pending ? " · 解码中…" : ""}` : "选择右侧样例行，查看帧字节和字段值。"}</p>
      {error ? <p role="alert">{error}</p> : null}
      {events.flatMap((event) => event.errors ?? []).filter((issue) => /^(?:frame_|repeat_|tlv_|checksum|unmatched_switch)/.test(issue.code)).map((issue, i) => <p role="alert" className="skill-register-unmatched" key={i} title={`${issue.code}: ${issue.message}`}><CircleAlert aria-hidden="true" /><span>{issue.field ? `${issue.field}：` : ""}{frameErrorText(issue)}</span></p>)}
      <Button variant="outline" disabled={disabled} onClick={() => update({ ...frame, fields: [...frame.fields, { name: nextId("field", Object.fromEntries(frame.fields.map((field) => [field.name, true]))), type: "uint", length: 1 }] })}>新增帧字段</Button>
      <Table aria-label="帧字段表" className="skill-frame-table"><TableHeader><TableRow>{["偏移 / 长度", "名称 / 类型", "字节序 / 选项", "样例值", "操作"].map((name) => <TableHead key={name}>{name}</TableHead>)}</TableRow></TableHeader>
        <TableBody>{frame.fields.map((field, index) => {
          const label = `帧字段 ${index + 1}`, value: Decoded | undefined = decoded?.[field.name];
          const checksum = value && typeof value === "object" && "checksum" in value ? value.checksum : undefined;
          const numberInput = (key: string, title: string, current: number | undefined) => <label>{title}<Input aria-label={`${label} ${title}`} disabled={disabled} type="number" step="any" value={current ?? ""} onChange={(event) => patch(index, { [key]: event.target.value === "" ? undefined : Number(event.target.value) })} /></label>;
          return <TableRow key={index} data-selected={index === selectedField || undefined} onClick={() => setSelected({ frame: activeId, index })}>
            <TableCell><Button variant="ghost" size="sm" aria-label={`选择帧字段 ${field.name}`} aria-pressed={index === selectedField} onClick={() => setSelected({ frame: activeId, index })}>{index === selectedField ? "▶ " : ""}{offsets[index].offset}</Button>
              {field.type !== "repeat" ? <label>长度<Input aria-label={`${label} 长度`} disabled={disabled} value={field.length ?? ""} placeholder="自动 / 先前字段路径" onChange={(event) => patch(index, { length: event.target.value ? pathOrNumber(event.target.value) : undefined })} /></label> : <span>{offsets[index].length ?? "可变"}</span>}</TableCell>
            <TableCell><label>名称<Input aria-label={`${label} 名称`} disabled={disabled} value={field.name} onChange={(event) => patch(index, { name: event.target.value })} /></label>
              <label>类型<SelectControl ariaLabel={`${label} 类型`} disabled={disabled} value={field.type} options={types.map((value) => ({ value, label: value }))} onValueChange={(value) => update({ ...frame, fields: frame.fields.map((item, i) => i === index ? fieldDefault(value as Field["type"], field.name, Object.fromEntries(Object.entries(frames).filter(([id]) => id !== activeId)), registers) : item) })} /></label></TableCell>
            <TableCell><div className="skill-register-properties">
              {["uint", "int", "register", "switch", "tlv", "checksum"].includes(field.type) ? <label>字节序<SelectControl ariaLabel={`${label} 字节序`} disabled={disabled} value={"endian" in field ? field.endian ?? "" : ""} options={endianOptions} onValueChange={(value) => patch(index, { endian: value || undefined })} /></label> : null}
              {field.type === "uint" || field.type === "int" ? <details><summary>比例、单位与枚举</summary><div className="skill-register-properties">{numberInput("scale", "比例", field.scale)}{numberInput("offset", "偏移", field.offset)}<label>单位<Input aria-label={`${label} 单位`} disabled={disabled} value={field.unit ?? ""} onChange={(event) => patch(index, { unit: event.target.value || undefined })} /></label>
                <JsonOption label={`${label} 枚举 JSON`} disabled={disabled} value={field.enum} onChange={(value) => patch(index, { enum: value })} /></div></details> : null}
              {field.type === "uint" || field.type === "int" || field.type === "register" ? <label>寄存器<SelectControl ariaLabel={`${label} 寄存器`} disabled={disabled} value={field.register ?? ""} options={registerOptions} onValueChange={(value) => patch(index, { register: value || undefined })} /></label> : null}
              {field.type === "frame" || field.type === "repeat" ? <label>子帧<SelectControl ariaLabel={`${label} 子帧`} disabled={disabled} value={field.frame} options={frameOptions.filter((option) => option.value !== activeId)} onValueChange={(value) => patch(index, { frame: value })} /></label> : null}
              {field.type === "repeat" ? <><label>次数 / count 路径<Input aria-label={`${label} 次数`} disabled={disabled} value={field.count} onChange={(event) => patch(index, { count: pathOrNumber(event.target.value) })} /></label>{numberInput("multiplier", "次数倍数", field.multiplier)}</> : null}
              {field.type === "switch" ? <><label>选择字段路径<Input aria-label={`${label} 选择字段路径`} disabled={disabled} value={field.on} onChange={(event) => patch(index, { on: event.target.value })} /></label>
                <JsonOption label={`${label} 默认目标 JSON`} disabled={disabled} value={field.default} onChange={(value) => patch(index, { default: value })} /></> : null}
              {field.type === "switch" || field.type === "tlv" ? <JsonOption label={`${label} 条件 JSON`} disabled={disabled} value={field.cases} onChange={(value) => patch(index, { cases: value ?? {} })} /> : null}
              {field.type === "tlv" ? <>{numberInput("tagSize", "标签字节数", field.tagSize)}{numberInput("lengthSize", "长度字节数", field.lengthSize)}</> : null}
              {field.type === "checksum" ? <><label>校验算法<SelectControl ariaLabel={`${label} 校验算法`} disabled={disabled} value={field.algorithm} options={["sum8", "xor8", "crc8", "crc16-ccitt", "crc16-modbus", "crc32"].map((algorithm) => ({ value: algorithm, label: algorithm }))} onValueChange={(algorithm) => patch(index, { algorithm })} /></label>
                <label>覆盖起点<Input aria-label={`${label} 覆盖起点`} type="number" disabled={disabled} value={field.range[0]} onChange={(event) => patch(index, { range: [Number(event.target.value), field.range[1]] })} /></label>
                <label>覆盖终点（不含）<Input aria-label={`${label} 覆盖终点`} type="number" disabled={disabled} value={field.range[1]} onChange={(event) => patch(index, { range: [field.range[0], Number(event.target.value)] })} /></label></> : null}
            </div></TableCell>
            <TableCell><output aria-label={`${field.name} 解码值`}>{value === undefined ? "—" : frameValueText(field, value)}</output>
              {repeatItems[index].length ? <div role="group" aria-label={`${field.name} 重复项`}>{repeatItems[index].map((item) => <Button key={item.key} variant="ghost" size="sm" aria-label={`选择重复项 ${field.name} › ${item.key}`} aria-pressed={selectedField === index && selected?.item === item.key}
                onClick={(event) => { event.stopPropagation(); setSelected({ frame: activeId, index, item: item.key }); }}>{item.key} · {decodedValueText(item.value)}</Button>)}</div> : null}
              {checksum ? <p role="status" aria-label={`${field.name} 校验状态`} className="skill-frame-checksum" data-ok={checksum.ok}>{checksum.ok ? "✓ 校验通过" : "✕ 校验失败"} · 期望 {checksum.expected} / 实际 {checksum.actual}</p> : null}</TableCell>
            <TableCell><Button variant="ghost" size="sm" disabled={disabled || index === 0} aria-label={`${label} 上移`} onClick={() => { const fields = [...frame.fields]; [fields[index - 1], fields[index]] = [fields[index], fields[index - 1]]; update({ ...frame, fields }); setSelected(null); }}>上移</Button>
              <Button variant="ghost" size="sm" disabled={disabled} aria-label={`删除帧字段 ${index + 1}`} onClick={() => { update({ ...frame, fields: frame.fields.filter((_, i) => i !== index) }); setSelected(null); }}>删除</Button></TableCell>
          </TableRow>;
        })}</TableBody></Table>
      <div ref={hexRef} className="skill-frame-hex" role="group" aria-label="帧十六进制视图"><p aria-live="polite">{selectedName ? `已选字段：${selectedName}（边框与粗体标记字节）` : "选择字段或字节，查看对应范围。"}</p>
        {!bytes.length ? <p>此行暂无该帧的字节预览。</p> : Array.from({ length: Math.ceil(bytes.length / bytesPerRow) }, (_, row) => <div className="skill-frame-hex-row" style={{ gridTemplateColumns: `minmax(0, var(--space-10)) repeat(${bytesPerRow}, minmax(0, 1fr))` }} key={row}><span className="skill-frame-hex-offset">{(row * bytesPerRow).toString(16).padStart(4, "0")}</span>
          {bytes.slice(row * bytesPerRow, (row + 1) * bytesPerRow).map((byte, col) => {
            const offset = row * bytesPerRow + col, fieldIndex = spans.findIndex((span) => span && offset >= span.offset && offset < span.offset + span.length);
            const fieldName = frame.fields[fieldIndex]?.name, item = repeatItems[fieldIndex]?.find(({ span }) => span && offset >= span.offset && offset < span.offset + span.length);
            const active = !!selectedSpan && offset >= selectedSpan.offset && offset < selectedSpan.offset + selectedSpan.length;
            return <button type="button" key={offset} className="skill-frame-byte" aria-label={`字节 ${offset}：${byte.toUpperCase()}${fieldName ? `，字段 ${fieldName}` : ""}${item ? `，重复项 ${item.key}` : ""}`} aria-pressed={active} disabled={fieldIndex < 0} onClick={() => setSelected({ frame: activeId, index: fieldIndex, ...(item ? { item: item.key } : {}) })}>{byte.toUpperCase()}</button>;
          })}</div>)}</div>
    </>}
  </section>;
}
