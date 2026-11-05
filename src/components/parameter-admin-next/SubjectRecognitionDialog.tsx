import { useEffect, useId, useRef, useState } from "react";
import type { ParameterCatalogGovernanceRepository } from "@/application/ports/ParameterCatalogGovernanceRepository";
import type { CatalogRegistrationRecognitionResponse } from "@/infrastructure/http/parameterCatalogDtos";
import { presentError } from "@/infrastructure/http/presentError";
import { ModalDialog } from "@/components/common/ModalDialog";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { SelectControl } from "@/components/common/SelectControl";
import { createGovernanceIdempotencyKey } from "@/features/parameter-catalog-governance/governanceState";
import type { SubjectEditorOptions } from "@/features/parameter-catalog-governance/RegistrationDialog";

type Settings = CatalogRegistrationRecognitionResponse["item"];

export function SubjectRecognitionDialog({ editor, governance, organizationId, registrationId, catalogReleaseId, name, canAdmin, onClose, onChanged }: {
  editor?: SubjectEditorOptions;
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
  const leaveAction = useRef<(() => void) | null>(null);
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
  const requestLeave = (action: () => void) => {
    if (busy) return;
    if (isDirty) { leaveAction.current = action; setLeaveOpen(true); }
    else action();
  };
  const requestClose = () => requestLeave(onClose);
  const editingDisabled = busy || Boolean(editor?.switching);
  const save = async () => {
    if (!canAdmin || editingDisabled || !isDirty || !settings || !etag) return;
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
  return <><ModalDialog open onDismiss={busy ? undefined : requestClose}
    className={editor ? "submission-dialog confirm-dialog governance-confirm-dialog registration-dialog" : "submission-dialog param-admin-module-edit-dialog"}
    backdropClassName={editor ? "param-admin-modal-backdrop" : undefined} describedBy>
    {({ titleId, descriptionId }) => <>
      {editor ? <div className="grid gap-4"><h2 id={titleId}>{editor.title}</h2>{editor.renderNavigation(requestLeave, busy)}</div>
        : <div className="submission-dialog-head"><h2 id={titleId}>识别规则：{name}</h2></div>}
      <div className={editor ? "confirm-dialog__scroll governance-confirm-dialog__body" : "param-admin-module-edit-body"}
        id={editor ? "subject-editor-panel" : undefined} role={editor ? "tabpanel" : undefined} aria-label={editor ? "识别规则" : undefined}>
      <p id={descriptionId}>规则作用于当前组织中此主体的所有实例。保存后生成组织覆盖规则。</p>
      {error ? <div role="alert"><p>{error}</p>{!settings || !etag ? <button type="button" className="button subtle" onClick={() => setAttempt(current => current + 1)}>重新加载</button> : null}</div> : null}
      {!settings && !error ? <p>正在加载识别规则…</p> : null}
      {settings ? <p className="muted">{settings.overridden ? "当前使用组织覆盖规则" : "当前继承目录规则"}</p> : null}
      {!canAdmin ? <p className="muted">当前账号可查看规则，请联系组织管理员修改。</p> : null}
      {settings?.kind === "driver" ? <>
        <label className="field">compatible 匹配规则<textarea aria-label="compatible 匹配规则" aria-describedby={compatibleHintId} value={compatibles} rows={4}
          readOnly={!canAdmin || editingDisabled || !etag} onChange={event => setCompatibles(event.target.value)} /></label>
        <p id={compatibleHintId} className="muted">每行填写一个 compatible，空行会忽略。修改后按新规则识别当前组织的驱动。</p>
        <label className="field">驱动性质<SelectControl className="w-full" ariaLabel="驱动性质" value={settings.driverNature ?? "physical-device"} disabled={!canAdmin || editingDisabled || !etag}
          options={[{ value: "physical-device", label: "物理设备" }, { value: "logical-service", label: "逻辑服务" }]}
          onValueChange={value => setSettings({ ...settings, driverNature: value as Settings["driverNature"] })} /></label>
        <label className="field">实例基数<SelectControl className="w-full" ariaLabel="实例基数" value={settings.instanceCardinality ?? "multiple"} disabled={!canAdmin || editingDisabled || !etag}
          options={[{ value: "multiple", label: "多个实例" }, { value: "singleton-per-project", label: "每项目单例" }]}
          onValueChange={value => setSettings({ ...settings, instanceCardinality: value as Settings["instanceCardinality"] })} /></label>
      </> : settings ? <label className="field">节点类型名<input aria-label="节点类型名"
        value={nodeTypeName} readOnly={!canAdmin || editingDisabled || !etag} onChange={event => setNodeTypeName(event.target.value)} /></label> : null}
      </div>
      <div className="dialog-actions"><button type="button" className="button subtle" disabled={busy} onClick={requestClose}>关闭</button>
        {canAdmin ? <button type="button" className="button primary" disabled={!settings || !etag || !isDirty || editingDisabled} onClick={() => void save()}>{busy ? "正在保存…" : "保存识别规则"}</button> : null}</div>
    </>}
  </ModalDialog><ConfirmDialog open={leaveOpen} title="放弃未保存的识别规则？" description="关闭后会丢失本次输入的规则。"
    confirmLabel="放弃修改" cancelLabel="继续编辑" onConfirm={() => {
      const action = leaveAction.current; leaveAction.current = null; setLeaveOpen(false); (action ?? onClose)();
    }} onCancel={() => { leaveAction.current = null; setLeaveOpen(false); }} /></>;
}
