import { useEffect, useRef, useState } from "react";
import { ModalDialog } from "@/components/common/ModalDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Download, Upload } from "lucide-react";
import type { UserImportRow, buildUserImportReport } from "@/application/userImportWorkbook";
import type { UserGovernanceActions } from "@/UserPermissionsPage";
import type { UserImportPreview, UserImportReceipt } from "@/infrastructure/http/userGovernanceClient";
import type { PlatformRoleId } from "@/domain/users/types";
import { presentError } from "@/infrastructure/http/presentError";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";

const locatorKey = "wiseeff.user-import.pending";
type Locator = { importId: string; actorId: string; organizationId: string };

function readLocator(): Locator | null {
  const value = sessionStorage.getItem(locatorKey);
  if (!value) return null;
  const locator: unknown = JSON.parse(value);
  if (!locator || typeof locator !== "object" || !Object.hasOwn(locator, "importId") || !Object.hasOwn(locator, "actorId") || !Object.hasOwn(locator, "organizationId")) throw new Error("Invalid locator");
  const { importId, actorId, organizationId } = locator as Locator;
  if (typeof importId !== "string" || typeof actorId !== "string" || typeof organizationId !== "string" || !importId || !actorId || !organizationId) throw new Error("Invalid locator");
  return { importId, actorId, organizationId };
}

export function UserImportDialog({ actorId, organizationId, actions, roleLabels, canGrantPlatformAdmin, onClose, onCreated }: {
  actorId: string; organizationId: string; actions: UserGovernanceActions; roleLabels: Record<PlatformRoleId, string>; canGrantPlatformAdmin: boolean; onClose: () => void; onCreated: () => void;
}) {
  const [organizationName, setOrganizationName] = useState(organizationId);
  const [preview, setPreview] = useState<UserImportPreview | null>(null);
  const [error, setError] = useState("");
  const [reportError, setReportError] = useState("");
  const [fileError, setFileError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<UserImportRow[] | null>(null);
  const [receipt, setReceipt] = useState<UserImportReceipt | null>(null);
  const [outcome, setOutcome] = useState<"ready" | "pending" | "unknown" | "rolled-back">("ready");
  const [recovery, setRecovery] = useState<"checking" | "missing" | "denied" | "offline" | "other" | null>("checking");
  const importId = useRef<string | null>(null);
  const submitting = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  useEffect(() => {
    const counter = generation;
    let active = true;
    void actions.getOrganization?.().then((org) => { if (active) setOrganizationName(org.name); }).catch(() => {});
    void Promise.resolve().then(() => {
      if (!active) return;
      try {
        const locator = readLocator();
        if (!locator) setRecovery(null);
        else if (locator.actorId !== actorId || locator.organizationId !== organizationId) {
          setRecovery("other"); setOutcome("unknown");
          setError(`本标签页有另一操作者或组织的待确认批次（组织：${locator.organizationId}）。请由原操作者返回原组织查询。`);
        } else {
          importId.current = locator.importId;
          setOutcome("unknown");
          void recover();
        }
      } catch { setRecovery("other"); setError("无法读取待确认批次，请检查浏览器会话存储后重试。"); }
    });
    return () => { active = false; counter.current++; };
    // The dialog is keyed by actor and scope; its actions are fixed for that scope.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actorId, organizationId]);
  async function recover(): Promise<"found" | "missing" | "blocked"> {
    if (!importId.current || !actions.readUserImport) { setRecovery("offline"); setError("无法查询原批次，请稍后重试。"); return "blocked"; }
    const current = generation.current;
    setRecovery("checking"); setError("");
    try {
      const result = await actions.readUserImport(importId.current);
      if (generation.current !== current) return "blocked";
      sessionStorage.removeItem(locatorKey);
      importId.current = null; setReceipt(result); setRows(null); setPreview(null); setRecovery(null); setOutcome("ready"); onCreated();
      return "found";
    } catch (reason) {
      if (generation.current !== current) return "blocked";
      if (reason instanceof WiseEffApiError && reason.details.code === "import-not-confirmed") {
        setRecovery("missing"); setError("尚未找到已提交回执，原请求可能仍在执行。请稍后查询，或选择原文件使用原批次重试。");
        return "missing";
      } else if (reason instanceof WiseEffApiError && (reason.status === 401 || reason.status === 403)) {
        setRecovery("denied"); setError("当前账号无权查询原组织的批次，请联系组织管理员。");
      } else { setRecovery("offline"); setError("暂时无法查询批次结果，请检查连接后重试。"); }
      return "blocked";
    }
  }
  async function download() {
    try {
      const { buildUserImportTemplate } = await import("@/application/userImportWorkbook");
      const url = URL.createObjectURL(new Blob([buildUserImportTemplate() as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = "用户导入模板.xlsx"; anchor.click(); URL.revokeObjectURL(url);
    } catch (reason) { setError(presentError(reason, "无法下载模板，请稍后重试。")); }
  }
  async function downloadReport(input: Parameters<typeof buildUserImportReport>[0]) {
    setReportError("");
    try {
      const { buildUserImportReport } = await import("@/application/userImportWorkbook");
      const url = URL.createObjectURL(new Blob([buildUserImportReport(input) as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = input.kind === "success" ? "用户导入结果清单.xlsx" : "用户导入错误清单.xlsx"; anchor.click(); URL.revokeObjectURL(url);
    } catch { setReportError("清单下载失败，请重试。"); }
  }
  async function select(file: File | undefined) {
    const current = ++generation.current;
    const retrying = Boolean(importId.current);
    setPreview(null); setRows(null); setError(""); setReportError(""); setFileError(false); setFileName(file?.name ?? "");
    if (!file) { setBusy(false); return; }
    setBusy(true);
    try {
      if (retrying && await recover() !== "missing") return;
      const { parseUserImportWorkbook } = await import("@/application/userImportWorkbook");
      let parsed: Awaited<ReturnType<typeof parseUserImportWorkbook>>;
      try {
        if (file.size > 2 * 1024 * 1024) throw new Error("文件超过 2 MiB 上限。");
        parsed = await parseUserImportWorkbook(new Uint8Array(await file.arrayBuffer()));
      } catch (reason) { if (generation.current === current) setFileError(true); throw reason; }
      const result = await actions.previewUserImport!(parsed.rows);
      if (generation.current === current) { setRows(parsed.errors.length ? null : parsed.rows); setPreview({ ...result, errors: [...parsed.errors, ...result.errors], token: parsed.errors.length ? null : result.token }); }
    } catch (reason) {
      if (generation.current === current) setError(presentError(reason, "无法预检文件，请检查后重试。"));
    } finally { if (generation.current === current) setBusy(false); }
  }
  async function confirm() {
    if (submitting.current || !rows || !preview || !actions.createUserImport) return;
    const wasUnknown = outcome === "unknown";
    submitting.current = true;
    if (wasUnknown && await recover() !== "missing") { submitting.current = false; return; }
    if (!wasUnknown && !preview.token) { submitting.current = false; return; }
    importId.current ??= crypto.randomUUID();
    try { sessionStorage.setItem(locatorKey, JSON.stringify({ importId: importId.current, actorId, organizationId })); }
    catch { submitting.current = false; setRecovery("other"); setError("无法保存批次定位信息，未提交创建。请检查浏览器会话存储。"); return; }
    const current = generation.current;
    setOutcome("pending"); setError("");
    try {
      const result = await actions.createUserImport({ importId: importId.current, previewToken: preview.token ?? "", rows });
      if (generation.current !== current) return;
      sessionStorage.removeItem(locatorKey); importId.current = null;
      setReceipt(result); setRows(null); setPreview(null); setRecovery(null); setOutcome("ready"); onCreated();
    } catch (reason) {
      if (generation.current !== current) return;
      const confirmed = !wasUnknown && reason instanceof WiseEffApiError && (reason.details.code === "import-rolled-back" || (reason.status !== undefined && reason.status >= 400 && reason.status < 500 && reason.details.code !== "import-not-confirmed"));
      if (confirmed) { sessionStorage.removeItem(locatorKey); importId.current = null; setRecovery(null); }
      else setRecovery("missing");
      setOutcome(confirmed ? "rolled-back" : "unknown");
      setError(confirmed ? presentError(reason, "创建失败。") : "结果尚未确认。请使用原批次重试；不要重新上传并创建新批次。");
    } finally { submitting.current = false; }
  }
  const frozen = outcome === "pending" || Boolean(receipt) || (outcome === "unknown" && recovery !== "missing") || recovery === "other" || recovery === "checking";
  return <ModalDialog open onDismiss={onClose} className="user-permissions-modal-card user-import-dialog">{({ titleId }) => <>
    <header className="user-import-dialog__header">
      <div><h3 id={titleId}>批量导入成员</h3><p>填写模板并预检，在创建前核对成员信息。</p></div>
      <div className="user-import-dialog__scope"><span>操作组织</span><strong>{organizationName}</strong></div>
    </header>
    <div className="user-import-dialog__body">
      <div className="user-import-dialog__steps">
        <section className="user-import-dialog__step" aria-labelledby="user-import-template-title">
          <div><span className="user-import-dialog__step-number">01</span><h4 id="user-import-template-title">准备模板</h4></div>
          <p>填写姓名、用户名、初始密码、职务和组织角色。密码按原样使用，请私下交付。</p>
          <Button type="button" variant="outline" onClick={() => void download()}><Download aria-hidden="true" />下载模板</Button>
        </section>
        <section className="user-import-dialog__step" aria-labelledby="user-import-upload-title">
          <div><span className="user-import-dialog__step-number">02</span><h4 id="user-import-upload-title">上传并预检</h4></div>
          <p>选择填写后的 XLSX 文件。每次 1–500 人，文件最多 2 MiB。</p>
          <div className="user-import-dialog__file">
            <Button type="button" variant="outline" disabled={frozen} onClick={() => { if (fileInput.current) { fileInput.current.value = ""; fileInput.current.click(); } }}><Upload aria-hidden="true" />选择文件</Button>
            <input ref={fileInput} type="file" hidden disabled={frozen} aria-label="选择填写后的 XLSX 文件" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => void select(event.target.files?.[0])} />
            <span title={fileName}>{fileName || "尚未选择文件"}</span>
          </div>
        </section>
      </div>
      <p className="user-import-dialog__hint">可授予角色：{Object.entries(roleLabels).filter(([id]) => canGrantPlatformAdmin || id !== "platform-admin").map(([, label]) => label).join("、")}。多个角色用中文分号（；）分隔。</p>
      {busy ? <p className="user-import-dialog__notice" role="status">正在检查文件和用户名…</p> : null}
      {error ? <div className="user-import-dialog__notice user-import-dialog__notice--error" role="alert"><strong>{outcome === "unknown" ? "结果尚未确认" : outcome === "rolled-back" ? "未创建任何账号" : "文件检查失败"}</strong><p>{error}</p></div> : null}
      {reportError ? <div className="user-import-dialog__notice user-import-dialog__notice--error" role="alert">{reportError}</div> : null}
      {fileError && outcome !== "unknown" ? <><p>请修改含凭据的原始模板并重新上传预检；本清单不是可导入的凭据模板。</p><Button type="button" variant="outline" onClick={() => void downloadReport({ kind: "file-error", organizationName })}><Download aria-hidden="true" />下载错误清单</Button></> : null}
      {outcome === "pending" ? <p role="status">正在创建 {preview?.total} 位成员。关闭不会取消服务器上的创建。</p> : null}
      {outcome === "unknown" && importId.current ? <p>待确认批次编号：{importId.current}。关闭不会取消正在执行的创建。</p> : null}
      {recovery === "checking" && outcome === "unknown" ? <p role="status">正在查询原批次结果…</p> : null}
      {outcome === "unknown" && importId.current && recovery !== "checking" ? <Button type="button" variant="outline" onClick={() => void recover()}>查询原批次结果</Button> : null}
      {receipt ? <section className="user-import-dialog__notice user-import-dialog__notice--success" aria-label="创建结果"><h4>创建完成</h4><p>操作组织：{organizationName} · 已创建 {receipt.count} 人</p><p>批次编号：{receipt.importId}</p><ul>{receipt.rows.map(row => <li key={row.row}>第 {row.row} 行：{row.name ?? `用户信息不可用（${row.userId}）`}{row.username ? `（${row.username}）` : ""}</li>)}</ul><Button type="button" variant="outline" onClick={() => void downloadReport({ kind: "success", organizationName, receipt })}><Download aria-hidden="true" />下载结果清单</Button></section> : null}
      {preview && !receipt ? <section className="user-import-dialog__preview" aria-label="导入预览">
        <div className="user-import-dialog__preview-heading"><div><h4>预检结果</h4><p>操作组织：{preview.organization.name}</p></div><div className="user-import-dialog__counts"><span>成员 <strong>{preview.total}</strong> 人</span><span>管理员权限 <strong>{preview.privilegedCount}</strong> 人</span></div></div>
        <div className={`user-import-dialog__notice${preview.errors.length ? " user-import-dialog__notice--error" : " user-import-dialog__notice--success"}`} role="status">
          <strong>{preview.errors.length ? `发现 ${preview.errors.length} 处问题` : "预检通过"}</strong>
          <p>{outcome === "unknown" ? "请只使用原始文件重试；结果确认之前不要修改批次内容。" : preview.errors.length ? "请修改源文件后重新上传。" : "请核对操作组织、成员和管理员权限后确认创建。"}</p>
          {preview.errors.length ? <ul>{preview.errors.map((item, index) => <li key={`${item.row}-${item.field}-${index}`}>第 {item.row} 行 · {({ name: "姓名", username: "用户名", password: "初始密码", title: "职务", roles: "组织角色" } as Record<string, string>)[item.field] ?? item.field}：{item.message}</li>)}</ul> : null}
          {preview.errors.length && outcome !== "unknown" ? <><p>请按原始行号修改含凭据的原始模板并重新上传预检；本清单不是可导入的凭据模板。</p><Button type="button" variant="outline" onClick={() => void downloadReport({ kind: "preview", organizationName, preview })}><Download aria-hidden="true" />下载错误清单</Button></> : null}
        </div>
        <div className="user-import-dialog__table"><table><thead><tr><th scope="col">行号</th><th scope="col">姓名</th><th scope="col">用户名</th><th scope="col">职务</th><th scope="col">组织角色</th></tr></thead><tbody>{preview.rows.map((row) => <tr key={row.row}><td>{row.row}</td><td>{row.name}</td><td>{row.username}</td><td>{row.title}</td><td><div className="user-import-dialog__roles">{row.roles.map((role) => roleLabels[role]).join("；")} {row.roles.some((role) => role === "admin" || role === "platform-admin") ? <Badge variant="destructive">管理员权限</Badge> : null}</div></td></tr>)}</tbody></table></div>
      </section> : null}
    </div>
    <footer className="user-import-dialog__footer"><Button type="button" variant="outline" onClick={onClose}>{receipt ? "完成" : outcome === "unknown" || outcome === "pending" ? "关闭并稍后处理" : "取消"}</Button>{!receipt && preview && rows && actions.createUserImport && (preview.token || outcome === "unknown") ? <Button type="button" disabled={busy || outcome === "pending" || (outcome === "unknown" && recovery !== "missing")} onClick={() => void confirm()}>{outcome === "unknown" ? "使用原批次重试" : `确认创建 ${preview.total} 位成员`}</Button> : null}</footer>
  </>}</ModalDialog>;
}
