import { Fragment, useCallback, useEffect, useId, useRef, useState } from "react";
import { FileDropZone } from "@/components/common/FileDropZone";
import { ImportDialog } from "@/components/common/ImportDialog";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { SelectControl } from "@/components/common/SelectControl";
import { SettingsLeaveGuard } from "@/components/layout/SettingsFormPage";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import type { Project } from "@/domain/prototype/types";
import { createGovernanceIdempotencyKey } from "@/features/parameter-catalog-governance/governanceState";
import { WiseEffApiError, type ApiClient } from "@/infrastructure/http/apiClient";
import type { ModuleStructurePreviewResponse, ModuleStructureReceipt } from "@/infrastructure/http/parameterCatalogDtos";
import { ModuleStructureDriverCreation } from "./ModuleStructureDriverCreation";
import { importDiagnostic, ModuleStructureImportError, type ImportDiagnostic } from "./ModuleStructureImportError";

type Resolutions = Record<string, "current" | "file">;
type Preview = ModuleStructurePreviewResponse;
type Receipt = ModuleStructureReceipt;
const value = (item: unknown) => item === undefined ? "（省略）" : JSON.stringify(item);
const modeOptions = [
  { value: "update", label: "更新当前组织", description: "按文件更新本组织的模块与主体归属，可声明新驱动" },
  { value: "copy", label: "复制到当前组织", description: "从其他组织的导出文件复制模块和主体，逐项确认复用或新建" },
] as const;
const changeKinds = {
  create: { label: "新建", tone: "success" },
  update: { label: "修改", tone: "info" },
  delete: { label: "删除", tone: "danger" },
  move: { label: "移动归属", tone: "info" },
} as const;
const isMove = ({ field }: Preview["changes"][number]) => field === "placement" || field === "parentRef";
const fieldLabels: Record<string, string> = { name: "名称", description: "描述", scope: "范围", sortOrder: "排序", importance: "重要性", parentRef: "上级模块", create: "新增模块", delete: "删除模块", legacyImpact: "将解除的遗留引用数", placement: "归属", displayAlias: "展示别名", mapping: "复制映射",
  state: "登记状态", kind: "当前组织主体类型", ownerSubjectId: "所属驱动", recognition: "识别规则", "recognition.mode": "识别模式", "recognition.compatibles": "兼容标识", "recognition.driverNature": "驱动性质",
  "recognition.instanceCardinality": "实例基数", "recognition.nodeTypeName": "节点名称" };

export function ModuleStructureImport({ apiClient, organizationId, organizationNames, projects = [], canImport, sessionPermissions, onChanged }: {
  apiClient?: ApiClient; organizationId?: string; organizationNames?: Readonly<Record<string, string>>;
  projects?: readonly Pick<Project, "id" | "name">[];
  canImport: boolean; sessionPermissions?: readonly string[] | null; onChanged?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [document, setDocument] = useState<unknown>(null);
  const [file, setFile] = useState<File | null>(null);
  const fileName = file?.name ?? "";
  const modeId = useId();
  const [resolutions, setResolutions] = useState<Resolutions>({});
  const [mode, setMode] = useState<"update" | "copy">("update");
  const [mappings, setMappings] = useState<Record<string, string>>({});
  const [mappingCorrections, setMappingCorrections] = useState<Record<string, { targetId: string; revision: number }>>({});
  const [preview, setPreview] = useState<Preview | null>(null);
  const [reason, setReason] = useState("");
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState("");
  const [diagnostic, setDiagnostic] = useState<ImportDiagnostic | null>(null);
  const [busy, setBusy] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [confirmPublication, setConfirmPublication] = useState(false);
  const [publicationAttempted, setPublicationAttempted] = useState(false);
  const write = useRef<{ fingerprint: string; key: string } | null>(null);
  const publicationWrite = useRef<{ fingerprint: string; key: string; retryAfterFailure: boolean } | null>(null);
  const requestPending = useRef(false);
  const requestEpoch = useRef(0);
  const sourceInfo = document && typeof document === "object" && "source" in document ? (document as { source?: { organizationId?: unknown; exportId?: unknown } }).source : undefined;
  const source = sourceInfo?.organizationId;
  const sameOrganizationCopy = mode === "copy" && typeof source === "string" && source === organizationId;
  const creation = preview?.driverCreation;
  const publishing = creation?.phase === "publishing";
  const needsPublication = creation?.phase === "required" || creation?.phase === "blocked";
  const canPublish = Boolean(canImport && sessionPermissions?.includes("catalog:author") && sessionPermissions.includes("catalog:publish"));
  const publicationStarted = Boolean(publicationAttempted || creation?.jobId || creation?.candidateId);
  const readyToApply = !creation || creation.phase === "ready" || creation.phase === "applied";
  const mappingConflicts = new Map(preview?.conflicts.filter(conflict => conflict.field === "mapping").map(conflict => [conflict.moduleId, conflict]));
  const dirty = Boolean(fileName && !receipt);
  const base = `/api/v2/organizations/${encodeURIComponent(organizationId ?? "")}/module-structure`;
  const clearError = useCallback(() => { setError(""); setDiagnostic(null); }, []);
  const close = () => { requestEpoch.current++; setOpen(false); setDocument(null); setFile(null); setResolutions({}); setMappings({}); setMappingCorrections({}); setMode("update"); setPreview(null); setReason(""); setReceipt(null); setPublicationAttempted(false); clearError(); write.current = null; publicationWrite.current = null; };
  const requestClose = () => { if (publicationStarted && !receipt) setOpen(false); else if (dirty) setDiscard(true); else close(); };
  const showError = useCallback((cause: unknown, fallback: string, phase: ImportDiagnostic["phase"]) => setDiagnostic(importDiagnostic(cause, fallback, phase)), []);
  const selectFile = async (next: File | null) => {
    const epoch = ++requestEpoch.current;
    setFile(next); setDocument(null); setPreview(null); setReceipt(null); setResolutions({}); setMappings({}); setMappingCorrections({}); setPublicationAttempted(false); clearError(); write.current = null; publicationWrite.current = null;
    if (!next) return;
    if (next.size > 32 * 1024 * 1024) { setError("JSON 文件不能超过 32 MiB。"); return; }
    try {
      const text = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsText(next);
      });
      if (epoch !== requestEpoch.current) return;
      const parsed = JSON.parse(text);
      if (new TextEncoder().encode(JSON.stringify(parsed)).byteLength > 4 * 1024 * 1024) { setError("JSON 内容不能超过 4 MiB。"); return; }
      setDocument(parsed);
    } catch (cause) { if (epoch === requestEpoch.current) showError(cause, "JSON 格式无效，请检查文件后重新上传。", "read"); }
  };
  const refresh = useCallback(async (next: Resolutions, nextMappings = mappings, background = false, corrections = mappingCorrections) => {
    if (!apiClient || !document || sameOrganizationCopy || requestPending.current) return;
    const epoch = requestEpoch.current;
    requestPending.current = true;
    if (!background) { setBusy(true); clearError(); setPreview(null); }
    try {
      const updated = await apiClient.post<Preview>(`${base}/previews`, { mode, document, resolutions: next, mappings: nextMappings,
        ...(Object.keys(corrections).length ? { mappingCorrections: corrections } : {}) });
      if (epoch === requestEpoch.current) {
        if (updated.driverCreation?.phase === "blocked" && publicationWrite.current) publicationWrite.current.retryAfterFailure = true;
        setPreview(updated); clearError();
      }
    } catch (cause) {
      if (epoch === requestEpoch.current) showError(cause, "预览失败，请检查文件后重试。", "preview");
    } finally { requestPending.current = false; if (epoch === requestEpoch.current && !background) setBusy(false); }
  }, [apiClient, document, sameOrganizationCopy, mappings, mappingCorrections, base, mode, clearError, showError]);
  useEffect(() => {
    if (!open || !publishing || diagnostic || busy || receipt) return;
    const timer = window.setTimeout(() => { void refresh(resolutions, mappings, true); }, 1500);
    return () => window.clearTimeout(timer);
  }, [open, publishing, preview, diagnostic, busy, receipt, refresh, resolutions, mappings]);
  useEffect(() => () => { requestEpoch.current++; }, []);
  const publishDrivers = async () => {
    if (!apiClient || !preview || !needsPublication || !canPublish || !reason.trim() || preview.conflicts.length || requestPending.current) return;
    const body = { mode, document, resolutions, mappings, token: preview.token, reason: reason.trim() };
    const fingerprint = JSON.stringify({ mode, document, resolutions, mappings, reason: reason.trim() });
    if (publicationWrite.current?.fingerprint !== fingerprint || (creation?.phase === "blocked" && publicationWrite.current.retryAfterFailure)) {
      publicationWrite.current = { fingerprint, key: createGovernanceIdempotencyKey(), retryAfterFailure: false };
    }
    publicationWrite.current.retryAfterFailure = false;
    const epoch = requestEpoch.current;
    requestPending.current = true; setBusy(true); setPublicationAttempted(true); clearError();
    try {
      const updated = await apiClient.post<Preview>(`${base}/driver-publications`, { ...body, idempotencyKey: publicationWrite.current.key });
      if (epoch === requestEpoch.current) {
        publicationWrite.current.retryAfterFailure = updated.driverCreation?.phase === "blocked";
        setPreview(updated);
      }
    } catch (cause) {
      if (epoch === requestEpoch.current) {
        if (cause instanceof WiseEffApiError && cause.code === "CONFLICT") setPreview(null);
        showError(cause, "发布失败，请刷新预览核对进度后重试。", "publish");
      }
    } finally { requestPending.current = false; if (epoch === requestEpoch.current) { setBusy(false); setConfirmPublication(false); } }
  };
  const apply = async () => {
    if (!apiClient || !preview || !readyToApply || requestPending.current) return;
    const body = { mode, document, resolutions, mappings, token: preview.token, reason: reason.trim(),
      ...(Object.keys(mappingCorrections).length ? { mappingCorrections } : {}) };
    const fingerprint = JSON.stringify(body);
    if (write.current?.fingerprint !== fingerprint) write.current = { fingerprint, key: createGovernanceIdempotencyKey() };
    const epoch = requestEpoch.current;
    requestPending.current = true; setBusy(true); clearError();
    try {
      const applied = await apiClient.post<Receipt>(`${base}/applies`, { ...body, idempotencyKey: write.current.key });
      if (epoch === requestEpoch.current) { setReceipt(applied); onChanged?.(); }
    } catch (cause) {
      if (epoch === requestEpoch.current) {
        if (cause instanceof WiseEffApiError && cause.code === "CONFLICT") setPreview(null);
        showError(cause, "提交失败，请重试。", "apply");
      }
    } finally { requestPending.current = false; if (epoch === requestEpoch.current) setBusy(false); }
  };
  const modules = document && typeof document === "object" && "modules" in document && Array.isArray(document.modules) ? document.modules : [];
  const subjects = document && typeof document === "object" && "subjects" in document && Array.isArray(document.subjects) ? document.subjects : [];
  const subjectId = (id: string) => id.startsWith("subject:") ? id.slice(8) : subjects.some((subject: { subjectId?: string }) => subject.subjectId === id) ? id : null;
  const moduleLabel = (id: string) => {
    const subject = subjects.find((entry: { subjectId?: string }) => entry.subjectId === subjectId(id));
    const created = creation?.drivers.find(driver => driver.subjectId === subjectId(id));
    if (created) return created.displayAlias || created.compatible;
    if (subjectId(id)) return subject?.displayAlias || subject?.recognition?.effective?.nodeTypeName || subject?.recognition?.effective?.compatibles?.[0] || `主体 ${subjectId(id)}`;
    const module = modules.find((entry: { sourceId?: string; ref?: string }) => entry.sourceId === id || entry.ref === id);
    return module?.name || preview?.targets?.find(target => target.id === id)?.name
      || preview?.changes.find(change => change.moduleId === id && change.field === "delete")?.before?.toString() || id;
  };
  const displayValue = (item: unknown): string => {
    if (item === null) return "无";
    if (typeof item === "string") return ({ "": "空", active: "启用", retired: "停用", inherit: "继承目录设置", override: "自定义覆盖", driver: "驱动主体", "node-type": "节点类型主体", "configuration-schema": "配置规范主体", low: "低", medium: "中", high: "高" } as Record<string, string>)[item] ?? item;
    if (Array.isArray(item)) return item.length ? item.join("、") : "无";
    if (!item || typeof item !== "object" || !("kind" in item)) return value(item);
    const placement = item as { kind: string; moduleRef?: string; sourceId?: string };
    if (placement.kind === "unset") return "未设置归属";
    if (placement.kind === "unclassified") return "未分类";
    if (placement.kind !== "module") return placement.sourceId ?? value(item);
    const path: string[] = [];
    let ref = placement.moduleRef;
    const seen = new Set<string>();
    while (ref && !seen.has(ref)) {
      seen.add(ref);
      const module = modules.find((entry: { ref?: string }) => entry.ref === ref);
      if (!module) { path.unshift(ref); break; }
      path.unshift(module.name ?? ref); ref = module.parentRef;
    }
    return path.join(" / ");
  };
  const groups = new Map<string, Preview["changes"]>();
  for (const change of preview?.changes ?? []) {
    const key = subjectId(change.moduleId) ? `subject:${subjectId(change.moduleId)}` : change.moduleId;
    const group = groups.get(key) ?? []; group.push(change); groups.set(key, group);
  }
  const recognitionFields = ["mode", "compatibles", "driverNature", "instanceCardinality", "nodeTypeName"] as const;
  const recognitionValue = (item: unknown, field: typeof recognitionFields[number]) => {
    if (!item || typeof item !== "object") return null;
    const rule = item as Record<string, unknown>;
    if (field === "mode") return rule.mode ?? (rule.overridden === true ? "override" : rule.overridden === false ? "inherit" : null);
    const effective = rule.effective as Record<string, unknown> | undefined;
    return rule[field] ?? effective?.[field] ?? null;
  };
  const kindsFor = (changes: Preview["changes"]): (keyof typeof changeKinds)[] => {
    if (changes.some(change => change.field === "delete")) return ["delete"];
    if (changes.some(change => change.field === "create")) return ["create"];
    return [...new Set(changes.map(change => isMove(change) ? "move" as const : "update" as const))];
  };
  const counts = { create: 0, update: 0, delete: 0, move: 0 };
  for (const changes of groups.values()) {
    for (const kind of kindsFor(changes)) counts[kind]++;
  }
  const changeValue = (field: string, item: unknown) =>
    field === "parentRef" && typeof item === "string" ? moduleLabel(item) : displayValue(item);
  const changeRow = (field: string, before: unknown, after: unknown) => {
    const empty = (item: unknown) => item == null || item === "" || (Array.isArray(item) && item.length === 0);
    const removed = field !== "legacyImpact" && !empty(before) && empty(after);
    return <tr>
      <th scope="row">{fieldLabels[field] ?? field}</th>
      <td className="import-dialog__secondary">{removed ? <del>{changeValue(field, before)}</del> : changeValue(field, before)}</td>
      <td>{removed ? <span className="import-dialog__removed">已移除</span> : changeValue(field, after)}</td>
    </tr>;
  };
  const disabledReason = !preview ? "请先预览"
    : preview.conflicts.length ? `还有 ${preview.conflicts.length} 个冲突待解决`
    : publishing ? "正在发布新驱动"
    : needsPublication && !canPublish ? "当前会话没有发布新驱动的权限"
    : !reason.trim() ? "请填写变更原因" : "";
  const organizationLabel = (id: string) => organizationNames && Object.hasOwn(organizationNames, id) ? organizationNames[id] || id : id;
  return <>
    <Button type="button" size="sm" variant="outline" disabled={!canImport || !apiClient || !organizationId} onClick={() => setOpen(true)}>导入结构</Button>
    {open ? <>
      <SettingsLeaveGuard dirty={dirty} saving={busy} description={publicationStarted ? "已提交的发布会继续。返回后重新上传同一份 JSON 并预览，可继续登记。" : "离开将放弃上传文件和未提交的冲突选择。"} />
      <ImportDialog open={!discard && !confirmPublication} scope="模块" title="导入模块结构"
        description="上传 JSON 文件，预览对当前组织模块与主体归属的变更。"
        closeDisabled={busy} onClose={requestClose}
        utilities={!receipt && disabledReason ? <span className="import-dialog__secondary" aria-live="polite">{disabledReason}</span> : null}
        actions={!receipt ? <>
          <Button type="button" variant="outline" disabled={!document || sameOrganizationCopy || busy}
            onClick={() => void refresh(resolutions)}>{publishing ? "刷新发布进度" : "预览"}</Button>
          {needsPublication ? <Button type="button" disabled={Boolean(disabledReason) || busy}
            onClick={() => setConfirmPublication(true)}>{creation?.phase === "blocked" ? "重新发布驱动" : "发布新驱动"}</Button>
            : <Button type="button" disabled={Boolean(disabledReason) || !readyToApply || busy} onClick={() => void apply()}>确认提交</Button>}
        </> : null}>
          <details className="import-dialog__rules">
            <summary>格式与限制</summary>
            <p>更新当前组织结构，并可声明新驱动；或复制模块和主体到当前组织。删除须明确处置子模块和主体归属；复制须确认复用或新建。</p>
            <p>JSON 文件不能超过 32 MiB，压缩空白后的 JSON 内容不能超过 4 MiB。</p>
          </details>
          {!receipt ? <>
            <fieldset className="import-dialog__modes" disabled={busy || publishing}>
              <legend>导入方式</legend>
              {modeOptions.map(option => <label key={option.value} className="import-dialog__mode">
                <input type="radio" name={modeId} checked={mode === option.value} aria-label={option.label}
                  aria-describedby={`${modeId}-${option.value}`} onChange={() => {
                    setMode(option.value); setMappings({}); setMappingCorrections({}); setResolutions({}); setPreview(null); clearError();
                  }} />
                <span><strong>{option.label}</strong>
                  <span id={`${modeId}-${option.value}`} className="import-dialog__secondary block text-sm">{option.description}</span>
                </span>
              </label>)}
            </fieldset>
            <FileDropZone label="选择 JSON 文件" accept="application/json,.json" disabled={busy || publishing}
              files={file ? [file] : []} onSelect={([next]) => void selectFile(next ?? null)} onRemove={() => void selectFile(null)}
              renderFileDetails={() => <div className="import-dialog__secondary px-2 text-sm">
                <p>来源组织：{typeof source === "string" ? <span title={source}>{organizationLabel(source)}</span> : "未提供"}；
                  目标组织：{organizationId ? <span title={organizationId}>{organizationLabel(organizationId)}</span> : "未提供"}</p>
                {document ? <p>模块 {modules.length} · 主体 {subjects.length}</p> : null}
              </div>} />
            {sameOrganizationCopy ? <p className="form-error" role="alert">复制需要其他组织导出的文件；要更新本组织，请选择「更新当前组织」。</p> : null}
          </> : null}
            {preview && !receipt ? <>
              <div className="import-dialog__badges" aria-label="变更摘要" role="group">
                {(Object.keys(changeKinds) as (keyof typeof changeKinds)[]).filter(kind => counts[kind] > 0).map(kind =>
                  <Badge key={kind} variant="secondary" data-tone={changeKinds[kind].tone}>{changeKinds[kind].label} {counts[kind]}</Badge>)}
                {creation?.drivers.length ? <Badge variant="secondary" data-tone="success">新驱动 {creation.drivers.length}</Badge> : null}
                {preview.conflicts.length ? <Badge variant="secondary" data-tone="warning">冲突 {preview.conflicts.length}</Badge> : null}
              </div>
              {creation ? <ModuleStructureDriverCreation creation={creation} displayPlacement={displayValue} canPublish={canPublish} /> : null}
              {mode === "copy" ? <><h3>模块映射</h3>{preview.mappings?.map(mapping => {
                const prior = mapping.history?.at(-1);
                const conflict = mappingConflicts.get(mapping.ref);
                return <div key={mapping.ref}>
                  <strong>{moduleLabel(mapping.ref)}</strong>
                  {prior ? <details><summary>查看原有复制记录（{mapping.history?.length}）</summary><ul>
                    {mapping.history?.map(record => <li key={record.revision}>{record.moduleId} · {record.available ? "可用" : "已删除或不可用"} · <time dateTime={record.recordedAt}>{new Date(record.recordedAt).toLocaleString("zh-CN")}</time></li>)}
                  </ul></details> : null}
                  <SelectControl ariaLabel={prior ? `${mapping.ref} 的映射纠正目标` : `${mapping.ref} 的目标模块`}
                    value={mapping.selected ?? ""} disabled={busy || (mapping.frozen && !prior)} options={[
                      { value: "", label: prior ? "请选择新的目标模块" : "请选择", disabled: true },
                      ...(prior ? prior.available ? [] : [{ value: prior.moduleId, label: `已保存：${prior.moduleId}（已删除或不可用）` }] : [{ value: "create", label: "新建目标模块" }]),
                      ...mapping.candidates.map(candidate => ({ value: candidate.id, label: `${candidate.id === prior?.moduleId ? "已保存：" : "建议：复用 "}${candidate.name}` })),
                      ...(preview.targets ?? []).filter(target => !mapping.candidates.some(candidate => candidate.id === target.id))
                        .map(target => ({ value: target.id, label: `${target.id === prior?.moduleId ? "已保存：" : "复用 "}${target.name}` })),
                    ]} onValueChange={choice => {
                      if (!choice) return;
                      if (prior) {
                        const next = choice === prior.moduleId ? { ...mappingCorrections }
                          : { ...mappingCorrections, [mapping.ref]: { targetId: choice, revision: prior.revision } };
                        if (choice === prior.moduleId) delete next[mapping.ref];
                        setMappingCorrections(next);
                        setResolutions({});
                        void refresh({}, mappings, false, next);
                      } else {
                        const next = { ...mappings, [mapping.ref]: choice };
                        setMappings(next);
                        void refresh(resolutions, next);
                      }
                    }} />
                  {prior && mapping.selected !== prior.moduleId ? <p>后续复制目标：{preview.targets?.find(target => target.id === mapping.selected)?.name ?? mapping.selected}</p> : null}
                  {conflict?.current ? <p role="alert">{prior && !prior.available && mapping.selected === prior.moduleId ? "已保存的目标已删除或不可用，请选择新目标。" : "目标模块重复，请为每个来源选择不同目标。"}</p> : null}
                </div>;
              })}</> : null}
              <h3>变更（{preview.changes.length}）</h3>
              {groups.size ? [...groups].map(([id, changes]) => <section key={id} className="import-dialog__change">
                <h4>{moduleLabel(id)} {kindsFor(changes).map(kind =>
                  <Badge key={kind} variant="secondary" data-tone={changeKinds[kind].tone}>{changeKinds[kind].label}</Badge>)}</h4>
                <table className="import-dialog__table import-dialog__diff">
                  <thead><tr><th scope="col">字段</th><th scope="col">原值</th><th scope="col">新值</th></tr></thead>
                  <tbody>{changes.map((change, index) => <Fragment key={index}>
                    {change.field === "recognition" ? <>
                      {recognitionFields.map(field => {
                        const before = recognitionValue(change.before, field);
                        const after = recognitionValue(change.after, field);
                        return JSON.stringify(before) === JSON.stringify(after) ? null
                          : <Fragment key={field}>{changeRow(`recognition.${field}`, before, after)}</Fragment>;
                      })}
                      <tr><td colSpan={3}><details><summary>识别规则技术详情</summary>
                        <p>变更前：{value(change.before)}</p><p>变更后：{value(change.after)}</p>
                      </details></td></tr>
                    </> : changeRow(change.field, change.before, change.after)}
                  </Fragment>)}</tbody>
                </table>
              </section>) : <p>没有领域数据变更。</p>}
              {preview.impact?.length ? <section>
                <h3>受影响项目</h3>
                <table aria-label="受影响项目" className="import-dialog__table">
                  <thead><tr><th scope="col">项目</th><th scope="col">主体</th><th scope="col">绑定数</th><th scope="col">定义数</th></tr></thead>
                  <tbody>{preview.impact.map(item => <tr key={`${item.subjectId}:${item.projectId}`}>
                    <td>{projects.find(project => project.id === item.projectId)?.name || item.projectId}</td>
                    <td>{moduleLabel(`subject:${item.subjectId}`)}</td>
                    <td>{item.bindingCount}</td>
                    <td>{item.definitions.length ? <details><summary>{item.definitions.length}<span className="sr-only"> 条定义</span></summary>
                      <ul className="import-dialog__secondary">{item.definitions.map(id => <li key={id}><code>{id}</code></li>)}</ul>
                    </details> : 0}</td>
                  </tr>)}</tbody>
                </table>
              </section> : null}
              {preview.conflicts.length ? <h3>待解决冲突（{preview.conflicts.length}）</h3> : null}
              {preview.conflicts.filter(conflict => conflict.field !== "mapping").map(conflict => <div key={conflict.key}>
                <strong>{moduleLabel(conflict.moduleId)} · {fieldLabels[conflict.field] ?? conflict.field}</strong>
                <dl><dt>基准</dt><dd>{displayValue(conflict.baseline)}</dd><dt>文件</dt><dd>{displayValue(conflict.file)}</dd><dt>当前</dt><dd>{displayValue(conflict.current)}</dd></dl>
                <SelectControl ariaLabel={`${conflict.key} 的冲突选择`} value={resolutions[conflict.key] ?? ""} disabled={busy} options={[{ value: "", label: "请选择", disabled: true }, { value: "current", label: "保留当前" }, { value: "file", label: "采用文件" }]} onValueChange={choice => {
                  if (!choice) return; const next = { ...resolutions, [conflict.key]: choice }; setResolutions(next); void refresh(next);
                }} />
              </div>)}
              {Object.entries(resolutions).filter(([key]) => !preview.conflicts.some(conflict => conflict.key === key)).map(([key, choice]) => <div key={key}>{(() => {
                const split = key.lastIndexOf(":"); const ref = key.slice(0, split); const field = key.slice(split + 1);
                const module = modules.find((entry: { ref?: string }) => entry.ref === ref);
                return `${typeof module?.sourceId === "string" ? moduleLabel(module.sourceId) : ref} · ${fieldLabels[field] ?? field} 的选择`;
              })()}
                <SelectControl ariaLabel={`${key} 的冲突选择`} value={choice} disabled={busy} options={[{ value: "current", label: "保留当前" }, { value: "file", label: "采用文件" }]} onValueChange={nextChoice => {
                  const next = { ...resolutions, [key]: nextChoice }; setResolutions(next); void refresh(next);
                }} /></div>)}
              <label className="block font-semibold">变更原因 <span aria-hidden="true" className="import-dialog__removed">*</span>
                <Textarea aria-label="变更原因" required className="mt-1 font-normal" value={reason} disabled={busy || publishing}
                  onChange={event => setReason(event.target.value)} />
              </label>
            </> : null}
            {receipt ? <p role="status">回执 {receipt.id}：目标组织 {receipt.organizationId}，更新 {receipt.changedModules} 个模块、{receipt.changedFields} 个字段。{receipt.changedFields === 0 ? " 本次没有领域数据变更。" : ""}</p> : null}
            {error ? <p className="form-error" role="alert">{error}</p> : null}
            {diagnostic ? <ModuleStructureImportError diagnostic={diagnostic} context={{ fileName, mode, targetOrganizationId: organizationId,
              sourceOrganizationId: typeof source === "string" ? source : undefined, exportId: typeof sourceInfo?.exportId === "string" ? sourceInfo.exportId : undefined }} /> : null}
            {diagnostic && Object.keys(mappingCorrections).length ? <Button type="button" variant="outline" disabled={busy}
              onClick={() => { setMappingCorrections({}); setResolutions({}); void refresh({}, mappings, false, {}); }}>重新读取已保存映射</Button> : null}
      </ImportDialog>
      <ConfirmDialog open={discard} title="放弃导入？" description="上传文件和未提交的冲突选择将丢失。" confirmLabel="放弃修改" cancelLabel="继续编辑" onConfirm={() => { setDiscard(false); close(); }} onCancel={() => setDiscard(false)} />
      <ConfirmDialog open={confirmPublication} title="发布新驱动？" description={<p>将发布 {creation?.drivers.length ?? 0} 个新驱动到共享目录。发布成功后仍需在本窗口核对模块与归属并确认提交；关闭窗口不会撤销已发布的驱动。</p>}
        acknowledgement="我已核对影响并确认发布到共享目录" acknowledgementKey={preview?.token} confirmLabel="确认发布新驱动" pending={busy} confirmDisabled={!needsPublication || !canPublish}
        onConfirm={() => void publishDrivers()} onCancel={() => setConfirmPublication(false)} />
    </> : null}
  </>;
}
