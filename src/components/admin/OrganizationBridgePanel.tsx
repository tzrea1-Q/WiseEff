import { useCallback, useEffect, useRef, useState } from "react";
import { DataTable } from "./DataTable";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { SectionEmpty, SectionError, SectionSkeleton } from "@/components/common/SectionState";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { SearchField } from "@/components/common/SearchField";
import { SelectControl } from "@/components/common/SelectControl";
import { formatAbsolute } from "@/domain/format/formatDateTime";
import { presentError } from "@/infrastructure/http/presentError";
import { listOrganizationBridges, revokeOrganizationBridge, type OrganizationDeviceBridge } from "@/infrastructure/http/deviceBridgeClient";

const defaultActions = { list: listOrganizationBridges, revoke: revokeOrganizationBridge };

export function OrganizationBridgePanel({ enabled, actions = defaultActions, readOnly = false, onNavigate }: {
  enabled: boolean;
  readOnly?: boolean;
  onNavigate?: (path: string) => void;
  actions?: { list(): Promise<OrganizationDeviceBridge[]>; revoke(id: string, reason: string): Promise<OrganizationDeviceBridge> };
}) {
  const [items, setItems] = useState<OrganizationDeviceBridge[] | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<OrganizationDeviceBridge | null>(null);
  const [reason, setReason] = useState("");
  const [mutationError, setMutationError] = useState("");
  const [pending, setPending] = useState(false);
  const [loading, setLoading] = useState(false), [query, setQuery] = useState(""), [status, setStatus] = useState("all");
  const generation = useRef(0);
  const load = useCallback(async () => {
    const request = ++generation.current;
    setError(""); setLoading(true);
    try { const next = await actions.list(); if (request === generation.current) setItems(next); }
    catch (failure) { if (request === generation.current) setError(presentError(failure, "无法加载设备代理，请重试。")); }
    finally { if (request === generation.current) setLoading(false); }
  }, [actions]);
  useEffect(() => { if (enabled) void load(); return () => { generation.current++; }; }, [enabled, load]);
  useEffect(() => { if (readOnly) { setSelected(null); setReason(""); setMutationError(""); } }, [readOnly]);
  async function revoke() {
    if (!selected || pending || readOnly || !reason.trim()) return;
    generation.current++; setLoading(false);
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
    <div><h2>设备代理</h2><p className="text-sm text-muted-foreground">查看成员的设备代理配对。{readOnly ? "当前组织仅可查看。" : "撤销后，原连接和凭据立即失效。"}</p></div>
    <div className="flex flex-wrap items-center gap-3"><SearchField ariaLabel="搜索设备代理" placeholder="搜索成员、机器或代理编号" value={query} onValueChange={setQuery} />
      <SelectControl ariaLabel="筛选设备代理状态" value={status} onValueChange={setStatus} options={[{ value: "all", label: "全部状态" }, { value: "online", label: "在线" }, { value: "offline", label: "离线" }, { value: "revoked", label: "已撤销" }]} />
      <Button variant="outline" disabled={pending || loading} onClick={() => void load()}>{loading ? "刷新中…" : "刷新目录"}</Button></div>
    {error ? <SectionError message={error} onRetry={() => void load()} /> : null}
    {!items ? !error && <SectionSkeleton label="正在加载设备代理" /> :
      <DataTable rows={items.filter(item => `${item.ownerName ?? ""} ${item.ownerUserId} ${item.machineLabel} ${item.id}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
        && (status === "all" || (item.revokedAt ? status === "revoked" : item.online ? status === "online" : status === "offline")))} rowKey={item => item.id} ariaLabel="组织设备代理" emptyState={query || status !== "all" ? <SectionEmpty title="没有匹配的设备代理" message="调整名称或状态筛选后重试。" actionLabel="清除筛选" onAction={() => { setQuery(""); setStatus("all"); }} /> : <SectionEmpty title="本组织尚无设备代理" message="成员完成本机配对后显示在此。" actionLabel={!readOnly && onNavigate ? "前往节点调试配对" : undefined} onAction={() => onNavigate?.("/node-debugging")} />} columns={[
        { key: "owner", header: "所有者", render: item => <span title={item.ownerUserId}>{item.ownerName ?? item.ownerUserId}</span> },
        { key: "machine", header: "机器", render: item => <div className="max-w-64 break-all"><strong>{item.machineLabel}</strong><p className="text-xs text-muted-foreground">{item.id}</p></div> },
        { key: "version", header: "平台 / 版本", render: item => <span>{item.platform} / {item.arch}<br />{item.clientVersion ?? "版本未知"}</span> },
        { key: "state", header: "状态", render: item => item.revokedAt ? "已撤销" : item.online ? "在线" : "离线" },
        { key: "seen", header: "最后活动", render: item => item.lastSeenAt ? formatAbsolute(item.lastSeenAt) : "尚无活动" },
        { key: "revoked", header: "撤销时间", render: item => item.revokedAt ? formatAbsolute(item.revokedAt) : "—" }
      ]} renderRowActions={readOnly ? undefined : item => item.revokedAt ? null : <Button variant="outline" size="sm" disabled={pending || loading} onClick={() => { setSelected(item); setReason(""); setMutationError(""); }}>撤销配对</Button>} />}
    <ConfirmDialog open={!!selected && !readOnly} title="撤销设备代理配对？" tone="danger" confirmLabel="撤销配对" pending={pending} confirmDisabled={!reason.trim()} error={mutationError}
      description={<>将撤销“{selected?.ownerName ?? selected?.ownerUserId}”的“{selected?.machineLabel}”（{selected?.id}）。该电脑的现有连接和凭据将失效，重新使用需由成员重新配对。</>}
      extra={<label className="grid gap-2">撤销原因<Textarea value={reason} maxLength={500} disabled={pending} onChange={event => setReason(event.target.value)} /></label>}
      onCancel={() => setSelected(null)} onConfirm={() => void revoke()} />
  </section>;
}
