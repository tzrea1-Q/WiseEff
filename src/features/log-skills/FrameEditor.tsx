import { useState } from "react";
import { registerCaseKey } from "@wiseeff/dto-schemas";
import { SelectControl } from "@/components/common/SelectControl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { decodedValueText } from "@/features/log-analysis/DecodedFields";
import type { ParsePreview, SkillSpec } from "./types";

type Parsing = NonNullable<SkillSpec["parsing"]>;
type Frame = NonNullable<Parsing["frames"]>[string];
type Field = Frame["fields"][number];
type Decoded = ParsePreview["events"][number]["fields"][string];
const types = ["uint", "int", "bytes", "register", "frame", "switch", "repeat", "tlv", "checksum"] as const;
const endianOptions = [{ value: "", label: "继承帧字节序" }, { value: "big", label: "大端" }, { value: "little", label: "小端" }];
const pathOrNumber = (value: string) => /^\d+$/.test(value) ? Number(value) : value;
function nextId(prefix: string, entries: object) { let index = 1; while (Object.hasOwn(entries, `${prefix}${index}`)) index++; return `${prefix}${index}`; }

function fixedLength(field: Field, frames: Record<string, Frame>, seen = new Set<string>()): number | undefined {
  if ("length" in field && typeof field.length === "number") return field.length;
  if ("length" in field && typeof field.length === "string") return;
  if ((field.type === "frame" || field.type === "repeat") && !seen.has(field.frame)) {
    const nested = frames[field.frame];
    if (!nested) return;
    const lengths = nested.fields.map((item) => fixedLength(item, frames, new Set([...seen, field.frame])));
    if (lengths.some((length) => length === undefined)) return;
    const length = lengths.reduce<number>((sum, item) => sum + (item ?? 0), 0);
    if (field.type === "repeat") return typeof field.count === "number" ? length * field.count * (field.multiplier ?? 1) : undefined;
    return length;
  }
}

export function frameOffsets(frame: Frame, frames: Record<string, Frame>) {
  let offset = 0, after = "";
  return frame.fields.map((field) => {
    const length = fixedLength(field, frames);
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

function nestedFrameValue(id: string, value: Decoded, target: string, frames: Record<string, Frame>, captures: Record<string, Decoded>, depth = 1): Decoded | undefined {
  if (id === target) return value;
  if (depth >= 8 || !value || typeof value !== "object" || !("fields" in value) || !value.fields) return;
  const children = value.fields;
  const scalarAt = (path: string) => {
    let current: Decoded | undefined;
    path.split(".").forEach((name, index) => { current = index === 0 ? children[name] ?? captures[name] : current && typeof current === "object" && "fields" in current ? current.fields?.[name] : undefined; });
    return current && typeof current === "object" && "value" in current ? current.value : current;
  };
  for (const field of frames[id]?.fields ?? []) {
    const child = children[field.name];
    if (!child || typeof child !== "object" || !("fields" in child)) continue;
    const candidates: Array<{ frame: string; value: Decoded }> = [];
    if (field.type === "frame") candidates.push({ frame: field.frame, value: child });
    if (field.type === "repeat") candidates.push(...Object.values(child.fields ?? {}).map((value) => ({ frame: field.frame, value })));
    if (field.type === "switch") {
      const ref = Object.entries(field.cases).find(([key]) => registerCaseKey(key) === registerCaseKey(String(scalarAt(field.on))))?.[1] ?? field.default;
      if (ref && "frame" in ref) candidates.push({ frame: ref.frame, value: child });
    }
    if (field.type === "tlv") for (const item of Object.values(child.fields ?? {})) {
      if (!item || typeof item !== "object" || !("fields" in item) || !item.fields) continue;
      const tag = item.fields.tag;
      const scalar = tag && typeof tag === "object" && "value" in tag ? tag.value : tag;
      const ref = Object.entries(field.cases).find(([key]) => registerCaseKey(key) === registerCaseKey(String(scalar)))?.[1];
      if (ref && "frame" in ref && item.fields.payload) candidates.push({ frame: ref.frame, value: item.fields.payload });
    }
    for (const candidate of candidates) {
      const found = nestedFrameValue(candidate.frame, candidate.value, target, frames, captures, depth + 1);
      if (found) return found;
    }
  }
}

export function FrameEditor({ spec, onChange, disabled, events, selectedLine, pending, error }: {
  spec: Parsing; onChange: (spec: Parsing) => void; disabled: boolean; events: ParsePreview["events"]; selectedLine?: number | null; pending: boolean; error?: string;
}) {
  const [selectedId, setSelectedId] = useState("");
  const [selected, setSelected] = useState<{ frame: string; index: number } | null>(null);
  const frames = spec.frames ?? {}, registers = spec.registers ?? {};
  const activeId = Object.hasOwn(frames, selectedId) ? selectedId : Object.keys(frames)[0] ?? "";
  const frame = frames[activeId];
  const selectedField = selected?.frame === activeId ? selected.index : -1;
  const update = (next: Frame) => onChange({ ...spec, frames: { ...frames, [activeId]: next } });
  const patch = (index: number, change: Record<string, unknown>) => update({ ...frame, fields: frame.fields.map((field, i) => i === index ? { ...field, ...change } as Field : field) });
  const matched = events.flatMap((event) => Object.entries(event.fields).flatMap(([name, value]) => {
    const binding = spec.extractors.find((extractor) => extractor.id === event.extractor)?.fields[name];
    if (!binding || !("decode" in binding) || !binding.decode || !("frame" in binding.decode)) return [];
    const found = nestedFrameValue(binding.decode.frame, value, activeId, frames, event.fields);
    return found === undefined ? [] : [found];
  }))[0];
  const decoded = matched && typeof matched === "object" && "fields" in matched ? matched.fields : undefined;
  const raw = matched && typeof matched === "object" && "value" in matched && matched.value && typeof matched.value === "object" && "hex" in matched.value
    ? matched.value.hex : matched && typeof matched === "object" && "raw" in matched ? matched.raw.replace(/0x/gi, "").replace(/\s/g, "") : "";
  const bytes = /^[\da-f]*$/i.test(raw) && raw.length % 2 === 0 ? raw.match(/../g) ?? [] : [];
  const spans = frame?.fields.map((field) => {
    const value = decoded?.[field.name];
    return value && typeof value === "object" && "byteOffset" in value && typeof value.byteOffset === "number" && "byteLength" in value && typeof value.byteLength === "number"
      ? { offset: value.byteOffset - (matched && typeof matched === "object" && "byteOffset" in matched ? matched.byteOffset ?? 0 : 0), length: value.byteLength } : null;
  }) ?? [];
  const offsets = frame ? frameOffsets(frame, frames) : [];
  const selectedName = frame?.fields[selectedField]?.name;
  const frameOptions = Object.keys(frames).map((value) => ({ value, label: value }));
  const registerOptions = [{ value: "", label: "无寄存器" }, ...Object.keys(registers).map((value) => ({ value, label: value }))];
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
      {events.flatMap((event) => event.errors ?? []).filter((issue) => /^(?:frame_|repeat_|tlv_|checksum|unmatched_switch)/.test(issue.code)).map((issue, i) => <p role="alert" key={i} title={`${issue.code}: ${issue.message}`}>{issue.field ? `${issue.field}：` : ""}帧解码失败：{issue.message}</p>)}
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
            <TableCell><output aria-label={`${field.name} 解码值`}>{value === undefined ? "—" : decodedValueText(value)}</output>
              {checksum ? <p role="status" aria-label={`${field.name} 校验状态`} className="skill-frame-checksum" data-ok={checksum.ok}>{checksum.ok ? "✓ 校验通过" : "✕ 校验失败"} · 期望 {checksum.expected} / 实际 {checksum.actual}</p> : null}</TableCell>
            <TableCell><Button variant="ghost" size="sm" disabled={disabled || index === 0} aria-label={`${label} 上移`} onClick={() => { const fields = [...frame.fields]; [fields[index - 1], fields[index]] = [fields[index], fields[index - 1]]; update({ ...frame, fields }); setSelected(null); }}>上移</Button>
              <Button variant="ghost" size="sm" disabled={disabled} aria-label={`删除帧字段 ${index + 1}`} onClick={() => { update({ ...frame, fields: frame.fields.filter((_, i) => i !== index) }); setSelected(null); }}>删除</Button></TableCell>
          </TableRow>;
        })}</TableBody></Table>
      <div className="skill-frame-hex" role="group" aria-label="帧十六进制视图"><p aria-live="polite">{selectedName ? `已选字段：${selectedName}（▶ 与边框标记字节）` : "选择字段或字节，查看对应范围。"}</p>
        {!bytes.length ? <p>此行暂无该帧的字节预览。</p> : Array.from({ length: Math.ceil(bytes.length / 16) }, (_, row) => <div className="skill-frame-hex-row" key={row}><span className="skill-frame-hex-offset">{(row * 16).toString(16).padStart(4, "0")}</span>
          {bytes.slice(row * 16, row * 16 + 16).map((byte, col) => {
            const offset = row * 16 + col, fieldIndex = spans.findIndex((span) => span && offset >= span.offset && offset < span.offset + span.length);
            const fieldName = frame.fields[fieldIndex]?.name, active = selectedField >= 0 && fieldIndex === selectedField;
            return <button type="button" key={offset} className="skill-frame-byte" aria-label={`字节 ${offset}：${byte.toUpperCase()}${fieldName ? `，字段 ${fieldName}` : ""}`} aria-pressed={active} disabled={fieldIndex < 0} onClick={() => setSelected({ frame: activeId, index: fieldIndex })}><span aria-hidden="true">{active ? "▶" : ""}</span>{byte.toUpperCase()}</button>;
          })}</div>)}</div>
    </>}
  </section>;
}
