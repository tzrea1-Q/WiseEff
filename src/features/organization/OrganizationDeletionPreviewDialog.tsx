import { useEffect, useState } from "react";
import { ModalDialog } from "@/components/common/ModalDialog";
import { SectionError, SectionSkeleton } from "@/components/common/SectionState";
import { Button } from "@/components/ui/button";
import type { OrganizationDeletionPreview, PlatformOrganizationsClient } from "@/infrastructure/http/platformOrganizationsClient";
import { presentError } from "@/infrastructure/http/presentError";

const categories: Record<string, string> = {
  accounts: "账号与访问凭据", "teams-invitations": "团队与邀请", projects: "项目、配置、参数值与历史",
  "organization-parameters": "组织参数、模块与规范", catalog: "组织 Catalog 登记与项目数据", "legacy-archives": "离线归档与保护证据",
  knowledge: "知识、附件与索引", logs: "日志、分析、技能与源码索引", agent: "Agent 会话与检查点", devices: "设备代理、调试与操作记录",
  "feedback-notifications": "反馈、通知与跨组织通知副本", audit: "组织审计与历史关联", producers: "后台任务",
  "shared-references": "保留的共享资源关联", "shared-provenance": "保留的共享来源记录", "platform-catalog": "平台共享 Catalog（保留）", unclassified: "尚未核实归属的关系"
};

export function OrganizationDeletionPreviewDialog({ organizationId, client, onClose, onNavigate, onRequestDelete, onOpenRegistrationSettings }: {
  organizationId: string; client: Pick<PlatformOrganizationsClient, "previewDeletion">; onClose: () => void; onNavigate: (path: string) => void;
  onRequestDelete?: (preview: OrganizationDeletionPreview) => void;
  onOpenRegistrationSettings?: () => void;
}) {
  const [preview, setPreview] = useState<OrganizationDeletionPreview | null>(null), [error, setError] = useState("");
  const [loading, setLoading] = useState(true), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(""); setPreview(null);
    void client.previewDeletion(organizationId).then(item => { if (!cancelled) setPreview(item); })
      .catch((failure: unknown) => { if (!cancelled) setError(presentError(failure, "无法加载删除影响，请重试。")); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [client, organizationId, attempt]);
  const counts = preview?.inventory.reduce<Record<string, number>>((result, row) => { result[row.category] = (result[row.category] ?? 0) + row.count; return result; }, {});
  const managementOnly = preview && !preview.inventory.some(item => item.count && !["accounts", "teams-invitations", "audit", "platform-catalog"].includes(item.category)) && !preview.storage.exclusiveObjects && !preview.storage.sharedObjects;
  const executionAvailable = preview?.executionAvailable ?? managementOnly;
  const impactRows = preview ? [...Object.entries(categories).map(([key, label]) => ({ key, label, count: counts?.[key] ?? 0, unit: key === "unclassified" ? "项" : "条" })),
    { key: "exclusive-files", label: "数据库登记的独占文件", count: preview.storage.exclusiveObjects, unit: "个" },
    { key: "shared-files", label: "其他组织或平台仍引用的共享文件（保留）", count: preview.storage.sharedObjects, unit: "个" }] : [];
  const zeroRows = [...impactRows.filter(row => !row.count), ...(preview?.producers.filter(row => !row.count).map(row => ({ ...row, key: `producer:${row.key}`, unit: "项" })) ?? [])];
  return <ModalDialog open onDismiss={onClose} className="platform-organizations__dialog organization-deletion-dialog modal-card--lg">
    {({ titleId }) => <><h3 id={titleId}>组织删除影响预览</h3>
      <div className="platform-organizations__body">{loading ? <SectionSkeleton label="正在核对组织删除影响" /> : error ? <SectionError message={error} onRetry={() => setAttempt(value => value + 1)} /> : preview ? <>
        <p><strong>{preview.organizationName}</strong>（{preview.organizationId}）</p>
        <p>本页仅查看影响，不会执行删除。需保留的平台账号请先调离。</p>
        {onRequestDelete && !executionAvailable && !preview.blockers.length ? <p>当前预览未允许执行删除，请核对影响明细。</p> : null}
        {preview.blockers.length ? <div role="status"><strong>执行前需处理</strong><ul>{preview.blockers.map(item => <li key={item.code}>{item.message}</li>)}</ul></div> : null}
        {preview.blockers.some(item => item.code === "experience-registration") && onOpenRegistrationSettings ? <Button variant="outline" onClick={onOpenRegistrationSettings}>调整体验注册设置</Button> : null}
        <p>下列数量包含历史及关联记录；尚未核实的归属按关系项计数。</p>
        <dl className="platform-organizations__details" aria-label="组织删除影响数量">
          {impactRows.filter(row => row.count > 0).map(row => <div key={row.key} className="organization-deletion__count"><dt>{row.label}</dt><dd>{row.count} {row.unit}</dd></div>)}
        </dl>
        {!impactRows.some(row => row.count > 0) ? <p>未发现需要删除的组织数据或文件。</p> : null}
        {preview.inventory.some(item => item.count > 0) ? <details><summary>查看数据表明细</summary><dl className="platform-organizations__details">{preview.inventory.filter(item => item.count > 0).map(item => <div key={item.key} className="organization-deletion__count"><dt>{item.key}</dt><dd>{item.count} {item.category === "unclassified" ? "项" : "条"}</dd></div>)}</dl></details> : null}
        <section aria-label="平台账号影响"><h4>平台账号</h4><p>组织外可登录的平台超级管理员：{preview.survivingPlatformAdministrators} 位</p>
          {preview.platformAccounts.length ? <ul>{preview.platformAccounts.map(account => <li key={account.id}>{account.name}（{account.id}） · {!account.isActive ? "已停用" : account.canLogin ? "可登录" : "尚不能登录"}</li>)}</ul> : <p>本组织没有平台账号。</p>}
          {preview.platformAccounts.length || counts?.accounts ? <Button variant="outline" onClick={() => onNavigate(`/organization/members?organizationId=${encodeURIComponent(organizationId)}`)}>管理与调动成员</Button> : null}
        </section>
        <section aria-label="在途工作影响"><h4>需要停止或协调的工作</h4>{preview.producers.some(item => item.count > 0) ? <ul>{preview.producers.filter(item => item.count > 0).map(item => <li key={item.key}>{item.label}：{item.count}</li>)}</ul> : <p>当前没有在途工作。</p>}</section>
        {zeroRows.length ? <details><summary>查看零值明细（{zeroRows.length} 项）</summary><dl className="platform-organizations__details">{zeroRows.map(row => <div key={row.key} className="organization-deletion__count"><dt>{row.label}</dt><dd>0 {row.unit}</dd></div>)}</dl></details> : null}
        <p>公开体验注册：{preview.experienceRegistration.isTarget ? preview.experienceRegistration.enabled ? "当前正在使用此组织，需先关闭或更换目标。" : "已关闭，仍配置为此组织。" : "未指向此组织。"}</p>
        {preview.notes.length > 2 ? <section aria-label="删除边界"><h4>保留范围与恢复边界</h4><ul>{preview.notes.slice(2).map(note => <li key={note}>{note}</li>)}</ul></section> : null}
      </> : null}</div>
      <div className="platform-organizations__actions platform-organizations__footer">
        {preview && onRequestDelete && preview.admissionAvailable && executionAvailable && ["active", "suspended"].includes(preview.status) ? <Button variant="destructive" onClick={() => onRequestDelete(preview)}>开始彻底删除</Button> : null}
        <Button variant="outline" disabled={loading} onClick={() => setAttempt(value => value + 1)}>刷新影响</Button>
        <Button onClick={onClose}>关闭预览</Button>
      </div>
    </>}
  </ModalDialog>;
}
