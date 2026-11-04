import { useEffect, useId, useRef, useState } from "react";
import type { ParameterCatalogGovernanceRepository } from "@/application/ports/ParameterCatalogGovernanceRepository";
import type { CatalogRegistrationRecognitionResponse } from "@/infrastructure/http/parameterCatalogDtos";
import { presentError } from "@/infrastructure/http/presentError";
import { ModalDialog } from "@/components/common/ModalDialog";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { SelectControl } from "@/components/common/SelectControl";
import { createGovernanceIdempotencyKey } from "@/features/parameter-catalog-governance/governanceState";

type Settings = CatalogRegistrationRecognitionResponse["item"];

export function SubjectRecognitionDialog({ governance, organizationId, registrationId, catalogReleaseId, name, canAdmin, onClose, onChanged }: {
  governance: ParameterCatalogGovernanceRepository; organizationId: string; registrationId: string; name: string;
  catalogReleaseId: string; canAdmin: boolean; onClose: () => void; onChanged?: () => void | Promise<void>;
}) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [compatibles, setCompatibles] = useState("");
  const [nodeTypeName, setNodeTypeName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [etag, setEtag] = useState("");
  const [initialSettings, setInitialSettings] = useState<Settings | null>(null);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const compatibleHintId = useId();
  const write = useRef<{ fingerprint: string; key: string } | null>(null);
  useEffect(() => {
    let cancelled = false;
    setSettings(null); setInitialSettings(null); setEtag(""); setError("");
    write.current = null;
    governance.getRegistrationRecognition(organizationId, registrationId).then(({ item, etag: nextEtag }) => {
      if (cancelled) return;
      setSettings(item); setInitialSettings(item); setEtag(nextEtag ?? ""); setCompatibles(item.compatibles.join("\n")); setNodeTypeName(item.nodeTypeName ?? "");
      if (!nextEtag) setError("无法读取识别规则版本，请重新加载后编辑。");
    }).catch(reason => { if (!cancelled) setError(presentError(reason, "无法加载识别规则，请重试。")); });
    return () => { cancelled = true; };
  }, [governance, organizationId, registrationId, attempt]);
  const isDirty = Boolean(settings && initialSettings && (settings.kind === "driver"
    ? JSON.stringify(compatibles.split(/\r?\n/).map(value => value.trim()).filter(Boolean)) !== JSON.stringify(initialSettings.compatibles)
      || settings.driverNature !== initialSettings.driverNature || settings.instanceCardinality !== initialSettings.instanceCardinality
    : nodeTypeName.trim() !== (initialSettings.nodeTypeName ?? "")));
  const requestClose = () => {
    if (busy) return;
    if (isDirty) setLeaveOpen(true);
    else onClose();
  };
  const save = async () => {
    if (!canAdmin || busy || !isDirty || !settings || !etag) return;
    setBusy(true); setError("");
    try {
      const body = settings.kind === "driver" ? {
        compatibles: compatibles.split(/\r?\n/).map(value => value.trim()).filter(Boolean),
        driverNature: settings.driverNature ?? "physical-device", instanceCardinality: settings.instanceCardinality ?? "multiple",
      } : { nodeTypeName: nodeTypeName.trim() };
      const fingerprint = JSON.stringify(body);
      if (write.current?.fingerprint !== fingerprint) write.current = { fingerprint, key: createGovernanceIdempotencyKey() };
      await governance.updateRegistrationRecognition(organizationId, registrationId, body,
        { catalogReleaseId, ifMatch: etag, idempotencyKey: write.current.key });
      await onChanged?.();
      onClose();
    } catch (reason) { setError(presentError(reason, "保存识别规则失败，请重试。")); }
    finally { setBusy(false); }
  };
  return <><ModalDialog open onDismiss={busy ? undefined : requestClose} className="submission-dialog param-admin-module-edit-dialog" describedBy>
    {({ titleId, descriptionId }) => <>
      <div className="submission-dialog-head"><div><h2 id={titleId}>识别规则：{name}</h2>
        <p id={descriptionId}>规则作用于当前组织中此主体的所有实例。保存后生成组织覆盖规则。</p></div></div>
      <div className="param-admin-module-edit-body">
      {error ? <div role="alert"><p>{error}</p>{!settings || !etag ? <button type="button" className="button subtle" onClick={() => setAttempt(current => current + 1)}>重新加载</button> : null}</div> : null}
      {!settings && !error ? <p>正在加载识别规则…</p> : null}
      {settings ? <p className="muted">{settings.overridden ? "当前使用组织覆盖规则" : "当前继承目录规则"}</p> : null}
      {!canAdmin ? <p className="muted">当前账号可查看规则，请联系组织管理员修改。</p> : null}
      {settings?.kind === "driver" ? <>
        <label className="field">compatible 匹配规则<textarea aria-label="compatible 匹配规则" aria-describedby={compatibleHintId} value={compatibles} rows={4}
          readOnly={!canAdmin || busy || !etag} onChange={event => setCompatibles(event.target.value)} /></label>
        <p id={compatibleHintId} className="muted">每行填写一个 compatible，空行会忽略。修改后按新规则识别当前组织的驱动。</p>
        <label className="field">驱动性质<SelectControl className="w-full" ariaLabel="驱动性质" value={settings.driverNature ?? "physical-device"} disabled={!canAdmin || busy || !etag}
          options={[{ value: "physical-device", label: "物理设备" }, { value: "logical-service", label: "逻辑服务" }]}
          onValueChange={value => setSettings({ ...settings, driverNature: value as Settings["driverNature"] })} /></label>
        <label className="field">实例基数<SelectControl className="w-full" ariaLabel="实例基数" value={settings.instanceCardinality ?? "multiple"} disabled={!canAdmin || busy || !etag}
          options={[{ value: "multiple", label: "多个实例" }, { value: "singleton-per-project", label: "每项目单例" }]}
          onValueChange={value => setSettings({ ...settings, instanceCardinality: value as Settings["instanceCardinality"] })} /></label>
      </> : settings ? <label className="field">节点类型名<input aria-label="节点类型名"
        value={nodeTypeName} readOnly={!canAdmin || busy || !etag} onChange={event => setNodeTypeName(event.target.value)} /></label> : null}
      </div>
      <div className="submission-dialog-actions"><button type="button" className="button subtle" disabled={busy} onClick={requestClose}>关闭</button>
        {canAdmin ? <button type="button" className="button primary" disabled={!settings || !etag || !isDirty || busy} onClick={() => void save()}>{busy ? "正在保存…" : "保存"}</button> : null}</div>
    </>}
  </ModalDialog><ConfirmDialog open={leaveOpen} title="放弃未保存的识别规则？" description="关闭后会丢失本次输入的规则。"
    confirmLabel="放弃修改" cancelLabel="继续编辑" onConfirm={onClose} onCancel={() => setLeaveOpen(false)} /></>;
}
