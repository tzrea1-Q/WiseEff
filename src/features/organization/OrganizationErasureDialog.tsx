import { useEffect, useState, type FormEvent } from "react";
import { ModalDialog } from "@/components/common/ModalDialog";
import { SectionError, SectionSkeleton } from "@/components/common/SectionState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatAbsolute } from "@/domain/format/formatDateTime";
import type { OrganizationDeletionPreview, OrganizationErasure, PlatformOrganizationsClient } from "@/infrastructure/http/platformOrganizationsClient";
import { presentError } from "@/infrastructure/http/presentError";

const statuses = { queued: "等待清理", running: "正在清理", failed: "清理失败，可重试", deleted: "已删除" };
const stages = { domains: "业务领域与生产者", management: "成员与组织管理记录", finalize: "确认清理结果", complete: "清理完成" };
const domainNames = { "projects-parameters": "项目与组织参数", knowledge: "知识与索引", logs: "日志与分析", "agent-devices-feedback": "Agent、设备与反馈" };
const domainStates = { pending: "等待清理", running: "正在清理", failed: "清理失败，可重试", complete: "已完成" };

export function OrganizationErasureDialog({ preview, client, onClose, onUpdated }: {
  preview?: OrganizationDeletionPreview; client: Pick<PlatformOrganizationsClient, "listErasures" | "startErasure" | "retryErasure">;
  onClose: () => void; onUpdated: () => void;
}) {
  const [items, setItems] = useState<OrganizationErasure[]>([]), [confirmation, setConfirmation] = useState("");
  const [started, setStarted] = useState(false), [pending, setPending] = useState(false), [loading, setLoading] = useState(!preview);
  const [error, setError] = useState(""), [attempt, setAttempt] = useState(0);
  const [itemErrors, setItemErrors] = useState<Record<string, string>>({}), [pendingId, setPendingId] = useState<string | null>(null);
  const confirming = Boolean(preview && !started);
  useEffect(() => {
    if (confirming) return;
    let cancelled = false;
    setLoading(true); setError("");
    void client.listErasures().then(rows => { if (!cancelled) setItems(rows); })
      .catch((failure: unknown) => { if (!cancelled) setError(presentError(failure, "无法加载组织清理记录，请重试。")); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [client, attempt, confirming]);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (!preview || pending || confirmation !== preview.organizationId) return;
    setPending(true); setError("");
    try { const item = await client.startErasure(preview, confirmation); setItems([item]); setStarted(true); onUpdated(); }
    catch (failure: unknown) { setError(presentError(failure, "无法开始清理。请关闭后重新预览影响，或从清理记录继续已接受的操作。")); }
    finally { setPending(false); }
  }
  return <ModalDialog open onDismiss={pending ? undefined : onClose} className="platform-organizations__dialog modal-card--lg">
    {({ titleId }) => <><h3 id={titleId}>{confirming ? "彻底删除组织" : "组织清理记录"}</h3>
      {confirming && preview ? <form className="modal-form-contents" onSubmit={event => void submit(event)} aria-busy={pending}>
        <p><strong>{preview.organizationName}</strong>（{preview.organizationId}）</p>
        <p>确认后立即停用本组织账号并撤销访问，清理无法撤销。失败后只能继续清理，不能恢复正常使用。需保留的账号请先调离。</p>
        <p>本次删除预览中已支持清理的业务资产、文件、成员及管理记录；平台共享数据保留。备份按部署保留周期过期。</p>
        <label className="platform-organizations__fields">输入组织编号确认<Input value={confirmation} onChange={event => setConfirmation(event.target.value)} disabled={pending} autoComplete="off" /></label>
        {error ? <p role="alert">{error}</p> : null}
        <div className="platform-organizations__actions"><Button type="button" variant="outline" disabled={pending} onClick={onClose}>取消</Button>
          <Button type="submit" variant="destructive" disabled={pending || confirmation !== preview.organizationId}>{pending ? "正在清理…" : "确认彻底删除"}</Button></div>
      </form> : <>
        <p>清理记录独立于组织和成员保存。进程中断或清理失败后，可在此继续；只有全部清理完成才显示已删除。</p>
        {loading ? <SectionSkeleton label="正在加载组织清理记录" /> : error ? <SectionError message={error} onRetry={() => setAttempt(value => value + 1)} /> : !items.length ? <p>暂无组织清理记录。</p> : items.map(item => <section key={item.id} aria-label={`组织 ${item.targetOrganizationId} 清理`}>
          <h4>{item.targetOrganizationId} · {statuses[item.status]}</h4>
          <dl className="platform-organizations__details"><dt>阶段</dt><dd>{stages[item.stage]}</dd><dt>发起人</dt><dd>{item.actorUserId}</dd>
            <dt>发起时间</dt><dd>{formatAbsolute(item.createdAt)}</dd><dt>最近更新</dt><dd>{formatAbsolute(item.updatedAt)}</dd>
            <dt>影响记录</dt><dd>{Object.values(item.counts).reduce((sum, count) => sum + count, 0)} 条</dd></dl>
          {Object.entries(item.domains).length ? <dl aria-label="领域清理进度" className="platform-organizations__details">{Object.entries(item.domains).map(([domain, progress]) =>
            <div key={domain}><dt>{domainNames[domain as keyof typeof domainNames]}</dt><dd>{domainStates[progress.status]} · 已执行 {progress.attempts} 次</dd></div>)}</dl> : null}
          {item.status === "failed" ? <p role="status">此阶段未完成。修复故障后重试会从持久进度继续。</p> : null}
          {itemErrors[item.id] ? <p role="alert">{itemErrors[item.id]}</p> : null}
          {item.status === "queued" || item.status === "failed" ? <Button disabled={pending} onClick={() => {
            setPending(true); setPendingId(item.id); setItemErrors(value => ({ ...value, [item.id]: "" }));
            void client.retryErasure(item.id).then(updated => { setItems(rows => rows.map(row => row.id === updated.id ? updated : row)); onUpdated(); })
              .catch((failure: unknown) => setItemErrors(value => ({ ...value, [item.id]: presentError(failure, "继续清理失败，请刷新后重试。") }))).finally(() => { setPending(false); setPendingId(null); });
          }}>{pendingId === item.id ? "正在处理…" : "继续清理"}</Button> : null}
        </section>)}
        <div className="platform-organizations__actions"><Button variant="outline" disabled={loading || pending} onClick={() => setAttempt(value => value + 1)}>刷新记录</Button><Button disabled={pending} onClick={onClose}>关闭记录</Button></div>
      </>}
    </>}
  </ModalDialog>;
}
