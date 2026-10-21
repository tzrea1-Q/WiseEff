import { useCallback, useEffect, useState } from "react";
import { DataTable } from "./DataTable";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { SectionEmpty, SectionError, SectionSkeleton } from "@/components/common/SectionState";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { formatAbsolute } from "@/domain/format/formatDateTime";
import { presentError } from "@/infrastructure/http/presentError";
import { listOrganizationBridges, revokeOrganizationBridge, type OrganizationDeviceBridge } from "@/infrastructure/http/deviceBridgeClient";

const defaultActions = { list: listOrganizationBridges, revoke: revokeOrganizationBridge };

export function OrganizationBridgePanel({ enabled, actions = defaultActions }: {
  enabled: boolean;
  actions?: { list(): Promise<OrganizationDeviceBridge[]>; revoke(id: string, reason: string): Promise<OrganizationDeviceBridge> };
}) {
  const [items, setItems] = useState<OrganizationDeviceBridge[] | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<OrganizationDeviceBridge | null>(null);
  const [reason, setReason] = useState("");
  const [mutationError, setMutationError] = useState("");
  const [pending, setPending] = useState(false);
  const load = useCallback(async () => {
    setError("");
    try { setItems(await actions.list()); } catch (failure) { setError(presentError(failure, "无法加载设备代理，请重试。")); }
  }, [actions]);
  useEffect(() => { if (enabled) void load(); }, [enabled, load]);
  async function revoke() {
    if (!selected || pending || !reason.trim()) return;
    setPending(true); setMutationError("");
    try {
      const item = await actions.revoke(selected.id, reason.trim());
      setItems(current => current?.map(existing => existing.id === item.id ? item : existing) ?? null);
      setSelected(null);
    } catch (failure) { setMutationError(presentError(failure, "撤销失败，请重试。")); }
    finally { setPending(false); }
  }
  if (!enabled) return <SectionEmpty title="设备代理治理需要管理员权限与 API 模式" message="请在已连接后台的组织管理页面操作。" />;
  return <section className="grid gap-4" aria-label="组织设备代理">
    <div><h2>设备代理</h2><p>仅管理本组织成员的配对。撤销会断开连接并使原凭据失效；不会授予设备执行权限。</p></div>
    <div><Button variant="outline" disabled={pending} onClick={() => void load()}>刷新目录</Button></div>
    {error ? <SectionError message={error} onRetry={() => void load()} /> : !items ? <SectionSkeleton label="正在加载设备代理" /> :
      <DataTable rows={items} rowKey={item => item.id} ariaLabel="组织设备代理" emptyState={<SectionEmpty title="本组织尚无设备代理" message="成员在调试工作台完成配对后显示在此。" />} columns={[
        { key: "owner", header: "所有者", render: item => <span title={item.ownerUserId}>{item.ownerName ?? item.ownerUserId}</span> },
        { key: "machine", header: "机器", render: item => <div className="max-w-64 break-all"><strong>{item.machineLabel}</strong><p className="text-xs text-muted-foreground">{item.id}</p></div> },
        { key: "version", header: "平台 / 版本", render: item => <span>{item.platform} / {item.arch}<br />{item.clientVersion ?? "版本未知"}</span> },
        { key: "state", header: "状态", render: item => item.revokedAt ? "已撤销" : item.online ? "在线" : "离线" },
        { key: "seen", header: "最后活动", render: item => item.lastSeenAt ? formatAbsolute(item.lastSeenAt) : "尚无活动" },
        { key: "revoked", header: "撤销时间", render: item => item.revokedAt ? formatAbsolute(item.revokedAt) : "—" }
      ]} renderRowActions={item => item.revokedAt ? null : <Button variant="outline" size="sm" disabled={pending} onClick={() => { setSelected(item); setReason(""); setMutationError(""); }}>撤销配对</Button>} />}
    <ConfirmDialog open={!!selected} title="撤销设备代理配对？" tone="danger" confirmLabel="撤销配对" pending={pending} confirmDisabled={!reason.trim()} error={mutationError}
      description={<>将撤销“{selected?.ownerName ?? selected?.ownerUserId}”的“{selected?.machineLabel}”（{selected?.id}）。该电脑的现有连接和凭据将失效，重新使用需由成员重新配对。</>}
      extra={<label className="grid gap-2">撤销原因<Textarea value={reason} maxLength={500} disabled={pending} onChange={event => setReason(event.target.value)} /></label>}
      onCancel={() => setSelected(null)} onConfirm={() => void revoke()} />
  </section>;
}
