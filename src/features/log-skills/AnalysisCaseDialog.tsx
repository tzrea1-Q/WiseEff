import { useId, useRef, useState } from "react";
import { ModalDialog } from "@/components/common/ModalDialog";
import { SelectControl } from "@/components/common/SelectControl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ViewSwitch } from "@/components/ui/view-switch";
import { formatBytes } from "@/domain/format/formatBytes";
import { presentError } from "@/infrastructure/http/presentError";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import type { AnalysisCase, AnalysisCaseExpectations, AnalysisCaseInput, AnalysisCasePrefill } from "./types";
import "./skill-workspace.css";

const categories = ["thermal-protection", "communication-failure", "device-unavailable", "power-delivery-degradation", "configuration-error", "hardware-fault", "software-fault", "no-fault", "insufficient-evidence"];
const categoryLabels = ["过热保护", "通信失败", "设备不可用", "供电退化", "配置错误", "硬件故障", "软件故障", "无故障", "证据不足"];
export const emptyCaseExpectations: AnalysisCaseExpectations = { domain: "generic", summary: "", realLog: false,
  rootCauseCategory: "software-fault", rootCausePoints: [], keyEvidenceLines: [], expectedActions: [], expectRefusal: false };
const lines = (value: string) => value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
export function presentAnalysisCaseError(cause: unknown, fallback: string) {
  if (cause instanceof WiseEffApiError) {
    if (Array.isArray(cause.details.problems)) return `${presentError(cause, fallback)} ${cause.details.problems.filter((problem) => typeof problem === "string").map((problem) => {
      const path = problem.split(/:\s| — /)[0]; return `${path}：${validationMessage(problem)}`;
    }).join("；")}`;
    const issues = cause.details.issues;
    if (Array.isArray(issues)) return `${presentError(cause, fallback)} ${issues.map((issue) => {
      if (!issue || typeof issue !== "object") return "";
      const path = Array.isArray(issue.path) ? issue.path.join(".") : typeof issue.path === "string" ? issue.path : "";
      return `${path}：${validationMessage(typeof issue.message === "string" ? issue.message : "", path)}`;
    }).join("；")}`;
    if (cause.code === "VALIDATION_FAILED" && cause.message) return validationMessage(cause.message);
  }
  return presentError(cause, fallback);
}

type EvidenceRow = { file: string; mode: "line" | "pattern"; value: string };
const validationMessage = (message: string, path = "") => /[\u4e00-\u9fff]/.test(message) ? message
  : /Non-refusal cases require/.test(message) ? "非拒答用例必须填写期望根因、关键证据和建议动作。"
  : /deIdentified.*true/.test(message) ? "真实日志必须先完成去标识化并确认。"
  : /\.line$/.test(path) ? "证据行号无效，请检查文件是否存在该行。" : /\.file$/.test(path) ? "证据文件不存在，请选择日志包中的文件。"
  : /line|anchor/i.test(message) ? "请检查证据的文件路径和行号。" : /pattern|regex/i.test(`${path} ${message}`) ? "匹配模式无效，请修改后重试。"
  : /size|bytes|limit|too big/i.test(message) ? "内容超过上限，请缩减后重试。" : message || "内容无效，请检查对应字段后重试。";

export function AnalysisCaseDialog({ initial, availableFiles = [], originalUploads, sourceDegradation, uploadRequired = false, title = "编辑分析用例", onSave, onClose }: {
  initial: Pick<AnalysisCaseInput, "name" | "expectations">; uploadRequired?: boolean; title?: string;
  availableFiles?: AnalysisCase["files"]; originalUploads?: AnalysisCasePrefill["originalUploads"]; sourceDegradation?: AnalysisCasePrefill["sourceDegradation"];
  onSave: (input: AnalysisCaseInput) => Promise<void>; onClose: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [category, setCategory] = useState<AnalysisCaseExpectations["rootCauseCategory"]>(initial.expectations.rootCauseCategory);
  const [rootCause, setRootCause] = useState(initial.expectations.rootCausePoints.join("\n"));
  const [actions, setActions] = useState(initial.expectations.expectedActions.join("\n"));
  const initialAnchors: NonNullable<AnalysisCaseExpectations["keyEvidence"]> = initial.expectations.keyEvidence?.length ? initial.expectations.keyEvidence
    : initial.expectations.keyEvidenceLines.map((line) => ({ file: availableFiles[0]?.path ?? "log.txt", line }));
  const [evidence, setEvidence] = useState<EvidenceRow[]>(initialAnchors.map((anchor) => ({ file: anchor.file,
    mode: anchor.pattern ? "pattern" : "line", value: anchor.pattern ?? String(anchor.line ?? "") })));
  const [refusal, setRefusal] = useState(initial.expectations.expectRefusal);
  const [degraded, setDegraded] = useState(initial.expectations.expectedDegradedReason ?? "");
  const [files, setFiles] = useState<File[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const formId = useId();
  const paths = [...new Set([...availableFiles.map((file) => file.path), ...initialAnchors.map((anchor) => anchor.file),
    ...files.filter((file) => !/\.(zip|gz|tgz|tar)$/i.test(file.name)).map((file) => file.name)])];
  const fieldProps = (field: string) => ({ "aria-invalid": Boolean(fieldErrors[field]), "aria-describedby": fieldErrors[field] ? `${formId}-${field}-error` : undefined });
  const fieldError = (field: string) => fieldErrors[field] ? <p className="text-destructive" id={`${formId}-${field}-error`}>{fieldErrors[field]}</p> : null;
  const updateEvidence = (index: number, change: Partial<EvidenceRow>) => setEvidence((rows) => rows.map((row, at) => at === index ? { ...row, ...change } : row));
  return <ModalDialog open onDismiss={pending ? undefined : onClose} className="skill-authoring-dialog modal-card--lg">
    {({ titleId }) => <form noValidate onSubmit={(event) => {
      event.preventDefault(); setError("");
      const errors: Record<string, string> = {};
      if (!name.trim()) errors.name = "请输入用例名称。";
      if (uploadRequired && !files.length) errors.files = "请选择原始日志文件或压缩包。";
      if (files.length > 100 || files.reduce((total, file) => total + file.size, 0) > 10 * 1024 * 1024) errors.files = "每个用例最多 100 个文件、10 MiB 原始日志包。";
      if (!refusal && !lines(rootCause).length) errors.rootCause = "请至少填写一条期望根因或结论。";
      if (!refusal && !lines(actions).length) errors.actions = "请至少填写一条期望建议动作。";
      if (!refusal && !evidence.length) errors.evidence = "请至少添加一条关键证据。";
      evidence.forEach((row, index) => {
        if (!row.file.trim()) errors[`file-${index}`] = "请选择文件或填写压缩包内的文件路径。";
        const file = availableFiles.find((item) => item.path === row.file);
        if (row.mode === "line" && (!/^\d+$/.test(row.value) || Number(row.value) < 1 || (file && Number(row.value) > file.lineCount))) errors[`value-${index}`] = file ? `请输入 1 至 ${file.lineCount} 之间的行号。` : "请输入大于 0 的整数行号。";
        if (row.mode === "pattern" && !row.value.trim()) errors[`value-${index}`] = "请输入匹配模式。";
      });
      setFieldErrors(errors);
      if (Object.keys(errors).length) { setError("请修正标出的字段后保存。"); return; }
      void (async () => {
        try {
          const keyEvidence = evidence.map((row) => ({ file: row.file.trim(), ...(row.mode === "line" ? { line: Number(row.value) } : { pattern: row.value.trim() }) }));
          const expectations: AnalysisCaseExpectations = { ...initial.expectations, summary: name.trim(), rootCauseCategory: category,
            rootCausePoints: lines(rootCause), expectedActions: lines(actions), keyEvidence: keyEvidence as AnalysisCaseExpectations["keyEvidence"],
            keyEvidenceLines: [], expectRefusal: refusal };
          if (degraded === "provider-unavailable" || degraded === "token-budget-exhausted") expectations.expectedDegradedReason = degraded;
          else delete expectations.expectedDegradedReason;
          setPending(true);
          await onSave({ name: name.trim(), expectations, ...(uploadRequired ? { files } : {}) });
          onClose();
        } catch (cause) {
          if (cause instanceof WiseEffApiError && Array.isArray(cause.details.issues)) {
            const serverErrors: Record<string, string> = {};
            cause.details.issues.forEach((issue) => {
              const path = Array.isArray(issue.path) ? issue.path.join(".") : String(issue.path ?? "");
              const anchor = path.match(/keyEvidence[.[]([0-9]+)[.\]]*(file|line|pattern)?/);
              const field = anchor ? `${anchor[2] === "file" ? "file" : "value"}-${anchor[1]}` : /rootCausePoints/.test(path) ? "rootCause" : /expectedActions/.test(path) ? "actions" : /name|summary/.test(path) ? "name" : /files/.test(path) ? "files" : "evidence";
              serverErrors[field] = validationMessage(String(issue.message ?? ""), path);
            });
            setFieldErrors(serverErrors);
          } else if (cause instanceof WiseEffApiError && cause.code === "VALIDATION_FAILED") {
            const message = validationMessage(cause.message);
            if (/Non-refusal cases require/.test(cause.message)) setFieldErrors({ rootCause: message, evidence: message, actions: message });
            else {
              const anchor = cause.message.match(/keyEvidence(?:\[|\.)(\d+)/);
              if (anchor) setFieldErrors({ [`value-${anchor[1]}`]: message });
              else if (/pattern|regex/i.test(cause.message)) setFieldErrors({ evidence: message });
            }
          }
          setError(presentAnalysisCaseError(cause, "保存分析用例失败，请检查输入后重试。"));
        }
        finally { setPending(false); }
      })();
    }}>
      <h2 id={titleId}>{title}</h2>
      <p>保留原始日志包，使用真实模型对比草稿与已发布版本。每行填写一条根因或建议。</p>
      <label>用例名称（必填）<Input aria-label="用例名称" required maxLength={200} disabled={pending} value={name} {...fieldProps("name")} onChange={(event) => setName(event.target.value)} /></label>{fieldError("name")}
      {uploadRequired ? <div className="grid justify-items-start gap-2"><span>原始日志包（必填）</span>
        <Button type="button" variant="outline" disabled={pending} {...fieldProps("files")} onClick={() => fileInput.current?.click()}>选择文件</Button>
        <input ref={fileInput} hidden aria-label="原始日志包" type="file" multiple required disabled={pending} onChange={(event) => setFiles(Array.from(event.target.files ?? []))} />
      </div> : null}{fieldError("files")}
      {uploadRequired ? <p>最多 100 个文件、10 MiB；可选择多个文本日志或一个压缩包。</p> : null}
      {originalUploads?.length || availableFiles.length || files.length ? <section aria-label="原始日志文件"><h3>原始日志文件</h3><ul>{originalUploads?.length
        ? originalUploads.map((file) => <li key={file.fileName}>{file.fileName} · {formatBytes(file.sizeBytes)}</li>)
        : (uploadRequired ? files.map((file) => ({ path: file.name, sizeBytes: file.size })) : availableFiles).map((file) => <li key={file.path}>{file.path} · {formatBytes(file.sizeBytes)}</li>)}</ul></section> : null}
      {sourceDegradation ? <div className="status-banner" data-tone="warning"><p>{sourceDegradation.source === "agent" ? "该报告已提前收敛，期望内容请人工核对。" : "该报告由规则回退生成，期望内容请人工核对。"}</p>
        <p>原因：{sourceDegradation.reason === "provider-unavailable" ? "模型服务不可用" : "Token 预算耗尽"}。此次降级不会自动设为用例期望。</p></div> : null}
      <label>根因分类<SelectControl value={category} ariaLabel="根因分类" disabled={pending} onValueChange={(value) => setCategory(value as AnalysisCaseExpectations["rootCauseCategory"])}
        options={categories.map((value, index) => ({ value, label: categoryLabels[index] }))} /></label>
      <label>期望根因或结论{!refusal ? "（必填）" : "（可选）"}<Textarea aria-label="期望根因或结论" required={!refusal} rows={3} maxLength={20000} disabled={pending} value={rootCause} {...fieldProps("rootCause")} onChange={(event) => setRootCause(event.target.value)} /></label>{fieldError("rootCause")}
      <fieldset className="skill-case-evidence" aria-label="关键证据" {...fieldProps("evidence")}><legend>关键证据{!refusal ? "（必填）" : "（可选）"}</legend>
        {files.some((file) => /\.(zip|gz|tgz|tar)$/i.test(file.name)) && !availableFiles.length ? <p>压缩包在保存时解包校验；请填写包内文件的相对路径，例如 logs/device.log，不要填写压缩包名称。</p> : null}
        {evidence.map((row, index) => <div className="skill-case-evidence-row" key={index}>
          <label>文件<SelectControl ariaLabel={`证据 ${index + 1} 文件`} value={paths.includes(row.file) ? row.file : ""} disabled={pending}
            ariaInvalid={Boolean(fieldErrors[`file-${index}`])} ariaDescribedBy={fieldErrors[`file-${index}`] ? `${formId}-file-${index}-error` : undefined}
            options={[...paths.map((path) => ({ value: path, label: path })), { value: "", label: "填写文件路径" }]} onValueChange={(file) => updateEvidence(index, { file })} /></label>
          {!paths.includes(row.file) ? <label>文件路径<Input aria-label={`证据 ${index + 1} 文件路径`} value={row.file} disabled={pending} {...fieldProps(`file-${index}`)} onChange={(event) => updateEvidence(index, { file: event.target.value })} /></label> : null}
          {fieldError(`file-${index}`)}
          <ViewSwitch variant="toggle" ariaLabel={`证据 ${index + 1} 匹配方式`} value={row.mode} onValueChange={(mode) => updateEvidence(index, { mode: mode as EvidenceRow["mode"], value: "" })}
            items={[{ value: "line", label: "行号", disabled: pending }, { value: "pattern", label: "模式", disabled: pending }]} />
          <label>{row.mode === "line" ? "行号" : "匹配模式"}<Input aria-label={`证据 ${index + 1} ${row.mode === "line" ? "行号" : "匹配模式"}`} type={row.mode === "line" ? "number" : "text"}
            min={row.mode === "line" ? 1 : undefined} maxLength={row.mode === "pattern" ? 500 : undefined} disabled={pending} value={row.value} {...fieldProps(`value-${index}`)} onChange={(event) => updateEvidence(index, { value: event.target.value })} /></label>{fieldError(`value-${index}`)}
          <Button type="button" size="sm" variant="outline" aria-label={`移除证据 ${index + 1}`} disabled={pending} onClick={() => setEvidence((rows) => rows.filter((_, at) => at !== index))}>移除</Button>
        </div>)}
        {fieldError("evidence")}<Button type="button" size="sm" variant="outline" className="justify-self-start" disabled={pending || evidence.length >= 500} onClick={() => setEvidence((rows) => [...rows, { file: paths[0] ?? "", mode: "line", value: "" }])}>添加证据</Button>
      </fieldset>
      <label>期望建议动作{!refusal ? "（必填）" : "（可选）"}<Textarea aria-label="期望建议动作" required={!refusal} rows={3} maxLength={20000} disabled={pending} value={actions} {...fieldProps("actions")} onChange={(event) => setActions(event.target.value)} /></label>{fieldError("actions")}
      <label className="flex items-center gap-2"><input type="checkbox" disabled={pending} checked={refusal} onChange={(event) => setRefusal(event.target.checked)} />期望拒答或证据不足</label>
      <label>期望降级原因（可选）<SelectControl ariaLabel="期望降级原因" disabled={pending} value={degraded} onValueChange={setDegraded}
        options={[{ value: "", label: "不限定" }, { value: "provider-unavailable", label: "模型服务不可用" }, { value: "token-budget-exhausted", label: "Token 预算耗尽" }]} /></label>
      {error ? <p role="alert">{error}</p> : null}
      <div className="dialog-actions"><Button type="button" variant="outline" disabled={pending} onClick={onClose}>取消</Button>
        <Button type="submit" disabled={pending} aria-busy={pending}>{pending ? "保存中…" : "保存用例"}</Button></div>
    </form>}
  </ModalDialog>;
}
