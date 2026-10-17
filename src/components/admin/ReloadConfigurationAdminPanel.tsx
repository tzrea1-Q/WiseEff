import { useEffect, useMemo, useState, type ReactNode } from "react";

import type { DtsReloadRepository } from "@/application/ports/DtsReloadRepository";
import type { OrganisationReloadConfiguration, ReloadConfigurationContract } from "@/domain/dtsReload/types";
import { isStreamingKernelLogCommand, KERNEL_LOG_COMMAND_ALLOWLIST } from "@/domain/dtsReload/types";
import { isAllowedKernelLogCommand } from "@wiseeff/device-command-core/kernelLogCommand";
import { DebugAdminSelectControl } from "@/components/admin/DebugAdminSelectControl";
import { Badge } from "@/components/ui/badge";
import { SettingsFormPage, SettingsFormSection, useDirtyState } from "@/components/layout/SettingsFormPage";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { formatAuditAbsoluteTime } from "@/domain/audit/formatAuditTime";
import "./reload-configuration.css";

export type ReloadConfigurationAdminPanelProps = {
  repository: DtsReloadRepository | null;
  canEdit: boolean;
  unavailableReason?: string;
  onNavigate?: (path: string) => void;
  canViewAudit?: boolean;
  users?: readonly { id: string; name: string }[];
};

const EMPTY_CONTRACT: ReloadConfigurationContract = {
  destinationDirectory: "",
  destinationFilename: "",
  triggerNodePath: "",
  triggerPayload: "",
  kernelLogCommand: ""
};

const FIELD_HINTS = {
  destinationDirectory: "设备上存放 Overlay 产物的绝对目录，末尾 / 可省略。",
  destinationFilename: "写入该目录的文件名，通常为 .dtbo。",
  triggerNodePath: "写入后触发内核重载的 debugfs / sysfs 节点。",
  triggerPayload: "向触发节点写入的内容，写入后内核开始重载，常见为 1。",
  kernelLogCommand:
    "从列表选择设备支持的命令。采集后自动按参数和节点名筛选；无需填写管道过滤命令。"
} as const;

const STREAMING_COMMAND_WARNING =
  "该命令为持续输出，每次采集会等待约 10 秒超时后截取已输出内容。如需一次性转储完整内核缓冲区，建议选择 dmesg 或 hilog -x。";

function contractFields(contract: ReloadConfigurationContract): ReloadConfigurationContract {
  return {
    destinationDirectory: contract.destinationDirectory,
    destinationFilename: contract.destinationFilename,
    triggerNodePath: contract.triggerNodePath,
    triggerPayload: contract.triggerPayload,
    kernelLogCommand: contract.kernelLogCommand
  };
}

function PanelShell({
  children,
  title = "DTS 重载配置"
}: {
  children: ReactNode;
  title?: string;
}) {
  return (
    <section className="reload-configuration-panel" aria-label="重载配置">
      <header className="reload-configuration-panel__header">
        <h3>{title}</h3>
      </header>
      {children}
    </section>
  );
}

export function ReloadConfigurationAdminPanel({
  repository,
  canEdit,
  unavailableReason,
  onNavigate,
  canViewAudit = false,
  users = []
}: ReloadConfigurationAdminPanelProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [loadError, setLoadError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [organisationDraft, setOrganisationDraft] = useState<ReloadConfigurationContract>(EMPTY_CONTRACT);
  const [savedContract, setSavedContract] = useState<ReloadConfigurationContract>(EMPTY_CONTRACT);
  const [savedConfiguration, setSavedConfiguration] = useState<OrganisationReloadConfiguration | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [reloadConfirmOpen, setReloadConfirmOpen] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof ReloadConfigurationContract, string>>>({});

  useEffect(() => {
    if (!repository || !canEdit) {
      setOrganisationDraft(EMPTY_CONTRACT);
      setSavedContract(EMPTY_CONTRACT);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setSavedConfiguration(null);
    setOrganisationDraft(EMPTY_CONTRACT);
    setSavedContract(EMPTY_CONTRACT);
    setConflict(false);
    setFieldErrors({});
    setErrorMessage("");
    setLoadError("");
    void repository
      .getReloadConfiguration()
      .then((view) => {
        if (cancelled) return;
        const next = contractFields(view.organisation);
        setOrganisationDraft(next);
        setSavedContract(next);
        setSavedConfiguration(view.organisation);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoadError(error instanceof Error ? error.message : "无法加载重载配置。");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [repository, canEdit, loadAttempt]);

  const updateOrganisationField = <K extends keyof ReloadConfigurationContract>(key: K, value: string) => {
    setStatusMessage("");
    setErrorMessage("");
    setFieldErrors((current) => ({ ...current, [key]: undefined }));
    setOrganisationDraft((current) => ({ ...current, [key]: value }));
  };

  const kernelLogOptions = useMemo(() => {
    const allowlist = [...KERNEL_LOG_COMMAND_ALLOWLIST];
    if (
      organisationDraft.kernelLogCommand &&
      !allowlist.includes(organisationDraft.kernelLogCommand as (typeof allowlist)[number])
    ) {
      allowlist.unshift(organisationDraft.kernelLogCommand as (typeof allowlist)[number]);
    }
    return allowlist.map((command) => ({ value: command, label: command }));
  }, [organisationDraft.kernelLogCommand]);

  const isDirty = useDirtyState(organisationDraft, savedContract);
  const fieldsDisabled = !canEdit || saving || loading || !savedConfiguration || Boolean(loadError);
  const updatedByName = users.find((user) => user.id === savedConfiguration?.updatedByUserId)?.name;
  const reloadConfiguration = () => {
    if (isDirty) setReloadConfirmOpen(true);
    else setLoadAttempt((attempt) => attempt + 1);
  };

  const saveOrganisation = async () => {
    if (!repository || fieldsDisabled || conflict || !isDirty || !savedConfiguration) return;
    const errors: Partial<Record<keyof ReloadConfigurationContract, string>> = {};
    for (const key of ["destinationDirectory", "triggerNodePath"] as const) {
      const path = organisationDraft[key].trim();
      if (!path.startsWith("/") || path.includes("\0") || path.split("/").some((segment) => segment === "." || segment === "..")) {
        errors[key] = "请输入不含 . 或 .. 路径段的绝对路径。";
      }
    }
    const filename = organisationDraft.destinationFilename.trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(filename) || filename.includes("..")) errors.destinationFilename = "请输入单个文件名，不含路径分隔符或 ..。";
    const payload = organisationDraft.triggerPayload.trim();
    if (!payload || payload.length > 256) errors.triggerPayload = "触发写入值不能为空，且不能超过 256 个字符。";
    if (!isAllowedKernelLogCommand(organisationDraft.kernelLogCommand.trim())) errors.kernelLogCommand = "请选择允许的内核日志命令。";
    setFieldErrors(errors);
    if (Object.keys(errors).length) { setErrorMessage("请修正标记的字段后重试。"); return; }
    setSaving(true);
    setErrorMessage("");
    setStatusMessage("");
    try {
      const saved = await repository.updateOrganisationReloadConfiguration(organisationDraft, savedConfiguration.updatedAt);
      const next = contractFields(saved);
      setOrganisationDraft(next);
      setSavedContract(next);
      setSavedConfiguration(saved);
      setStatusMessage("组织默认重载配置已保存");
    } catch (error: unknown) {
      if (error && typeof error === "object" && "code" in error && error.code === "CONFLICT") setConflict(true);
      setErrorMessage(error instanceof Error ? error.message : "保存组织默认配置失败。");
    } finally {
      setSaving(false);
    }
  };

  if (!repository) {
    return (
      <PanelShell>
        <p className="reload-configuration-muted">{unavailableReason ?? "重载配置仅在 API 模式下可用。"}</p>
      </PanelShell>
    );
  }

  if (!canEdit) {
    return (
      <PanelShell>
        <p className="debug-admin-error" role="alert">
          缺少 debugging:admin 权限，无法读取或修改重载配置。
        </p>
      </PanelShell>
    );
  }

  return (
    <section className="reload-configuration-panel" aria-label="重载配置">
      <SettingsFormPage label="DTS 重载设置" dirty={isDirty && !loading} saving={saving} saveDisabled={fieldsDisabled || conflict} error={errorMessage}
        onSave={() => void saveOrganisation()} onDiscard={() => {
          setOrganisationDraft(savedContract); setFieldErrors({}); setErrorMessage(""); setStatusMessage("");
        }}>
      <SettingsFormSection title="DTS 重载配置" help="设置本组织设备的产物位置、触发方式和日志采集。保存不会立即操作设备；后续确认部署时使用当时已保存的配置。">
        {loadError ? <div className="reload-configuration-load-error" role="alert"><p>无法读取当前配置：{loadError}</p><button type="button" className="button subtle" onClick={reloadConfiguration}>重新加载配置</button></div> : null}
        {conflict ? <div className="reload-configuration-load-error" role="alert"><p>其他管理员已更新配置。当前修改已保留，请重新加载并核对后再编辑。</p><button type="button" className="button subtle" onClick={reloadConfiguration}>重新加载配置</button></div> : null}
        <div className="reload-configuration-panel__section-head">
          <div className="reload-configuration-panel__section-title">
            <h3>组织默认值</h3>
            {savedConfiguration ? <Badge variant={savedConfiguration.source === "seeded-default" ? "secondary" : "outline"}>
              {savedConfiguration.source === "seeded-default" ? "系统默认" : "已保存"}
            </Badge> : null}
          </div>
          {loading ? <p className="reload-configuration-muted">正在加载…</p> : null}
          {canViewAudit && onNavigate ? <button type="button" className="button subtle" onClick={() => onNavigate("/audit?app=debugging&kind=dts-reload-configuration-update")}>查看配置变更记录</button> : null}
        </div>
        {savedConfiguration ? <p className="reload-configuration-metadata">{savedConfiguration.updatedAt ? <>最近更新：<time dateTime={savedConfiguration.updatedAt}>{formatAuditAbsoluteTime(savedConfiguration.updatedAt)}</time> · 修改人：{updatedByName ?? (savedConfiguration.updatedByUserId ? "账户信息暂不可用" : "已删除账户")}{savedConfiguration.updatedByUserId ? <span>（账户 {savedConfiguration.updatedByUserId}）</span> : null}</> : "尚未保存组织配置，当前使用系统默认值。"}</p> : null}

        <div className="reload-configuration-form">
          <fieldset className="reload-configuration-group"><legend>产物位置</legend><div className="reload-configuration-group__fields">
          <div className="reload-configuration-form__field">
            <Label htmlFor="reload-org-destination-directory">Overlay 目标目录</Label>
            <Input
              id="reload-org-destination-directory"
              aria-label="组织 Overlay 目标目录"
              className="reload-configuration-form__control mono"
              value={organisationDraft.destinationDirectory}
              aria-invalid={fieldErrors.destinationDirectory ? true : undefined}
              aria-describedby={`reload-hint-destinationDirectory${fieldErrors.destinationDirectory ? " reload-error-destinationDirectory" : ""}`}
              disabled={fieldsDisabled}
              placeholder="/vendor/firmware/"
              spellCheck={false}
              autoComplete="off"
              onChange={(event) => updateOrganisationField("destinationDirectory", event.target.value)}
            />
            <p id="reload-hint-destinationDirectory" className="reload-configuration-form__hint">{FIELD_HINTS.destinationDirectory}</p>
            {fieldErrors.destinationDirectory ? <p id="reload-error-destinationDirectory" className="settings-form-page__error">{fieldErrors.destinationDirectory}</p> : null}
          </div>

          <div className="reload-configuration-form__field">
            <Label htmlFor="reload-org-destination-filename">Overlay 目标文件名</Label>
            <Input
              id="reload-org-destination-filename"
              aria-label="组织 Overlay 目标文件名"
              className="reload-configuration-form__control mono"
              value={organisationDraft.destinationFilename}
              aria-invalid={fieldErrors.destinationFilename ? true : undefined}
              aria-describedby={`reload-hint-destinationFilename${fieldErrors.destinationFilename ? " reload-error-destinationFilename" : ""}`}
              disabled={fieldsDisabled}
              placeholder="power_dts_overlay.dtbo"
              spellCheck={false}
              autoComplete="off"
              onChange={(event) => updateOrganisationField("destinationFilename", event.target.value)}
            />
            <p id="reload-hint-destinationFilename" className="reload-configuration-form__hint">{FIELD_HINTS.destinationFilename}</p>
            {fieldErrors.destinationFilename ? <p id="reload-error-destinationFilename" className="settings-form-page__error">{fieldErrors.destinationFilename}</p> : null}
          </div>

          </div></fieldset>
          <fieldset className="reload-configuration-group"><legend>触发重载</legend><div className="reload-configuration-group__fields">
          <div className="reload-configuration-form__field">
            <Label htmlFor="reload-org-trigger-node-path">触发节点路径</Label>
            <Input
              id="reload-org-trigger-node-path"
              aria-label="组织触发节点路径"
              className="reload-configuration-form__control mono"
              value={organisationDraft.triggerNodePath}
              aria-invalid={fieldErrors.triggerNodePath ? true : undefined}
              aria-describedby={`reload-hint-triggerNodePath${fieldErrors.triggerNodePath ? " reload-error-triggerNodePath" : ""}`}
              disabled={fieldsDisabled}
              placeholder="/sys/kernel/debug/.../trigger"
              spellCheck={false}
              autoComplete="off"
              onChange={(event) => updateOrganisationField("triggerNodePath", event.target.value)}
            />
            <p id="reload-hint-triggerNodePath" className="reload-configuration-form__hint">{FIELD_HINTS.triggerNodePath}</p>
            {fieldErrors.triggerNodePath ? <p id="reload-error-triggerNodePath" className="settings-form-page__error">{fieldErrors.triggerNodePath}</p> : null}
          </div>

          <div className="reload-configuration-form__field">
            <Label htmlFor="reload-org-trigger-payload">触发写入值</Label>
            <Input
              id="reload-org-trigger-payload"
              aria-label="组织触发写入值"
              className="reload-configuration-form__control mono"
              value={organisationDraft.triggerPayload}
              aria-invalid={fieldErrors.triggerPayload ? true : undefined}
              aria-describedby={`reload-hint-triggerPayload${fieldErrors.triggerPayload ? " reload-error-triggerPayload" : ""}`}
              disabled={fieldsDisabled}
              placeholder="1"
              spellCheck={false}
              autoComplete="off"
              onChange={(event) => updateOrganisationField("triggerPayload", event.target.value)}
            />
            <p id="reload-hint-triggerPayload" className="reload-configuration-form__hint">{FIELD_HINTS.triggerPayload}</p>
            {fieldErrors.triggerPayload ? <p id="reload-error-triggerPayload" className="settings-form-page__error">{fieldErrors.triggerPayload}</p> : null}
          </div>

          </div></fieldset>
          <fieldset className="reload-configuration-group"><legend>日志采集</legend><div className="reload-configuration-group__fields reload-configuration-group__fields--single">
          <div className="reload-configuration-form__field">
            <Label htmlFor="reload-org-kernel-log-command">内核日志命令</Label>
            <DebugAdminSelectControl
              id="reload-org-kernel-log-command"
              value={organisationDraft.kernelLogCommand}
              onValueChange={(value) => updateOrganisationField("kernelLogCommand", value)}
              options={kernelLogOptions}
              ariaLabel="组织内核日志命令"
              ariaInvalid={fieldErrors.kernelLogCommand ? true : undefined}
              ariaDescribedBy={`reload-hint-kernelLogCommand${fieldErrors.kernelLogCommand ? " reload-error-kernelLogCommand" : ""}${isStreamingKernelLogCommand(organisationDraft.kernelLogCommand) ? " reload-streaming-warning" : ""}`}
              disabled={fieldsDisabled}
            />
            <p id="reload-hint-kernelLogCommand" className="reload-configuration-form__hint">{FIELD_HINTS.kernelLogCommand}</p>
            {fieldErrors.kernelLogCommand ? <p id="reload-error-kernelLogCommand" className="settings-form-page__error">{fieldErrors.kernelLogCommand}</p> : null}
            {isStreamingKernelLogCommand(organisationDraft.kernelLogCommand) ? (
              <p id="reload-streaming-warning" className="reload-configuration-form__hint" role="note">
                {STREAMING_COMMAND_WARNING}
              </p>
            ) : null}
          </div>
          </div></fieldset>
          {savedConfiguration ? <section className="reload-configuration-preview" aria-label="最终配置摘要"><h3>{isDirty ? "保存后的配置预览" : "当前配置摘要"}</h3><dl>
            <div><dt>Overlay 完整路径</dt><dd><code>{organisationDraft.destinationDirectory.trim().replace(/\/+$/, "")}/{organisationDraft.destinationFilename.trim()}</code></dd></div>
            <div><dt>触发写入</dt><dd>向 <code>{organisationDraft.triggerNodePath.trim() || "未填写"}</code> 写入 <code>{organisationDraft.triggerPayload.trim() || "未填写"}</code></dd></div>
            <div><dt>日志命令</dt><dd><code>{organisationDraft.kernelLogCommand || "未选择"}</code></dd></div>
          </dl><p>适用于本组织的后续设备部署。路径和命令还需与目标设备实际环境一致；预览不会执行设备操作。</p></section> : null}
        </div>

        {statusMessage ? <p className="reload-configuration-status" role="status">{statusMessage}</p> : null}
      </SettingsFormSection>
      </SettingsFormPage>
      <ConfirmDialog open={reloadConfirmOpen} title="重新加载并放弃当前修改？" description="重新读取服务器上的最新配置，本页尚未保存的输入将被替换。" confirmLabel="放弃并重新加载" cancelLabel="保留当前修改" tone="danger" onCancel={() => setReloadConfirmOpen(false)} onConfirm={() => { setReloadConfirmOpen(false); setLoadAttempt((attempt) => attempt + 1); }} />
    </section>
  );
}
