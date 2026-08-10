import { useEffect, useMemo, useState } from "react";

import type { DtsReloadRepository } from "@/application/ports/DtsReloadRepository";
import type { ReloadConfigurationContract } from "@/domain/dtsReload/types";
import { KERNEL_LOG_COMMAND_ALLOWLIST } from "@/domain/dtsReload/types";
import { Button } from "@/components/ui/button";

export type ReloadConfigurationDeviceOption = {
  id: string;
  name: string;
};

export type ReloadConfigurationAdminPanelProps = {
  repository: DtsReloadRepository | null;
  devices: readonly ReloadConfigurationDeviceOption[];
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

function contractFields(contract: ReloadConfigurationContract): ReloadConfigurationContract {
  return {
    destinationDirectory: contract.destinationDirectory,
    destinationFilename: contract.destinationFilename,
    triggerNodePath: contract.triggerNodePath,
    triggerPayload: contract.triggerPayload,
    kernelLogCommand: contract.kernelLogCommand
  };
}

export function ReloadConfigurationAdminPanel({
  repository,
  devices,
  canEdit,
  unavailableReason
}: ReloadConfigurationAdminPanelProps) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [organisationDraft, setOrganisationDraft] = useState<ReloadConfigurationContract>(EMPTY_CONTRACT);
  const [organisationSource, setOrganisationSource] = useState<"seeded-default" | "organisation">("seeded-default");
  const [overrides, setOverrides] = useState<
    Array<ReloadConfigurationContract & { deviceId: string; deviceName: string | null }>
  >([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const [deviceDraft, setDeviceDraft] = useState<ReloadConfigurationContract>(EMPTY_CONTRACT);

  const selectedOverride = useMemo(
    () => overrides.find((item) => item.deviceId === selectedDeviceId) ?? null,
    [overrides, selectedDeviceId]
  );

  useEffect(() => {
    if (!repository || !canEdit) {
      setOrganisationDraft(EMPTY_CONTRACT);
      setOverrides([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setErrorMessage("");
    void repository
      .getReloadConfiguration()
      .then((view) => {
        if (cancelled) return;
        setOrganisationDraft(contractFields(view.organisation));
        setOrganisationSource(view.organisation.source);
        setOverrides(view.deviceOverrides.map((item) => ({ ...contractFields(item), deviceId: item.deviceId, deviceName: item.deviceName })));
        if (!selectedDeviceId && view.deviceOverrides[0]) {
          setSelectedDeviceId(view.deviceOverrides[0].deviceId);
          setDeviceDraft(contractFields(view.deviceOverrides[0]));
        }
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
    // selectedDeviceId intentionally omitted — initial hydrate only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repository, canEdit]);

  useEffect(() => {
    if (selectedOverride) {
      setDeviceDraft(contractFields(selectedOverride));
      return;
    }
    setDeviceDraft(contractFields(organisationDraft));
  }, [organisationDraft, selectedOverride]);

  const updateOrganisationField = <K extends keyof ReloadConfigurationContract>(key: K, value: string) => {
    setOrganisationDraft((current) => ({ ...current, [key]: value }));
  };

  const updateDeviceField = <K extends keyof ReloadConfigurationContract>(key: K, value: string) => {
    setDeviceDraft((current) => ({ ...current, [key]: value }));
  };

  const saveOrganisation = async () => {
    if (!repository || !canEdit) return;
    setSaving(true);
    setErrorMessage("");
    setStatusMessage("");
    try {
      const saved = await repository.updateOrganisationReloadConfiguration(organisationDraft);
      setOrganisationDraft(contractFields(saved));
      setOrganisationSource(saved.source);
      setStatusMessage("组织默认重载配置已保存");
    } catch (error: unknown) {
      setErrorMessage(error instanceof Error ? error.message : "保存组织默认配置失败。");
    } finally {
      setSaving(false);
    }
  };

  const saveDeviceOverride = async () => {
    if (!repository || !canEdit || !selectedDeviceId) return;
    setSaving(true);
    setErrorMessage("");
    setStatusMessage("");
    try {
      const saved = await repository.upsertDeviceReloadConfiguration(selectedDeviceId, deviceDraft);
      setOverrides((current) => {
        const next = current.filter((item) => item.deviceId !== selectedDeviceId);
        return [
          ...next,
          {
            ...contractFields(saved),
            deviceId: saved.deviceId,
            deviceName: saved.deviceName
          }
        ];
      });
      setDeviceDraft(contractFields(saved));
      setStatusMessage("设备覆盖已保存");
    } catch (error: unknown) {
      setErrorMessage(error instanceof Error ? error.message : "保存设备覆盖失败。");
    } finally {
      setSaving(false);
    }
  };

  const removeDeviceOverride = async () => {
    if (!repository || !canEdit || !selectedDeviceId || !selectedOverride) return;
    setSaving(true);
    setErrorMessage("");
    setStatusMessage("");
    try {
      await repository.deleteDeviceReloadConfiguration(selectedDeviceId);
      setOverrides((current) => current.filter((item) => item.deviceId !== selectedDeviceId));
      setStatusMessage("设备覆盖已删除");
    } catch (error: unknown) {
      setErrorMessage(error instanceof Error ? error.message : "删除设备覆盖失败。");
    } finally {
      setSaving(false);
    }
  };

  if (!repository) {
    return (
      <section className="param-admin-panel reload-configuration-panel" aria-label="重载配置">
        <div className="param-admin-panel__section">
          <h3>DTS 重载配置</h3>
          <p className="reload-configuration-muted">{unavailableReason ?? "重载配置仅在 API 模式下可用。"}</p>
        </div>
      </section>
    );
  }

  if (!canEdit) {
    return (
      <section className="param-admin-panel reload-configuration-panel" aria-label="重载配置">
        <div className="param-admin-panel__section">
          <h3>DTS 重载配置</h3>
          <p className="debug-admin-error" role="alert">
            缺少 debugging:admin 权限，无法读取或修改重载配置。
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="param-admin-panel reload-configuration-panel" aria-label="重载配置">
      <div className="param-admin-panel__section">
        <h3>DTS 重载配置</h3>
        <p className="reload-configuration-muted">
          组织默认值与可选的设备覆盖。运行时始终由服务端从已存储记录解析；浏览器请求体不能影响有效合约。
          内核日志命令须与允许列表完全一致：{KERNEL_LOG_COMMAND_ALLOWLIST.join("、")}。
        </p>
        {loading ? <p className="reload-configuration-muted">正在加载…</p> : null}
        {errorMessage ? (
          <p className="debug-admin-error" role="alert">
            {errorMessage}
          </p>
        ) : null}
        {statusMessage ? <p className="reload-configuration-muted">{statusMessage}</p> : null}
      </div>

      <div className="param-admin-panel__section">
        <h3>组织默认值{organisationSource === "seeded-default" ? "（种子默认）" : ""}</h3>
        <div className="config-form-grid reload-configuration-form">
          <label>
            <span>Overlay 目标目录</span>
            <input
              aria-label="组织 Overlay 目标目录"
              value={organisationDraft.destinationDirectory}
              disabled={!canEdit || saving}
              onChange={(event) => updateOrganisationField("destinationDirectory", event.target.value)}
            />
          </label>
          <label>
            <span>Overlay 目标文件名</span>
            <input
              aria-label="组织 Overlay 目标文件名"
              value={organisationDraft.destinationFilename}
              disabled={!canEdit || saving}
              onChange={(event) => updateOrganisationField("destinationFilename", event.target.value)}
            />
          </label>
          <label className="wide">
            <span>触发节点路径</span>
            <input
              aria-label="组织触发节点路径"
              value={organisationDraft.triggerNodePath}
              disabled={!canEdit || saving}
              onChange={(event) => updateOrganisationField("triggerNodePath", event.target.value)}
            />
          </label>
          <label>
            <span>触发载荷</span>
            <input
              aria-label="组织触发载荷"
              value={organisationDraft.triggerPayload}
              disabled={!canEdit || saving}
              onChange={(event) => updateOrganisationField("triggerPayload", event.target.value)}
            />
          </label>
          <label>
            <span>内核日志命令</span>
            <input
              aria-label="组织内核日志命令"
              value={organisationDraft.kernelLogCommand}
              disabled={!canEdit || saving}
              onChange={(event) => updateOrganisationField("kernelLogCommand", event.target.value)}
            />
          </label>
        </div>
        <div className="reload-configuration-actions">
          <Button type="button" disabled={!canEdit || saving || loading} onClick={() => void saveOrganisation()}>
            保存组织默认值
          </Button>
        </div>
      </div>

      <div className="param-admin-panel__section">
        <h3>设备覆盖</h3>
        <div className="config-form-grid reload-configuration-form">
          <label className="wide">
            <span>设备</span>
            <select
              aria-label="覆盖设备"
              value={selectedDeviceId}
              disabled={!canEdit || saving}
              onChange={(event) => setSelectedDeviceId(event.target.value)}
            >
              <option value="">选择设备…</option>
              {devices.map((device) => (
                <option key={device.id} value={device.id}>
                  {device.name}
                  {overrides.some((item) => item.deviceId === device.id) ? "（已覆盖）" : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Overlay 目标目录</span>
            <input
              aria-label="设备 Overlay 目标目录"
              value={deviceDraft.destinationDirectory}
              disabled={!canEdit || saving || !selectedDeviceId}
              onChange={(event) => updateDeviceField("destinationDirectory", event.target.value)}
            />
          </label>
          <label>
            <span>Overlay 目标文件名</span>
            <input
              aria-label="设备 Overlay 目标文件名"
              value={deviceDraft.destinationFilename}
              disabled={!canEdit || saving || !selectedDeviceId}
              onChange={(event) => updateDeviceField("destinationFilename", event.target.value)}
            />
          </label>
          <label className="wide">
            <span>触发节点路径</span>
            <input
              aria-label="设备触发节点路径"
              value={deviceDraft.triggerNodePath}
              disabled={!canEdit || saving || !selectedDeviceId}
              onChange={(event) => updateDeviceField("triggerNodePath", event.target.value)}
            />
          </label>
          <label>
            <span>触发载荷</span>
            <input
              aria-label="设备触发载荷"
              value={deviceDraft.triggerPayload}
              disabled={!canEdit || saving || !selectedDeviceId}
              onChange={(event) => updateDeviceField("triggerPayload", event.target.value)}
            />
          </label>
          <label>
            <span>内核日志命令</span>
            <input
              aria-label="设备内核日志命令"
              value={deviceDraft.kernelLogCommand}
              disabled={!canEdit || saving || !selectedDeviceId}
              onChange={(event) => updateDeviceField("kernelLogCommand", event.target.value)}
            />
          </label>
        </div>
        <div className="reload-configuration-actions">
          <Button
            type="button"
            disabled={!canEdit || saving || loading || !selectedDeviceId}
            onClick={() => void saveDeviceOverride()}
          >
            保存设备覆盖
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={!canEdit || saving || loading || !selectedOverride}
            onClick={() => void removeDeviceOverride()}
          >
            删除设备覆盖
          </Button>
        </div>
      </div>
    </section>
  );
}
