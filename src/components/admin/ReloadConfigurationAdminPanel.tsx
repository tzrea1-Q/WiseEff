import { useEffect, useMemo, useState, type ReactNode } from "react";

import type { DtsReloadRepository } from "@/application/ports/DtsReloadRepository";
import type { ReloadConfigurationContract } from "@/domain/dtsReload/types";
import { isStreamingKernelLogCommand, KERNEL_LOG_COMMAND_ALLOWLIST } from "@/domain/dtsReload/types";
import { DebugAdminSelectControl } from "@/components/admin/DebugAdminSelectControl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type ReloadConfigurationAdminPanelProps = {
  repository: DtsReloadRepository | null;
  canEdit: boolean;
  unavailableReason?: string;
};

const EMPTY_CONTRACT: ReloadConfigurationContract = {
  destinationDirectory: "",
  destinationFilename: "",
  triggerNodePath: "",
  triggerPayload: "",
  kernelLogCommand: ""
};

const FIELD_HINTS = {
  destinationDirectory: "设备上放置 overlay 产物的目录，须以 / 结尾。",
  destinationFilename: "写入该目录的文件名，通常为 .dtbo。",
  triggerNodePath: "写入后触发内核重载的 debugfs / sysfs 节点。",
  triggerPayload: "向触发节点写入的内容，写入后内核开始重载，常见为 1。",
  kernelLogCommand:
    "仅允许列表中的精确命令；桥接侧会再次校验。设备侧不支持管道过滤（如 | grep）——采集后由平台按参数名与节点名自动筛选匹配行。"
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

function contractsEqual(left: ReloadConfigurationContract, right: ReloadConfigurationContract): boolean {
  return (
    left.destinationDirectory === right.destinationDirectory &&
    left.destinationFilename === right.destinationFilename &&
    left.triggerNodePath === right.triggerNodePath &&
    left.triggerPayload === right.triggerPayload &&
    left.kernelLogCommand === right.kernelLogCommand
  );
}

function PanelShell({
  children,
  title = "DTS 重载配置"
}: {
  children: ReactNode;
  title?: string;
}) {
  return (
    <section className="param-admin-panel reload-configuration-panel" aria-label="重载配置">
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
  unavailableReason
}: ReloadConfigurationAdminPanelProps) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [organisationDraft, setOrganisationDraft] = useState<ReloadConfigurationContract>(EMPTY_CONTRACT);
  const [savedContract, setSavedContract] = useState<ReloadConfigurationContract>(EMPTY_CONTRACT);
  const [organisationSource, setOrganisationSource] = useState<"seeded-default" | "organisation">("seeded-default");

  useEffect(() => {
    if (!repository || !canEdit) {
      setOrganisationDraft(EMPTY_CONTRACT);
      setSavedContract(EMPTY_CONTRACT);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setErrorMessage("");
    void repository
      .getReloadConfiguration()
      .then((view) => {
        if (cancelled) return;
        const next = contractFields(view.organisation);
        setOrganisationDraft(next);
        setSavedContract(next);
        setOrganisationSource(view.organisation.source);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setErrorMessage(error instanceof Error ? error.message : "无法加载重载配置。");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [repository, canEdit]);

  const updateOrganisationField = <K extends keyof ReloadConfigurationContract>(key: K, value: string) => {
    setStatusMessage("");
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

  const isDirty = !contractsEqual(organisationDraft, savedContract);
  const fieldsDisabled = !canEdit || saving || loading;

  const saveOrganisation = async () => {
    if (!repository || !canEdit || !isDirty) return;
    setSaving(true);
    setErrorMessage("");
    setStatusMessage("");
    try {
      const saved = await repository.updateOrganisationReloadConfiguration(organisationDraft);
      const next = contractFields(saved);
      setOrganisationDraft(next);
      setSavedContract(next);
      setOrganisationSource(saved.source);
      setStatusMessage("组织默认重载配置已保存");
    } catch (error: unknown) {
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
    <PanelShell>
      <p className="reload-configuration-muted">
        组织级设备侧合约。运行时由服务端从已存储记录解析，浏览器请求体不能覆盖有效值。内核日志命令须与允许列表完全一致。
      </p>

      <div className="param-admin-panel__section reload-configuration-panel__contract">
        <div className="reload-configuration-panel__section-head">
          <div className="reload-configuration-panel__section-title">
            <h3>组织默认值</h3>
            <Badge variant={organisationSource === "seeded-default" ? "secondary" : "outline"}>
              {organisationSource === "seeded-default" ? "种子默认" : "已保存"}
            </Badge>
          </div>
          {loading ? <p className="reload-configuration-muted">正在加载…</p> : null}
        </div>

        {errorMessage ? (
          <p className="debug-admin-error" role="alert">
            {errorMessage}
          </p>
        ) : null}

        <div className="reload-configuration-form">
          <div className="reload-configuration-form__field">
            <Label htmlFor="reload-org-destination-directory">Overlay 目标目录</Label>
            <Input
              id="reload-org-destination-directory"
              aria-label="组织 Overlay 目标目录"
              className="reload-configuration-form__control mono"
              value={organisationDraft.destinationDirectory}
              disabled={fieldsDisabled}
              placeholder="/vendor/firmware/"
              spellCheck={false}
              autoComplete="off"
              onChange={(event) => updateOrganisationField("destinationDirectory", event.target.value)}
            />
            <p className="reload-configuration-form__hint">{FIELD_HINTS.destinationDirectory}</p>
          </div>

          <div className="reload-configuration-form__field">
            <Label htmlFor="reload-org-destination-filename">Overlay 目标文件名</Label>
            <Input
              id="reload-org-destination-filename"
              aria-label="组织 Overlay 目标文件名"
              className="reload-configuration-form__control mono"
              value={organisationDraft.destinationFilename}
              disabled={fieldsDisabled}
              placeholder="power_dts_overlay.dtbo"
              spellCheck={false}
              autoComplete="off"
              onChange={(event) => updateOrganisationField("destinationFilename", event.target.value)}
            />
            <p className="reload-configuration-form__hint">{FIELD_HINTS.destinationFilename}</p>
          </div>

          <div className="reload-configuration-form__field reload-configuration-form__field--wide">
            <Label htmlFor="reload-org-trigger-node-path">触发节点路径</Label>
            <Input
              id="reload-org-trigger-node-path"
              aria-label="组织触发节点路径"
              className="reload-configuration-form__control mono"
              value={organisationDraft.triggerNodePath}
              disabled={fieldsDisabled}
              placeholder="/sys/kernel/debug/.../trigger"
              spellCheck={false}
              autoComplete="off"
              onChange={(event) => updateOrganisationField("triggerNodePath", event.target.value)}
            />
            <p className="reload-configuration-form__hint">{FIELD_HINTS.triggerNodePath}</p>
          </div>

          <div className="reload-configuration-form__field">
            <Label htmlFor="reload-org-trigger-payload">触发写入值</Label>
            <Input
              id="reload-org-trigger-payload"
              aria-label="组织触发写入值"
              className="reload-configuration-form__control mono"
              value={organisationDraft.triggerPayload}
              disabled={fieldsDisabled}
              placeholder="1"
              spellCheck={false}
              autoComplete="off"
              onChange={(event) => updateOrganisationField("triggerPayload", event.target.value)}
            />
            <p className="reload-configuration-form__hint">{FIELD_HINTS.triggerPayload}</p>
          </div>

          <div className="reload-configuration-form__field">
            <Label>内核日志命令</Label>
            <DebugAdminSelectControl
              value={organisationDraft.kernelLogCommand}
              onValueChange={(value) => updateOrganisationField("kernelLogCommand", value)}
              options={kernelLogOptions}
              ariaLabel="组织内核日志命令"
              disabled={fieldsDisabled}
            />
            <p className="reload-configuration-form__hint">{FIELD_HINTS.kernelLogCommand}</p>
            {isStreamingKernelLogCommand(organisationDraft.kernelLogCommand) ? (
              <p className="reload-configuration-form__hint text-amber-900" role="note">
                {STREAMING_COMMAND_WARNING}
              </p>
            ) : null}
          </div>
        </div>

        <div className="reload-configuration-actions">
          {statusMessage ? <p className="reload-configuration-status">{statusMessage}</p> : null}
          {!statusMessage && isDirty ? (
            <p className="reload-configuration-muted">有未保存的更改</p>
          ) : null}
          <Button
            type="button"
            size="lg"
            className="reload-configuration-actions__save"
            disabled={fieldsDisabled || !isDirty}
            onClick={() => void saveOrganisation()}
          >
            {saving ? "保存中…" : "保存组织默认值"}
          </Button>
        </div>
      </div>
    </PanelShell>
  );
}
