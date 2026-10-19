import { useEffect, useRef, useState } from "react";
import { DataTable } from "@/components/admin/DataTable";
import { ModalDialog } from "@/components/common/ModalDialog";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { RowActionMenu } from "@/components/common/RowActionMenu";
import { SectionError, SectionSkeleton } from "@/components/common/SectionState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatAbsolute, formatRelativeOrAbsolute } from "@/domain/format/formatDateTime";
import type { SectionProps } from "./SkillWorkspace";
import type { IntegrationCredential, IntegrationCredentialSecret } from "./types";

export function IntegrationCredentials({ skill, repository, apiMode, canEdit, disabled, onBusyChange }: Pick<SectionProps, "skill" | "repository" | "apiMode" | "canEdit" | "disabled" | "onBusyChange">) {
  const [items, setItems] = useState<IntegrationCredential[]>([]);
  const [loading, setLoading] = useState(apiMode && canEdit);
  const [loadError, setLoadError] = useState(false);
  const [reload, setReload] = useState(0);
  const [issuing, setIssuing] = useState(false);
  const [name, setName] = useState("");
  const [bound, setBound] = useState(true);
  const [action, setAction] = useState<{ kind: "rotate" | "revoke"; item: IntegrationCredential } | null>(null);
  const [reveal, setReveal] = useState<IntegrationCredentialSecret | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    onBusyChange(pending || !!reveal);
    return () => onBusyChange(false);
  }, [onBusyChange, pending, reveal]);
  useEffect(() => {
    if (!apiMode || !canEdit || !repository?.listIntegrationCredentials) { setLoading(false); return; }
    let active = true;
    setLoading(true); setLoadError(false);
    void repository.listIntegrationCredentials().then((next) => {
      if (active) { setItems(next); setLoading(false); }
    }).catch(() => { if (active) { setLoadError(true); setLoading(false); } });
    return () => { active = false; };
  }, [apiMode, canEdit, repository, reload]);
  const save = async () => {
    if (pending) return;
    setPending(true); setError("");
    try {
      if (action?.kind === "revoke") {
        const item = await repository!.revokeIntegrationCredential!(action.item.id);
        setItems((previous) => previous.map((old) => old.id === item.id ? item : old));
      } else {
        const result = action ? await repository!.rotateIntegrationCredential!(action.item.id)
          : await repository!.issueIntegrationCredential!({ name: name.trim(), skillId: bound ? skill.id : null });
        setItems((previous) => [result.item, ...previous.filter((old) => old.id !== result.item.id)]);
        setAcknowledged(false); setCopyStatus(""); setReveal(result);
      }
      setAction(null); setIssuing(false);
    } catch { setError("操作失败，请重试。"); }
    finally { setPending(false); }
  };
  const supported = !!repository?.listIntegrationCredentials && !!repository.issueIntegrationCredential && !!repository.rotateIntegrationCredential && !!repository.revokeIntegrationCredential;
  return <section aria-label="集成凭据"><h3>集成凭据</h3>
    <p>凭据仅能上传日志及读取自身创建的记录、报告和文件。默认绑定当前技能；归档技能会撤销绑定的凭据。</p>
    {!apiMode || !canEdit ? <p>{apiMode ? "管理集成凭据需要技能管理权限。" : "请在 API 模式下管理集成凭据。"}</p>
      : !supported ? <p>当前无法管理集成凭据。</p> : <>
        <Button disabled={disabled || loading || loadError} onClick={() => { setName(""); setBound(true); setError(""); setIssuing(true); }}>签发凭据</Button>
        {loading ? <SectionSkeleton label="正在加载集成凭据" /> : loadError ? <SectionError message="无法加载集成凭据" onRetry={() => setReload((value) => value + 1)} />
          : <DataTable ariaLabel="集成凭据列表" rows={items.filter((item) => !item.skillId || item.skillId === skill.id)} rowKey={(item) => item.id} tableClassName="table-fixed" emptyMessage="尚无集成凭据。" columns={[
            { key: "name", header: "名称", render: (item) => <span title={item.name}>{item.name}</span> },
            { key: "skill", header: "绑定技能", render: (item) => item.skillName ?? (item.skillId ? skill.name : "未绑定") },
            { key: "status", header: "状态", render: (item) => item.status === "active" ? "有效" : "已撤销" },
            { key: "created", header: "创建时间", render: (item) => <time title={formatAbsolute(item.createdAt)}>{formatRelativeOrAbsolute(item.createdAt)}</time> },
            { key: "used", header: "最近使用", render: (item) => item.lastUsedAt ? <time title={formatAbsolute(item.lastUsedAt)}>{formatRelativeOrAbsolute(item.lastUsedAt)}</time> : "尚未使用" },
            { key: "actions", header: "操作", render: (item) => <RowActionMenu label={`凭据 ${item.name}`} items={(["rotate", "revoke"] as const).map((kind) => ({ id: kind, label: kind === "rotate" ? "轮换" : "撤销", destructive: true, disabled: disabled || item.status !== "active", onRequestConfirmation: () => { setError(""); setAction({ kind, item }); } }))} /> }
          ]} />}
      </>}
    <ModalDialog open={issuing} initialFocusRef={nameRef} onDismiss={pending ? undefined : () => setIssuing(false)} className="skill-publish-dialog">
      {({ titleId }) => <><h2 id={titleId}>签发集成凭据</h2><label>凭据名称<Input ref={nameRef} value={name} maxLength={120} disabled={pending} onChange={(event) => setName(event.target.value)} /></label>
        <label><input type="checkbox" checked={bound} disabled={pending} onChange={(event) => setBound(event.target.checked)} />绑定到当前技能</label>
        {!bound ? <p>未绑定凭据可向本组织的其他技能上传日志。</p> : null}
        {error ? <p role="alert" className="skill-field-error">{error}</p> : null}
        <div className="dialog-actions"><Button variant="outline" disabled={pending} onClick={() => setIssuing(false)}>取消</Button><Button disabled={pending || !name.trim()} onClick={() => void save()}>签发</Button></div></>}
    </ModalDialog>
    <ConfirmDialog open={!!action} title={action?.kind === "rotate" ? "轮换集成凭据" : "撤销集成凭据"}
      description={action?.kind === "rotate" ? `轮换「${action.item.name}」后，旧密钥立即失效。请更新调用方。` : `撤销「${action?.item.name ?? ""}」后，该凭据立即失效且无法恢复。`}
      confirmLabel={action?.kind === "rotate" ? "确认轮换" : "确认撤销"} tone={action?.kind === "revoke" ? "danger" : "primary"} pending={pending} error={error}
      onConfirm={() => void save()} onCancel={() => setAction(null)} />
    <ModalDialog open={!!reveal} onDismiss={acknowledged ? () => setReveal(null) : undefined} className="skill-publish-dialog" describedBy>
      {({ titleId, descriptionId }) => <><h2 id={titleId}>保存集成凭据</h2><p id={descriptionId}>密钥仅显示一次。请保存到安全的密钥管理工具，不要写入日志或代码仓库。</p>
        <label>集成凭据<Input readOnly value={reveal?.token ?? ""} autoComplete="off" spellCheck={false} /></label>
        <Button variant="outline" onClick={() => { void navigator.clipboard.writeText(reveal?.token ?? "").then(() => setCopyStatus("已复制密钥"), () => setCopyStatus("复制失败，请手动复制。")); }}>复制密钥</Button>
        {copyStatus ? <p role="status">{copyStatus}</p> : null}
        <label><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />我已安全保存密钥</label>
        <div className="dialog-actions"><Button disabled={!acknowledged} onClick={() => setReveal(null)}>完成</Button></div></>}
    </ModalDialog>
  </section>;
}
