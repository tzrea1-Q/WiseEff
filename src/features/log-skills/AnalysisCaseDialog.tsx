import { useId, useState } from "react";
import { parse, stringify } from "yaml";
import { ModalDialog } from "@/components/common/ModalDialog";
import { SelectControl } from "@/components/common/SelectControl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { presentError } from "@/infrastructure/http/presentError";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import type { AnalysisCaseExpectations, AnalysisCaseInput } from "./types";
import "./skill-workspace.css";

const categories = ["thermal-protection", "communication-failure", "device-unavailable", "power-delivery-degradation", "configuration-error", "hardware-fault", "software-fault", "no-fault", "insufficient-evidence"];
const categoryLabels = ["过热保护", "通信失败", "设备不可用", "供电退化", "配置错误", "硬件故障", "软件故障", "无故障", "证据不足"];
export const emptyCaseExpectations: AnalysisCaseExpectations = { domain: "generic", summary: "", realLog: false,
  rootCauseCategory: "software-fault", rootCausePoints: [], keyEvidenceLines: [], expectedActions: [], expectRefusal: false };
const lines = (value: string) => value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
export function presentAnalysisCaseError(cause: unknown, fallback: string) {
  if (cause instanceof WiseEffApiError) {
    if (Array.isArray(cause.details.problems)) return `${presentError(cause, fallback)} ${cause.details.problems.filter((problem) => typeof problem === "string").join("；")}`;
    const issues = cause.details.issues;
    if (Array.isArray(issues)) return `${presentError(cause, fallback)} ${issues.map((issue) => {
      if (!issue || typeof issue !== "object") return "";
      const path = Array.isArray(issue.path) ? issue.path.join(".") : typeof issue.path === "string" ? issue.path : "";
      return `${path}：${typeof issue.message === "string" ? issue.message : "内容无效"}`;
    }).join("；")}`;
  }
  return presentError(cause, fallback);
}

export function AnalysisCaseDialog({ initial, uploadRequired = false, title = "编辑分析用例", onSave, onClose }: {
  initial: Pick<AnalysisCaseInput, "name" | "expectations">; uploadRequired?: boolean; title?: string;
  onSave: (input: AnalysisCaseInput) => Promise<void>; onClose: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [category, setCategory] = useState<AnalysisCaseExpectations["rootCauseCategory"]>(initial.expectations.rootCauseCategory);
  const [rootCause, setRootCause] = useState(initial.expectations.rootCausePoints.join("\n"));
  const [actions, setActions] = useState(initial.expectations.expectedActions.join("\n"));
  const [evidence, setEvidence] = useState(stringify(initial.expectations.keyEvidence ?? initial.expectations.keyEvidenceLines.map((line) => ({ file: "log.txt", line }))));
  const [refusal, setRefusal] = useState(initial.expectations.expectRefusal);
  const [degraded, setDegraded] = useState(initial.expectations.expectedDegradedReason ?? "");
  const [files, setFiles] = useState<File[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const evidenceHelp = useId();
  return <ModalDialog open onDismiss={pending ? undefined : onClose} className="skill-authoring-dialog modal-card--lg">
    {({ titleId }) => <form onSubmit={(event) => {
      event.preventDefault(); setError("");
      void (async () => {
        try {
          if (uploadRequired && (!files.length || files.length > 100 || files.reduce((total, file) => total + file.size, 0) > 10 * 1024 * 1024)) throw new Error("每个用例最多 100 个文件、10 MiB 原始日志包。");
          const keyEvidence: unknown = parse(evidence);
          if (!Array.isArray(keyEvidence) || keyEvidence.some((item) => !item || typeof item.file !== "string" || !item.file.trim()
            || (item.line !== undefined && (!Number.isInteger(item.line) || item.line < 1))
            || (item.pattern !== undefined && (typeof item.pattern !== "string" || !item.pattern.trim()))
            || (item.line === undefined && item.pattern === undefined))) throw new Error("关键证据应为文件路径和行号或模式的列表。");
          const expectations: AnalysisCaseExpectations = { ...initial.expectations, summary: name.trim(), rootCauseCategory: category,
            rootCausePoints: lines(rootCause), expectedActions: lines(actions), keyEvidence: keyEvidence as AnalysisCaseExpectations["keyEvidence"],
            keyEvidenceLines: [], expectRefusal: refusal };
          if (degraded === "provider-unavailable" || degraded === "token-budget-exhausted") expectations.expectedDegradedReason = degraded;
          else delete expectations.expectedDegradedReason;
          setPending(true);
          await onSave({ name: name.trim(), expectations, ...(uploadRequired ? { files } : {}) });
          onClose();
        } catch (cause) { setError(presentAnalysisCaseError(cause, "保存分析用例失败，请检查输入后重试。")); }
        finally { setPending(false); }
      })();
    }}>
      <h2 id={titleId}>{title}</h2>
      <p>保留原始日志包，使用真实模型对比草稿与已发布版本。每行填写一条根因或建议。</p>
      <label>用例名称<Input required maxLength={200} disabled={pending} value={name} onChange={(event) => setName(event.target.value)} /></label>
      {uploadRequired ? <label>原始日志包<Input type="file" multiple required disabled={pending} onChange={(event) => setFiles(Array.from(event.target.files ?? []))} /></label> : null}
      {uploadRequired ? <p>最多 100 个文件、10 MiB；可选择多个文本日志或一个压缩包。</p> : null}
      <label>根因分类<SelectControl value={category} ariaLabel="根因分类" disabled={pending} onValueChange={(value) => setCategory(value as AnalysisCaseExpectations["rootCauseCategory"])}
        options={categories.map((value, index) => ({ value, label: categoryLabels[index] }))} /></label>
      <label>期望根因或结论<Textarea required={!refusal} rows={3} maxLength={20000} disabled={pending} value={rootCause} onChange={(event) => setRootCause(event.target.value)} /></label>
      <label>关键证据（YAML）<Textarea rows={5} maxLength={20000} disabled={pending} value={evidence} onChange={(event) => setEvidence(event.target.value)}
        aria-describedby={evidenceHelp} /></label>
      <p id={evidenceHelp}>例如：- {"{file: device.log, line: 12}"}；可将 line 替换为 pattern 匹配模式。</p>
      <label>期望建议动作<Textarea required={!refusal} rows={3} maxLength={20000} disabled={pending} value={actions} onChange={(event) => setActions(event.target.value)} /></label>
      <label className="flex items-center gap-2"><input type="checkbox" disabled={pending} checked={refusal} onChange={(event) => setRefusal(event.target.checked)} />期望拒答或证据不足</label>
      <label>期望降级原因（可选）<SelectControl ariaLabel="期望降级原因" disabled={pending} value={degraded} onValueChange={setDegraded}
        options={[{ value: "", label: "不限定" }, { value: "provider-unavailable", label: "模型服务不可用" }, { value: "token-budget-exhausted", label: "Token 预算耗尽" }]} /></label>
      {error ? <p role="alert">{error}</p> : null}
      <div className="dialog-actions"><Button type="button" variant="outline" disabled={pending} onClick={onClose}>取消</Button>
        <Button type="submit" disabled={pending || !name.trim() || (uploadRequired && !files.length)} aria-busy={pending}>{pending ? "保存中…" : "保存用例"}</Button></div>
    </form>}
  </ModalDialog>;
}
