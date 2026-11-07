import { useEffect, useRef, useState } from "react";
import { ModalDialog } from "@/components/common/ModalDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Download, Upload } from "lucide-react";
import { buildUserImportTemplate, parseUserImportWorkbook } from "@/application/userImportWorkbook";
import type { UserGovernanceActions } from "@/UserPermissionsPage";
import type { UserImportPreview } from "@/infrastructure/http/userGovernanceClient";
import type { PlatformRoleId } from "@/domain/users/types";
import { presentError } from "@/infrastructure/http/presentError";

export function UserImportDialog({ organizationId, actions, roleLabels, canGrantPlatformAdmin, onClose }: {
  organizationId: string; actions: UserGovernanceActions; roleLabels: Record<PlatformRoleId, string>; canGrantPlatformAdmin: boolean; onClose: () => void;
}) {
  const [organizationName, setOrganizationName] = useState(organizationId);
  const [preview, setPreview] = useState<UserImportPreview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  useEffect(() => {
    const counter = generation;
    let active = true;
    void actions.getOrganization?.().then((org) => { if (active) setOrganizationName(org.name); }).catch(() => {});
    return () => { active = false; counter.current++; };
  }, [actions, organizationId]);
  function download() {
    const url = URL.createObjectURL(new Blob([buildUserImportTemplate() as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "用户导入模板.xlsx"; anchor.click(); URL.revokeObjectURL(url);
  }
  async function select(file: File | undefined) {
    const current = ++generation.current;
    setPreview(null); setError(""); setFileName(file?.name ?? "");
    if (!file) { setBusy(false); return; }
    setBusy(true);
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error("文件超过 2 MiB 上限。");
      const parsed = await parseUserImportWorkbook(new Uint8Array(await file.arrayBuffer()));
      const result = await actions.previewUserImport!(parsed.rows);
      if (generation.current === current) setPreview({ ...result, errors: [...parsed.errors, ...result.errors], token: parsed.errors.length ? null : result.token });
    } catch (reason) {
      if (generation.current === current) setError(presentError(reason, "无法预检文件，请检查后重试。"));
    } finally { if (generation.current === current) setBusy(false); }
  }
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
          <Button type="button" variant="outline" onClick={download}><Download aria-hidden="true" />下载模板</Button>
        </section>
        <section className="user-import-dialog__step" aria-labelledby="user-import-upload-title">
          <div><span className="user-import-dialog__step-number">02</span><h4 id="user-import-upload-title">上传并预检</h4></div>
          <p>选择填写后的 XLSX 文件。每次 1–500 人，文件最多 2 MiB。</p>
          <div className="user-import-dialog__file">
            <Button type="button" variant="outline" onClick={() => { if (fileInput.current) { fileInput.current.value = ""; fileInput.current.click(); } }}><Upload aria-hidden="true" />选择文件</Button>
            <input ref={fileInput} type="file" hidden aria-label="选择填写后的 XLSX 文件" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => void select(event.target.files?.[0])} />
            <span title={fileName}>{fileName || "尚未选择文件"}</span>
          </div>
        </section>
      </div>
      <p className="user-import-dialog__hint">可授予角色：{Object.entries(roleLabels).filter(([id]) => canGrantPlatformAdmin || id !== "platform-admin").map(([, label]) => label).join("、")}。多个角色用中文分号（；）分隔。</p>
      {busy ? <p className="user-import-dialog__notice" role="status">正在检查文件和用户名…</p> : null}
      {error ? <div className="user-import-dialog__notice user-import-dialog__notice--error" role="alert"><strong>文件检查失败</strong><p>{error} 请修改源文件后重新选择。</p></div> : null}
      {preview ? <section className="user-import-dialog__preview" aria-label="导入预览">
        <div className="user-import-dialog__preview-heading"><div><h4>预检结果</h4><p>操作组织：{preview.organization.name}</p></div><div className="user-import-dialog__counts"><span>成员 <strong>{preview.total}</strong> 人</span><span>管理员权限 <strong>{preview.privilegedCount}</strong> 人</span></div></div>
        <div className={`user-import-dialog__notice${preview.errors.length ? " user-import-dialog__notice--error" : " user-import-dialog__notice--success"}`} role="status">
          <strong>{preview.errors.length ? `发现 ${preview.errors.length} 处问题` : "预检通过"}</strong>
          <p>{preview.errors.length ? "请修改源文件后重新上传。" : "当前仅提供预览，尚不能创建账号。"}</p>
          {preview.errors.length ? <ul>{preview.errors.map((item, index) => <li key={`${item.row}-${item.field}-${index}`}>第 {item.row} 行 · {({ name: "姓名", username: "用户名", password: "初始密码", title: "职务", roles: "组织角色" } as Record<string, string>)[item.field] ?? item.field}：{item.message}</li>)}</ul> : null}
        </div>
        <div className="user-import-dialog__table"><table><thead><tr><th scope="col">行号</th><th scope="col">姓名</th><th scope="col">用户名</th><th scope="col">职务</th><th scope="col">组织角色</th></tr></thead><tbody>{preview.rows.map((row) => <tr key={row.row}><td>{row.row}</td><td>{row.name}</td><td>{row.username}</td><td>{row.title}</td><td><div className="user-import-dialog__roles">{row.roles.map((role) => roleLabels[role]).join("；")} {row.roles.some((role) => role === "admin" || role === "platform-admin") ? <Badge variant="destructive">管理员权限</Badge> : null}</div></td></tr>)}</tbody></table></div>
      </section> : null}
    </div>
    <footer className="user-import-dialog__footer"><Button type="button" variant="outline" onClick={onClose}>取消</Button></footer>
  </>}</ModalDialog>;
}
