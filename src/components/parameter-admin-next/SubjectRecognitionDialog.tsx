import { useEffect, useRef, useState } from "react";
import type { ParameterCatalogGovernanceRepository } from "@/application/ports/ParameterCatalogGovernanceRepository";
import type { CatalogRegistrationRecognitionResponse } from "@/infrastructure/http/parameterCatalogDtos";
import { presentError } from "@/infrastructure/http/presentError";
import { ModalDialog } from "@/components/common/ModalDialog";
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
  const write = useRef<{ fingerprint: string; key: string } | null>(null);
  useEffect(() => {
    let cancelled = false;
    governance.getRegistrationRecognition(organizationId, registrationId).then(({ item, etag: nextEtag }) => {
      if (cancelled) return;
      setSettings(item); setInitialSettings(item); setEtag(nextEtag ?? ""); setCompatibles(item.compatibles.join("\n")); setNodeTypeName(item.nodeTypeName ?? "");
      if (!nextEtag) setError("无法读取识别规则版本，请关闭后重试。");
    }).catch(reason => { if (!cancelled) setError(presentError(reason, "无法加载识别规则，请重试。")); });
    return () => { cancelled = true; };
  }, [governance, organizationId, registrationId]);
  const isDirty = Boolean(settings && initialSettings && (settings.kind === "driver"
    ? JSON.stringify(compatibles.split(/\r?\n/).map(value => value.trim()).filter(Boolean)) !== JSON.stringify(initialSettings.compatibles)
      || settings.driverNature !== initialSettings.driverNature || settings.instanceCardinality !== initialSettings.instanceCardinality
    : nodeTypeName.trim() !== (initialSettings.nodeTypeName ?? "")));
  const save = async () => {
    if (!settings || !etag) return;
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
  return <ModalDialog open onDismiss={busy ? undefined : onClose} className="submission-dialog param-admin-module-edit-dialog" describedBy>
    {({ titleId, descriptionId }) => <>
      <div className="submission-dialog-head"><div><h2 id={titleId}>识别规则：{name}</h2>
        <p id={descriptionId}>设置当前组织中此主体的识别规则。</p></div></div>
      {error ? <p role="alert">{error}</p> : null}
      {!settings && !error ? <p>正在加载识别规则…</p> : null}
      {settings?.kind === "driver" ? <div className="param-admin-module-edit-body">
        <label>compatible 匹配规则<textarea aria-label="compatible 匹配规则" value={compatibles} rows={3}
          readOnly={!canAdmin || busy} onChange={event => setCompatibles(event.target.value)} /></label>
        <label>驱动性质<SelectControl ariaLabel="驱动性质" value={settings.driverNature ?? "physical-device"} disabled={!canAdmin || busy}
          options={[{ value: "physical-device", label: "物理设备" }, { value: "logical-service", label: "逻辑服务" }]}
          onValueChange={value => setSettings({ ...settings, driverNature: value as Settings["driverNature"] })} /></label>
        <label>实例基数<SelectControl ariaLabel="实例基数" value={settings.instanceCardinality ?? "multiple"} disabled={!canAdmin || busy}
          options={[{ value: "multiple", label: "多个实例" }, { value: "singleton-per-project", label: "每项目单例" }]}
          onValueChange={value => setSettings({ ...settings, instanceCardinality: value as Settings["instanceCardinality"] })} /></label>
      </div> : settings ? <div className="param-admin-module-edit-body"><label>节点类型名<input aria-label="节点类型名"
        value={nodeTypeName} readOnly={!canAdmin || busy} onChange={event => setNodeTypeName(event.target.value)} /></label></div> : null}
      <div className="submission-dialog-actions"><button type="button" className="button subtle" disabled={busy} onClick={onClose}>关闭</button>
        {canAdmin ? <button type="button" className="button primary" disabled={!settings || !etag || !isDirty || busy} onClick={() => void save()}>保存</button> : null}</div>
    </>}
  </ModalDialog>;
}
