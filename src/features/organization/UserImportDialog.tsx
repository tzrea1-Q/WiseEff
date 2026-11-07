import { useEffect, useRef, useState } from "react";
import { ModalDialog } from "@/components/common/ModalDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Download, Upload } from "lucide-react";
import type { UserImportRow } from "@/application/userImportWorkbook";
import type { UserGovernanceActions } from "@/UserPermissionsPage";
import type { UserImportPreview, UserImportReceipt } from "@/infrastructure/http/userGovernanceClient";
import type { PlatformRoleId } from "@/domain/users/types";
import { presentError } from "@/infrastructure/http/presentError";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";

export function UserImportDialog({ organizationId, actions, roleLabels, canGrantPlatformAdmin, onClose, onCreated }: {
  organizationId: string; actions: UserGovernanceActions; roleLabels: Record<PlatformRoleId, string>; canGrantPlatformAdmin: boolean; onClose: () => void; onCreated: () => void;
}) {
  const [organizationName, setOrganizationName] = useState(organizationId);
  const [preview, setPreview] = useState<UserImportPreview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<UserImportRow[] | null>(null);
  const [receipt, setReceipt] = useState<UserImportReceipt | null>(null);
  const [outcome, setOutcome] = useState<"ready" | "pending" | "unknown" | "rolled-back">("ready");
  const importId = useRef<string | null>(null);
  const submitting = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  useEffect(() => {
    const counter = generation;
    let active = true;
    void actions.getOrganization?.().then((org) => { if (active) setOrganizationName(org.name); }).catch(() => {});
    return () => { active = false; counter.current++; };
  }, [actions, organizationId]);
  async function download() {
    try {
      const { buildUserImportTemplate } = await import("@/application/userImportWorkbook");
      const url = URL.createObjectURL(new Blob([buildUserImportTemplate() as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = "用户导入模板.xlsx"; anchor.click(); URL.revokeObjectURL(url);
    } catch (reason) { setError(presentError(reason, "无法下载模板，请稍后重试。")); }
  }
  async function select(file: File | undefined) {
    const current = ++generation.current;
    setPreview(null); setRows(null); importId.current = null; setOutcome("ready"); setError(""); setFileName(file?.name ?? "");
    if (!file) { setBusy(false); return; }
    setBusy(true);
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error("文件超过 2 MiB 上限。");
      const { parseUserImportWorkbook } = await import("@/application/userImportWorkbook");
      const parsed = await parseUserImportWorkbook(new Uint8Array(await file.arrayBuffer()));
      const result = await actions.previewUserImport!(parsed.rows);
      if (generation.current === current) { setRows(parsed.rows); setPreview({ ...result, errors: [...parsed.errors, ...result.errors], token: parsed.errors.length ? null : result.token }); }
    } catch (reason) {
      if (generation.current === current) setError(presentError(reason, "无法预检文件，请检查后重试。"));
    } finally { if (generation.current === current) setBusy(false); }
  }
  async function confirm() {
    if (submitting.current || !rows || !preview?.token || !actions.createUserImport) return;
    const wasUnknown = outcome === "unknown";
    submitting.current = true;
    importId.current ??= crypto.randomUUID();
    setOutcome("pending"); setError("");
    try {
      const result = await actions.createUserImport({ importId: importId.current, previewToken: preview.token, rows });
      setReceipt(result); setRows(null); setOutcome("ready"); onCreated();
    } catch (reason) {
      const confirmed = !wasUnknown && reason instanceof WiseEffApiError && (reason.details.code === "import-rolled-back" || (reason.status !== undefined && reason.status >= 400 && reason.status < 500 && reason.details.code !== "import-not-confirmed"));
      setOutcome(confirmed ? "rolled-back" : "unknown");
      setError(confirmed ? presentError(reason, "创建失败。") : "结果尚未确认。请使用原批次重试；不要重新上传并创建新批次。");
    } finally { submitting.current = false; }
  }
  const frozen = outcome === "pending" || outcome === "unknown" || Boolean(receipt);
  return <ModalDialog open onDismiss={outcome === "pending" || outcome === "unknown" ? undefined : onClose} className="user-permissions-modal-card user-import-dialog">{({ titleId }) => <>
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
      {outcome === "pending" ? <p role="status">正在创建 {preview?.total} 位成员，请勿关闭页面…</p> : null}
      {outcome === "unknown" ? <p>待确认批次编号：{importId.current}。关闭不会取消正在执行的创建，请先记录编号。</p> : null}
      {receipt ? <section className="user-import-dialog__notice user-import-dialog__notice--success" aria-label="创建结果"><h4>创建完成</h4><p>操作组织：{organizationName} · 已创建 {receipt.count} 人</p><p>批次编号：{receipt.importId}</p><ul>{receipt.rows.map(row => <li key={row.row}>第 {row.row} 行：{row.name ?? row.userId}{row.username ? `（${row.username}）` : ""}</li>)}</ul></section> : null}
      {preview && !receipt ? <section className="user-import-dialog__preview" aria-label="导入预览">
        <div className="user-import-dialog__preview-heading"><div><h4>预检结果</h4><p>操作组织：{preview.organization.name}</p></div><div className="user-import-dialog__counts"><span>成员 <strong>{preview.total}</strong> 人</span><span>管理员权限 <strong>{preview.privilegedCount}</strong> 人</span></div></div>
        <div className={`user-import-dialog__notice${preview.errors.length ? " user-import-dialog__notice--error" : " user-import-dialog__notice--success"}`} role="status">
          <strong>{preview.errors.length ? `发现 ${preview.errors.length} 处问题` : "预检通过"}</strong>
          <p>{preview.errors.length ? "请修改源文件后重新上传。" : "请核对操作组织、成员和管理员权限后确认创建。"}</p>
          {preview.errors.length ? <ul>{preview.errors.map((item, index) => <li key={`${item.row}-${item.field}-${index}`}>第 {item.row} 行 · {({ name: "姓名", username: "用户名", password: "初始密码", title: "职务", roles: "组织角色" } as Record<string, string>)[item.field] ?? item.field}：{item.message}</li>)}</ul> : null}
        </div>
        <div className="user-import-dialog__table"><table><thead><tr><th scope="col">行号</th><th scope="col">姓名</th><th scope="col">用户名</th><th scope="col">职务</th><th scope="col">组织角色</th></tr></thead><tbody>{preview.rows.map((row) => <tr key={row.row}><td>{row.row}</td><td>{row.name}</td><td>{row.username}</td><td>{row.title}</td><td><div className="user-import-dialog__roles">{row.roles.map((role) => roleLabels[role]).join("；")} {row.roles.some((role) => role === "admin" || role === "platform-admin") ? <Badge variant="destructive">管理员权限</Badge> : null}</div></td></tr>)}</tbody></table></div>
      </section> : null}
    </div>
    <footer className="user-import-dialog__footer"><Button type="button" variant="outline" disabled={outcome === "pending"} onClick={onClose}>{receipt ? "完成" : outcome === "unknown" ? "关闭并稍后处理" : "取消"}</Button>{!receipt && preview?.token && rows && actions.createUserImport ? <Button type="button" disabled={busy || outcome === "pending"} onClick={() => void confirm()}>{outcome === "unknown" ? "使用原批次重试" : `确认创建 ${preview.total} 位成员`}</Button> : null}</footer>
  </>}</ModalDialog>;
}
