import { useMemo, useRef, useState } from "react";
import type { ProjectParameterFile } from "@/application/ports/ParameterFileRepository";
import type { ParameterFileRepository } from "@/application/ports/ParameterFileRepository";
import type { ParameterCatalogRepository } from "@/application/ports/ParameterCatalogRepository";
import type { JsonRegistrationSelection } from "@/application/project-configuration/jsonRegistration";
import { ModalDialog } from "@/components/common/ModalDialog";
import { SelectControl } from "@/components/common/SelectControl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { WorkbenchJsonRegistrationFields } from "./WorkbenchJsonRegistrationFields";
import { createCanonicalMemberAdditionClient, type MemberAdditionBody, type MemberAdditionPreview } from "@/infrastructure/http/canonicalMemberAdditionClient";
import { presentError } from "@/infrastructure/http/presentError";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import "./workbench-member-addition-dialog.css";

const roleLabels = { base: "基础", overlay: "覆盖层", charging: "充电", thermal: "温控", misc: "其他 / include" };
export function WorkbenchMemberAdditionDialog({ projectId, configSets, initialConfigSetId, availableFiles, client: suppliedClient, catalogRepository, fileRepository, onDismiss, onApplied }: {
  projectId: string; configSets: Array<{ id: string; name: string }>; initialConfigSetId: string;
  availableFiles: ProjectParameterFile[]; client?: ReturnType<typeof createCanonicalMemberAdditionClient>;
  catalogRepository?: Pick<ParameterCatalogRepository, "listSubjects" | "listSubjectDefinitions">;
  fileRepository?: Pick<ParameterFileRepository, "downloadVersion">;
  onDismiss: () => void; onApplied: (configSetId: string, fileId: string) => void;
}) {
  const client = useMemo(() => suppliedClient ?? createCanonicalMemberAdditionClient(), [suppliedClient]);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [configSetId, setConfigSetId] = useState(initialConfigSetId), [source, setSource] = useState("upload");
  const [file, setFile] = useState<File | null>(null), [fileId, setFileId] = useState(availableFiles[0]?.id ?? "");
  const [candidate, setCandidate] = useState<{ id: string; fileName: string; format: "dts" | "json" } | null>(null);
  const [role, setRole] = useState<MemberAdditionBody["role"]>("misc"), [sortOrder, setSortOrder] = useState("0");
  const [registration, setRegistration] = useState<JsonRegistrationSelection>({ configurationSchemaId: "", mappings: [] });
  const [registrationOpen, setRegistrationOpen] = useState(false);
  const [preview, setPreview] = useState<MemberAdditionPreview | null>(null), [preparedBody, setPreparedBody] = useState<MemberAdditionBody | null>(null);
  const [reason, setReason] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [errorDiagnostics, setErrorDiagnostics] = useState<string[]>([]);
  const mutationId = useRef<string | null>(null);
  const format = source === "existing" ? availableFiles.find((item) => item.id === fileId)?.format : candidate?.format ?? (file?.name.toLowerCase().endsWith(".json") ? "json" : "dts");
  const invalidate = () => { setPreview(null); setPreparedBody(null); setError(""); setErrorDiagnostics([]); mutationId.current = null; };
  function showError(failure: unknown, fallback: string) {
    setError(presentError(failure, fallback));
    const diagnostics = failure instanceof WiseEffApiError ? failure.details.diagnostics : null;
    setErrorDiagnostics(Array.isArray(diagnostics) ? diagnostics.flatMap((item: unknown) =>
      item && typeof item === "object" && "message" in item && typeof item.message === "string" ? [item.message] : []) : []);
  }
  async function prepare() {
    setBusy(true); setError(""); setErrorDiagnostics([]); setPreview(null); setPreparedBody(null);
    try {
      let uploaded = candidate;
      if (source === "upload" && !uploaded) {
        if (!file) throw new Error("请选择要上传的 DTS/JSON 文件。");
        if (file.size > 2 * 1024 * 1024) throw new Error("来源文件不能超过 2 MB。");
        uploaded = await client.upload(projectId, file); setCandidate(uploaded);
      }
      const registerJson = format === "json" && Boolean(registration.configurationSchemaId);
      const jsonMappings = !registerJson ? undefined : registration.fallbackMappings === undefined ? registration.mappings.map((row) => {
        if (!row.definitionId || row.pointer === null) throw new Error("请为每行选择参数定义和 JSON 字段。");
        return { definitionId: row.definitionId, pointer: row.pointer };
      }) : registration.fallbackMappings.split("\n").filter((line) => line.trim()).map((line) => {
        const separator = line.indexOf("=");
        if (separator < 1) throw new Error("每行字段映射应为 参数定义 ID = JSON Pointer。");
        return { definitionId: line.slice(0, separator).trim(), pointer: line.slice(separator + 1).trim() };
      });
      if (registerJson && !jsonMappings?.length) throw new Error("请至少添加一项字段映射。");
      const body: MemberAdditionBody = { ...(source === "upload" ? { candidateId: uploaded!.id } : { fileId }), role,
        sortOrder: Number(sortOrder), ...(registerJson ? { json: { configurationSchemaId: registration.configurationSchemaId, rootPointer: "", mappings: jsonMappings! } } : {}) };
      const result = await client.preview(projectId, configSetId, body);
      setPreparedBody(body); setPreview(result); mutationId.current = crypto.randomUUID();
    } catch (failure) { showError(failure, "无法预览文件组成，请检查文件后重试。"); } finally { setBusy(false); }
  }
  async function apply() {
    if (!preview || !preparedBody || !mutationId.current || !reason.trim()) return;
    setBusy(true); setError(""); setErrorDiagnostics([]);
    try {
      const result = await client.apply(projectId, configSetId, { ...preparedBody, proofToken: preview.proofToken, reason: reason.trim(), clientMutationId: mutationId.current });
      onApplied(configSetId, result.fileId);
    } catch (failure) { showError(failure, "未能确认加入结果，请重试确认或刷新配置核对；已保存的候选会保留。"); } finally { setBusy(false); }
  }
  return <ModalDialog open onDismiss={busy ? undefined : onDismiss} initialFocusRef={closeRef} describedBy
    className="workbench-member-addition-dialog" backdropClassName="param-admin-modal-backdrop">
    {({ titleId, descriptionId }) => <>
      <header><div><h2 id={titleId}>加入配置文件</h2><p id={descriptionId}>上传仅保存候选；预览并确认后，文件组成及参数状态一起生效。</p></div>
        <Button ref={closeRef} type="button" variant="outline" disabled={busy} onClick={onDismiss}>关闭</Button></header>
      <div className="workbench-member-addition-dialog__body" aria-busy={busy}>
        <form onSubmit={(event) => { event.preventDefault(); void prepare(); }}>
          <fieldset disabled={busy}><legend>文件与目标配置</legend>
            <label>目标配置<SelectControl ariaLabel="目标配置" value={configSetId} disabled={busy}
              onValueChange={(value) => { setConfigSetId(value); invalidate(); }}
              options={configSets.map((set) => ({ value: set.id, label: set.name === "default" ? "默认配置" : set.name }))} /></label>
            <label>文件来源<SelectControl ariaLabel="文件来源" value={source} disabled={busy}
              onValueChange={(value) => { setSource(value); setRegistration({ configurationSchemaId: "", mappings: [] }); invalidate(); }}
              options={[{ value: "upload", label: "上传新文件" }, { value: "existing", label: "选择已有项目文件", disabled: !availableFiles.length }]} /></label>
            {source === "upload" ? <label>上传文件<Input aria-label="上传文件" type="file" accept=".dts,.dtsi,.dtso,.json"
              onChange={(event) => { setFile(event.target.files?.[0] ?? null); setCandidate(null); setRegistration({ configurationSchemaId: "", mappings: [] }); invalidate(); }} /></label>
              : <label>待加入文件<SelectControl ariaLabel="待加入文件" value={fileId} disabled={busy}
                onValueChange={(value) => { setFileId(value); setRegistration({ configurationSchemaId: "", mappings: [] }); invalidate(); }} options={availableFiles.map((item) => ({ value: item.id, label: item.fileName }))} /></label>}
            {candidate && source === "upload" ? <p role="status">已保存候选：{candidate.fileName}；尚未加入配置。</p> : null}
            <div className="workbench-member-addition-dialog__columns">
              <label>文件用途<SelectControl ariaLabel="文件用途" value={role} disabled={busy}
                onValueChange={(value) => { setRole(value); invalidate(); }}
                options={(Object.keys(roleLabels) as Array<MemberAdditionBody["role"]>).map((value) => ({ value, label: roleLabels[value] }))} /></label>
              <label>文件顺序<Input aria-label="文件顺序" type="number" required min="0" max="100000" step="1" value={sortOrder}
                onChange={(event) => { setSortOrder(event.target.value); invalidate(); }} /></label>
            </div>
            {format === "json" ? <details onToggle={(event) => setRegistrationOpen(event.currentTarget.open)}><summary>登记 JSON 字段为参数（可选）</summary>
              <p>留空将只加入已校验的 JSON 文件，预览会明确显示未登记的参数状态。</p>
              {registrationOpen ? <WorkbenchJsonRegistrationFields key={`${source}:${source === "upload" ? file?.name : fileId}`} projectId={projectId}
                file={source === "upload" ? file : null} existingFile={source === "existing" ? availableFiles.find((item) => item.id === fileId) : undefined}
                catalog={catalogRepository} files={fileRepository} value={registration} onChange={(value) => { setRegistration(value); invalidate(); }} /> : null}
            </details> : null}
            <Button type="submit" disabled={busy || !configSetId || (source === "existing" ? !fileId : !file && !candidate)}>{busy ? "正在核对…" : "预览加入配置"}</Button>
          </fieldset>
        </form>
        {error ? <p role="alert">{error}</p> : null}
        {errorDiagnostics.length ? <ul aria-label="来源校验诊断">{errorDiagnostics.map((message, index) => <li key={index}>{message}</li>)}</ul> : null}
        {preview ? <section aria-label="加入配置预览">
          <h3>确认后的文件组成</h3><ul>{preview.members.map((member) => <li key={member.fileId}>{member.sourceName} · {roleLabels[member.role as keyof typeof roleLabels] ?? member.role} · 顺序 {member.sortOrder}</li>)}</ul>
          {preview.entryFile ? <p>入口：{preview.entryFile}；include 路径：{preview.includeSearchPaths.join("、")}；覆盖顺序：{preview.overlayOrder.join(" → ") || "无"}。</p> : null}
          <p>参数变化：{preview.impact.parameterChanges}；新增节点：{preview.impact.nodeAdditions}；移除节点：{preview.impact.nodeRemovals}。</p>
          {preview.impact.restoredParameters ? <p>恢复 {preview.impact.restoredParameters} 个已删除参数，保留原身份及历史。</p> : null}
          <p>保留 {preview.impact.retainedBindings} 个参数关联；{preview.impact.sourceReplacements} 个参数将切换有效来源文件，关联身份及历史保留。</p>
          {preview.diagnostics.map((item, index) => <p key={`${item.code}-${index}`}>{item.message}</p>)}
          <label>加入原因<Input aria-label="加入原因" value={reason} disabled={busy} maxLength={2000} onChange={(event) => setReason(event.target.value)} /></label>
          <Button type="button" disabled={busy || !reason.trim()} onClick={() => void apply()}>{busy ? "正在加入…" : "确认加入配置"}</Button>
        </section> : null}
      </div>
    </>}
  </ModalDialog>;
}
