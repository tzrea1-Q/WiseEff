import { useCallback, useEffect, useState } from "react";
import type {
  ConfigSetRole,
  DtsConfigSet,
  DtsConfigSetFile,
  DtsReleaseBaseline,
  DtsStructuredRepository,
  DtsValidationGateResult
} from "@/application/ports/DtsStructuredRepository";

export type ConfigSetBaselinePanelProps = {
  projectId: string;
  repository: DtsStructuredRepository;
  canAdmin?: boolean;
  availableFiles?: { id: string; fileName: string }[];
};

const CONFIG_SET_ROLES: ConfigSetRole[] = ["base", "overlay", "charging", "thermal", "misc"];

type LocalMember = DtsConfigSetFile & { fileName: string };

function downloadExportBundle(configSetName: string, files: Array<{ name: string; content: string }>) {
  const payload = files.map((file) => `// ${file.name}\n${file.content}`).join("\n\n");
  const blob = new Blob([payload], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${configSetName || "config-set"}-export.dts`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function ConfigSetBaselinePanel({
  projectId,
  repository,
  canAdmin = true,
  availableFiles = []
}: ConfigSetBaselinePanelProps) {
  const [configSets, setConfigSets] = useState<DtsConfigSet[]>([]);
  const [selectedConfigSetId, setSelectedConfigSetId] = useState<string | null>(null);
  const [members, setMembers] = useState<LocalMember[]>([]);
  const [baselines, setBaselines] = useState<DtsReleaseBaseline[]>([]);
  const [newConfigSetName, setNewConfigSetName] = useState("");
  const [newBaselineName, setNewBaselineName] = useState("");
  const [memberFileId, setMemberFileId] = useState(availableFiles[0]?.id ?? "");
  const [memberRole, setMemberRole] = useState<ConfigSetRole>("base");
  const [gateResult, setGateResult] = useState<DtsValidationGateResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const selectedConfigSet = configSets.find((item) => item.id === selectedConfigSetId) ?? null;

  const loadConfigSets = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const items = await repository.listConfigSets(projectId);
      setConfigSets(items);
      setSelectedConfigSetId((current) => {
        if (current && items.some((item) => item.id === current)) {
          return current;
        }
        return items[0]?.id ?? null;
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "配置集列表加载失败。");
    } finally {
      setLoading(false);
    }
  }, [projectId, repository]);

  const loadBaselines = useCallback(
    async (configSetId: string) => {
      try {
        const items = await repository.listBaselines(projectId, configSetId);
        setBaselines(items);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "基线列表加载失败。");
      }
    },
    [projectId, repository]
  );

  useEffect(() => {
    void loadConfigSets();
  }, [loadConfigSets]);

  useEffect(() => {
    if (!selectedConfigSetId) {
      setBaselines([]);
      return;
    }
    void loadBaselines(selectedConfigSetId);
  }, [loadBaselines, selectedConfigSetId]);

  useEffect(() => {
    if (!memberFileId && availableFiles[0]?.id) {
      setMemberFileId(availableFiles[0].id);
    }
  }, [availableFiles, memberFileId]);

  const createConfigSet = async () => {
    if (!canAdmin) {
      return;
    }
    const name = newConfigSetName.trim();
    if (!name) {
      return;
    }
    setError("");
    try {
      const created = await repository.createConfigSet(projectId, { name });
      setConfigSets((current) => [created, ...current.filter((item) => item.id !== created.id)]);
      setSelectedConfigSetId(created.id);
      setMembers([]);
      setNewConfigSetName("");
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "创建配置集失败。");
    }
  };

  const selectConfigSet = (configSetId: string) => {
    setSelectedConfigSetId(configSetId);
    setMembers([]);
    setGateResult(null);
  };

  const addMember = async () => {
    if (!canAdmin || !selectedConfigSetId || !memberFileId) {
      return;
    }
    setError("");
    try {
      const membership = await repository.addConfigSetFile(projectId, selectedConfigSetId, {
        fileId: memberFileId,
        role: memberRole
      });
      const fileName = availableFiles.find((file) => file.id === memberFileId)?.fileName ?? memberFileId;
      setMembers((current) => [
        ...current.filter((item) => item.fileId !== membership.fileId),
        { ...membership, fileName }
      ]);
    } catch (addError) {
      setError(addError instanceof Error ? addError.message : "添加成员失败。");
    }
  };

  const removeMember = async (fileId: string) => {
    if (!canAdmin || !selectedConfigSetId) {
      return;
    }
    setError("");
    try {
      await repository.removeConfigSetFile(projectId, selectedConfigSetId, fileId);
      setMembers((current) => current.filter((item) => item.fileId !== fileId));
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "移除成员失败。");
    }
  };

  const createBaseline = async () => {
    if (!canAdmin || !selectedConfigSetId) {
      return;
    }
    const name = newBaselineName.trim();
    if (!name) {
      return;
    }
    setError("");
    try {
      const created = await repository.createBaseline(projectId, selectedConfigSetId, { name });
      setBaselines((current) => [created, ...current.filter((item) => item.id !== created.id)]);
      setNewBaselineName("");
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "创建基线失败。");
    }
  };

  const releaseBaseline = async (baselineId: string) => {
    if (!canAdmin) {
      return;
    }
    setError("");
    try {
      const result = await repository.releaseBaseline(projectId, baselineId);
      setGateResult(result.gate);
      setBaselines((current) => current.map((item) => (item.id === baselineId ? result.item : item)));
    } catch (releaseError) {
      setError(releaseError instanceof Error ? releaseError.message : "发布基线失败。");
    }
  };

  const exportConfigSet = async () => {
    if (!canAdmin || !selectedConfigSetId || !selectedConfigSet) {
      return;
    }
    setError("");
    try {
      const result = await repository.exportConfigSet(projectId, selectedConfigSetId);
      downloadExportBundle(selectedConfigSet.name, result.files);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "导出配置集失败。");
    }
  };

  return (
    <section className="config-set-baseline-panel" aria-label="配置集 / 基线">
      {error ? (
        <p className="config-set-baseline-panel__error" role="alert">
          {error}
        </p>
      ) : null}
      {loading ? <p className="config-set-baseline-panel__loading">配置集加载中…</p> : null}

      {!canAdmin ? (
        <p className="config-set-baseline-panel__hint" role="note">
          仅管理员可管理配置集与基线。
        </p>
      ) : null}

      <div className="config-set-baseline-panel__section">
        <h3>配置集</h3>
        {canAdmin ? (
          <div className="config-set-baseline-panel__row">
            <label>
              配置集名称
              <input
                type="text"
                value={newConfigSetName}
                onChange={(event) => setNewConfigSetName(event.target.value)}
                placeholder="board-a"
              />
            </label>
            <button type="button" className="button" onClick={() => void createConfigSet()}>
              创建配置集
            </button>
          </div>
        ) : null}
        <ul className="config-set-baseline-panel__list" aria-label="配置集列表">
          {configSets.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className={item.id === selectedConfigSetId ? "is-active" : undefined}
                aria-label={`选择 ${item.name}`}
                onClick={() => selectConfigSet(item.id)}
              >
                {item.name}
              </button>
            </li>
          ))}
        </ul>
      </div>

      {selectedConfigSet ? (
        <>
          <div className="config-set-baseline-panel__section">
            <h3>成员 · {selectedConfigSet.name}</h3>
            {canAdmin ? (
              <div className="config-set-baseline-panel__row">
                <label>
                  成员文件
                  <select
                    value={memberFileId}
                    onChange={(event) => setMemberFileId(event.target.value)}
                    disabled={availableFiles.length === 0}
                  >
                    {availableFiles.length === 0 ? <option value="">暂无可用文件</option> : null}
                    {availableFiles.map((file) => (
                      <option key={file.id} value={file.id}>
                        {file.fileName}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  成员角色
                  <select
                    value={memberRole}
                    onChange={(event) => setMemberRole(event.target.value as ConfigSetRole)}
                  >
                    {CONFIG_SET_ROLES.map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="button" className="button" onClick={() => void addMember()} disabled={!memberFileId}>
                  添加成员
                </button>
                <button type="button" className="button subtle" onClick={() => void exportConfigSet()}>
                  导出配置集
                </button>
              </div>
            ) : null}
            <ul className="config-set-baseline-panel__list" aria-label="配置集成员">
              {members.map((member) => (
                <li key={member.fileId}>
                  <span>{member.fileName}</span>
                  <span>{member.role}</span>
                  {canAdmin ? (
                    <button
                      type="button"
                      className="button subtle"
                      aria-label={`移除 ${member.fileName}`}
                      onClick={() => void removeMember(member.fileId)}
                    >
                      移除
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>

          <div className="config-set-baseline-panel__section">
            <h3>基线</h3>
            {canAdmin ? (
              <div className="config-set-baseline-panel__row">
                <label>
                  基线名称
                  <input
                    type="text"
                    value={newBaselineName}
                    onChange={(event) => setNewBaselineName(event.target.value)}
                    placeholder="v1-draft"
                  />
                </label>
                <button type="button" className="button" onClick={() => void createBaseline()}>
                  创建基线
                </button>
              </div>
            ) : null}
            <ul className="config-set-baseline-panel__list" aria-label="基线列表">
              {baselines.map((item) => (
                <li key={item.id}>
                  <span>{item.name}</span>
                  <span>{item.status}</span>
                  {canAdmin && item.status === "draft" ? (
                    <button
                      type="button"
                      className="button"
                      aria-label={`发布 ${item.name}`}
                      onClick={() => void releaseBaseline(item.id)}
                    >
                      发布
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        </>
      ) : null}

      {gateResult ? (
        <div className="config-set-baseline-panel__gate" role="status" aria-label="校验门禁结果">
          <p>mode: {gateResult.mode}</p>
          <p>requiresConfirmation: {String(gateResult.requiresConfirmation)}</p>
          <p>ok: {String(gateResult.ok)}</p>
          {gateResult.diagnostics.map((diagnostic, index) => (
            <p key={`${diagnostic.message}-${index}`}>{diagnostic.message}</p>
          ))}
        </div>
      ) : null}
    </section>
  );
}
