import { useEffect, useRef, useState } from "react";
import { ModalDialog } from "@/components/common/ModalDialog";
import { Badge } from "@/components/ui/badge";
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
    setPreview(null); setError("");
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
    <h3 id={titleId}>批量导入成员</h3>
    <div className="modal-body user-import-dialog__body">
      <p>操作组织：<strong>{organizationName}</strong></p>
      <p>下载模板并填写“用户数据”表的五列：姓名、用户名、初始密码、职务和组织角色。每次 1–500 人，文件最多 2 MiB；密码将按原样使用，请私下交付。</p>
      <p>可授予角色：{Object.entries(roleLabels).filter(([id]) => canGrantPlatformAdmin || id !== "platform-admin").map(([, label]) => label).join("、")}。多个角色用中文分号分隔。</p>
      <button type="button" className="button" onClick={download}>下载模板</button>
      <label className="user-import-dialog__upload">选择填写后的 XLSX 文件<input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => void select(event.target.files?.[0])} /></label>
      {busy ? <p role="status">正在检查文件和用户名…</p> : null}
      {error ? <p role="alert">文件检查失败：{error}</p> : null}
      {preview ? <section aria-label="导入预览">
        <h4>预检结果</h4><p>操作组织：<strong>{preview.organization.name}</strong> · {preview.total} 人 · 管理员权限 {preview.privilegedCount} 人</p>
        <p role="status">{preview.errors.length ? `发现 ${preview.errors.length} 处问题，请修改源文件后重新上传。` : "预检通过；当前仅提供预览，尚不能创建账号。"}</p>
        {preview.errors.length ? <ul>{preview.errors.map((item, index) => <li key={`${item.row}-${item.field}-${index}`}>第 {item.row} 行 · {({ name: "姓名", username: "用户名", password: "初始密码", title: "职务", roles: "组织角色" } as Record<string, string>)[item.field] ?? item.field}：{item.message}</li>)}</ul> : null}
        <div className="user-import-dialog__table"><table><thead><tr><th>行号</th><th>姓名</th><th>用户名</th><th>职务</th><th>组织角色</th></tr></thead><tbody>{preview.rows.map((row) => <tr key={row.row}><td>{row.row}</td><td>{row.name}</td><td>{row.username}</td><td>{row.title}</td><td>{row.roles.map((role) => roleLabels[role]).join("；")} {row.roles.some((role) => role === "admin" || role === "platform-admin") ? <Badge variant="destructive">管理员权限</Badge> : null}</td></tr>)}</tbody></table></div>
      </section> : null}
    </div>
    <div className="modal-actions"><button type="button" className="button" onClick={onClose}>取消</button></div>
  </>}</ModalDialog>;
}
