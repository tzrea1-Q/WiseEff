import { useEffect, useRef, useState, type FormEvent } from "react";
import type { DtsConfigSet, DtsReleaseBaseline } from "@/application/ports/DtsStructuredRepository";
import { ModalDialog } from "@/components/common/ModalDialog";
import { SelectControl } from "@/components/common/SelectControl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import type { ConfigurationCorrectionClient, JsonCorrection, JsonCorrectionOptions, SourceCorrectionPreview } from "@/infrastructure/http/configurationCorrectionClient";

export type WorkbenchCorrection =
  | { kind: "config"; item: DtsConfigSet }
  | { kind: "baseline"; item: DtsReleaseBaseline }
  | { kind: "path" | "json"; fileId: string; fileName: string; configSetId: string };

type Props = {
  target: WorkbenchCorrection;
  client: ConfigurationCorrectionClient;
  onClose: () => void;
  onSaved: () => void;
};

type Diagnostic = { sourceName?: string; line?: number; column?: number; message?: string };
const emptyMapping = () => ({ definitionId: "", pointer: "" });

export function WorkbenchCorrectionDialog({ target, client, onClose, onSaved }: Props) {
  const [name, setName] = useState(target.kind === "config" || target.kind === "baseline" ? target.item.name : target.fileName);
  const [notes, setNotes] = useState(target.kind === "config" ? target.item.description ?? ""
    : target.kind === "baseline" && target.item.status === "draft" ? target.item.notes ?? "" : "");
  const [reason, setReason] = useState("");
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  const [options, setOptions] = useState<JsonCorrectionOptions>();
  const [occurrenceId, setOccurrenceId] = useState("");
  const [json, setJson] = useState<JsonCorrection>({ configurationSchemaId: "", rootPointer: "", mappings: [] });
  const [preview, setPreview] = useState<SourceCorrectionPreview>();
  const [mutationId, setMutationId] = useState("");
  const firstInput = useRef<HTMLInputElement>(null);
  const reasonInput = useRef<HTMLInputElement>(null);
  const [readAttempt, setReadAttempt] = useState(0);
  const erratum = target.kind === "baseline" && target.item.status !== "draft";
  const fromSources = target.kind === "path" || target.kind === "json";
  const current = options?.items.find(item => item.occurrenceId === occurrenceId);
  const schema = options?.schemas.find(item => item.id === json.configurationSchemaId);
  const title = { config: "更正配置集资料", baseline: erratum ? "追加版本勘误" : "更正草稿版本资料",
    path: "更正项目文件路径", json: "更正 JSON 实例关联" }[target.kind];

  function selectInstance(item: JsonCorrectionOptions["items"][number]) {
    setOccurrenceId(item.occurrenceId);
    setJson({ configurationSchemaId: item.configurationSchemaId, rootPointer: item.rootPointer,
      mappings: item.bindings.map(({ definitionId, pointer }) => ({ definitionId, pointer })) });
  }

  useEffect(() => {
    if (target.kind !== "json") return;
    let cancelled = false;
    void client.listInstances(target.fileId).then(result => {
      if (cancelled) return;
      setOptions(result);
      if (result.items[0]) selectInstance(result.items[0]);
    }).catch((failure: unknown) => {
      if (!cancelled) setError(failure instanceof Error ? failure.message : "无法读取 JSON 实例。");
    });
    return () => { cancelled = true; };
  }, [client, readAttempt, target]);

  useEffect(() => {
    if (preview && !busy) reasonInput.current?.focus();
  }, [busy, preview]);

  function revise() {
    setPreview(undefined);
    setError("");
    setDiagnostics([]);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setDiagnostics([]);
    try {
      if (target.kind === "config") await client.updateSet(target.item.id, { name: name.trim(), description: notes.trim() || null });
      else if (target.kind === "baseline") {
        if (erratum) await client.appendErratum(target.item.id, { note: notes.trim(), source: source.trim() });
        else await client.updateBaseline(target.item.id, { name: name.trim(), notes: notes.trim() || null });
      } else if (!preview) {
        const response = target.kind === "path" ? await client.previewPath(target.configSetId, target.fileId, name)
          : await client.previewJson(target.fileId, occurrenceId, json);
        setPreview(response.item);
        setMutationId(crypto.randomUUID());
        return;
      } else {
        const confirmation = { reason: reason.trim(), proofToken: preview.proofToken, clientMutationId: mutationId };
        if (target.kind === "path") await client.applyPath(target.configSetId, target.fileId, { sourceName: name, ...confirmation });
        else await client.applyJson(target.fileId, occurrenceId, { ...json, ...confirmation });
      }
      onSaved();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "更正失败，请重试。");
      if (failure instanceof WiseEffApiError && Array.isArray(failure.details.diagnostics)) {
        setDiagnostics(failure.details.diagnostics as Diagnostic[]);
      }
    } finally {
      setBusy(false);
    }
  }

  const incomplete = target.kind === "json"
    ? !current || !schema || !json.mappings.length || json.mappings.some(row => !row.definitionId)
    : erratum ? !notes.trim() || !source.trim()
      : !name.trim() || (target.kind === "path" && name === target.fileName);
  const valueText = (value: unknown) => JSON.stringify(value) ?? "—";

  return <ModalDialog open onDismiss={busy ? undefined : onClose} initialFocusRef={firstInput}
    className="workbench-configuration-files-dialog max-w-xl" backdropClassName="param-admin-modal-backdrop" describedBy>
    {({ titleId, descriptionId }) => <>
      <header className="workbench-configuration-files-dialog__header">
        <div><h2 id={titleId}>{title}</h2><p id={descriptionId}>{target.kind === "config" || target.kind === "baseline" ? target.item.name : target.fileName}</p></div>
      </header>
      <form onSubmit={event => { void submit(event); }} className="workbench-configuration-files-dialog__body flex flex-col gap-4">
        <fieldset disabled={busy} className="grid min-w-0 gap-3">
          {target.kind === "config" || target.kind === "baseline" ? <>
            {!erratum ? <label className="grid gap-1">名称<Input ref={firstInput} value={name} onChange={event => setName(event.target.value)} required /></label> : null}
            <label className="grid gap-1">{erratum ? "勘误说明" : target.kind === "config" ? "说明" : "备注"}
              <Textarea value={notes} onChange={event => setNotes(event.target.value)} required={erratum} />
            </label>
            {erratum ? <label className="grid gap-1">勘误来源<Input ref={firstInput} value={source} onChange={event => setSource(event.target.value)} required /></label> : null}
          </> : target.kind === "path" ? <label className="grid gap-1">新路径
            <Input ref={firstInput} value={name} maxLength={240} onChange={event => { setName(event.target.value); revise(); }} required />
          </label> : null}
          {target.kind === "json" ? <>
            {!options && !error ? <p role="status">正在读取当前实例…</p> : null}
            {!options && error ? <Button type="button" variant="outline" onClick={() => { revise(); setReadAttempt(attempt => attempt + 1); }}>重试读取实例</Button> : null}
            {options && !options.items.length ? <p role="status">此文件没有已登记的当前 JSON 实例。</p> : null}
            {current ? <>
              <label className="grid gap-1">当前实例<SelectControl ariaLabel="当前实例" value={occurrenceId}
                options={options!.items.map(item => ({ value: item.occurrenceId, label: `${item.configurationSchemaId} · ${item.rootPointer || "文档根"}` }))}
                onValueChange={id => { selectInstance(options!.items.find(item => item.occurrenceId === id)!); revise(); }} /></label>
              <ul className="space-y-1 [overflow-wrap:anywhere]" aria-label="现有绑定">
                {current.bindings.map(row => <li key={row.bindingId}><code>{row.pointer || "文档根"}</code> · {row.definitionId} · {valueText(row.value)}</li>)}
              </ul>
              <label className="grid gap-1">目标配置规范<SelectControl ariaLabel="目标配置规范" value={json.configurationSchemaId}
                options={options!.schemas.map(item => ({ value: item.id, label: item.id }))}
                onValueChange={id => { setJson({ ...json, configurationSchemaId: id, mappings: [emptyMapping()] }); revise(); }} /></label>
              <label className="grid gap-1">根 JSON Pointer<Input ref={firstInput} value={json.rootPointer} placeholder="留空表示文档根"
                onChange={event => { setJson({ ...json, rootPointer: event.target.value }); revise(); }} /></label>
              <div className="grid gap-2" aria-label="字段映射">
                {json.mappings.map((row, index) => <div key={index} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
                  <label className="grid min-w-0 gap-1">参数定义<SelectControl ariaLabel={`参数定义 ${index + 1}`} value={row.definitionId}
                    options={(schema?.definitions ?? []).map(definition => ({ value: definition.id, label: definition.key }))}
                    onValueChange={id => { setJson({ ...json, mappings: json.mappings.map((entry, at) => at === index ? { ...entry, definitionId: id } : entry) }); revise(); }} /></label>
                  <label className="grid min-w-0 gap-1">字段 JSON Pointer<Input aria-label={`字段 JSON Pointer ${index + 1}`} value={row.pointer}
                    onChange={event => { setJson({ ...json, mappings: json.mappings.map((entry, at) => at === index ? { ...entry, pointer: event.target.value } : entry) }); revise(); }} /></label>
                  <Button type="button" size="sm" variant="outline" aria-label={`移除映射 ${index + 1}`} onClick={() => {
                    setJson({ ...json, mappings: json.mappings.filter((_, at) => at !== index) }); revise();
                  }}>移除</Button>
                </div>)}
              </div>
              <Button type="button" variant="outline" className="justify-self-start" onClick={() => { setJson({ ...json, mappings: [...json.mappings, emptyMapping()] }); revise(); }}>添加映射</Button>
            </> : null}
          </> : null}
          {preview ? <section aria-label="更正预览" className="grid gap-2 [overflow-wrap:anywhere]">
            {"pathCorrection" in preview ? <>
              <p>{preview.pathCorrection.from} → {preview.pathCorrection.to}</p>
              {preview.entryFile ? <p>入口文件 · {preview.entryFile}</p> : null}
              {preview.overlayOrder.length ? <p>覆盖层顺序 · {preview.overlayOrder.join(" → ")}</p> : null}
              {preview.pathCorrection.references.length ? <ul aria-label="将更新的 include 引用">
                {preview.pathCorrection.references.map(({ sourceName, line, column, target }) =>
                  <li key={`${sourceName}:${line}:${column}`}>{sourceName}:{line}:{column} · {target}</li>)}
              </ul> : null}
            </> : <ul aria-label="目标字段取值">{preview.values?.map(row =>
              <li key={row.definitionId}><code>{row.pointer || "文档根"}</code> · {row.definitionId} · {valueText(row.value)}</li>)}</ul>}
            <label className="grid gap-1">更正原因<Input ref={reasonInput} value={reason} maxLength={2000} onChange={event => setReason(event.target.value)} required /></label>
          </section> : null}
        </fieldset>
        {error ? <div role="alert" className="workbench-configuration-files-dialog__operation-error">
          <p>{error}</p>
          {diagnostics.length ? <ul>{diagnostics.map((row, index) =>
            <li key={index}>{[row.sourceName, row.line, row.column].filter(value => value !== undefined).join(":")} {row.message}</li>)}</ul> : null}
          {preview ? <Button type="button" size="sm" variant="outline" onClick={revise}>重新预览</Button> : null}
        </div> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>取消</Button>
          <Button type="submit" disabled={busy || incomplete || Boolean(preview && !reason.trim())}>
            {busy ? "处理中…" : preview ? "确认更正" : fromSources ? "预览更正" : erratum ? "追加勘误" : "保存更正"}
          </Button>
        </div>
      </form>
    </>}
  </ModalDialog>;
}
