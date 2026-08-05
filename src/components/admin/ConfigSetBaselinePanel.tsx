import { useCallback, useEffect, useState, type ReactNode } from "react";
import type {
  ConfigSetRole,
  DtsCompareBaselineResult,
  DtsConfigSet,
  DtsConfigSetFile,
  DtsReleaseBaseline,
  DtsStructuredRepository,
  DtsValidationGateResult
} from "@/application/ports/DtsStructuredRepository";
import { aggregateStructuredChangeSet, type ParameterSourceLookup } from "@/application/parameters/structuredChangeSet";
import type { ParameterAdminAuditHint } from "@/application/parameters/parameterAdminState";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { ParamAdminEmptyState } from "@/components/parameter-admin-next/ParamAdminEmptyState";
import { StructuredDiffView } from "@/components/parameters/StructuredDiffView";
import type { ValidationRun } from "@/domain/parameter-topology/types";

export type ConfigSetBaselinePanelAuditEvent = {
  kind: Extract<
    ParameterAdminAuditHint["kind"],
    | "baseline-compared"
    | "baseline-rolled-back"
    | "baseline-released"
    | "config-set-exported"
    | "revision-validated"
  >;
  summary: string;
};

export type ConfigSetBaselinePanelProps = {
  projectId: string;
  repository: DtsStructuredRepository;
  canAdmin?: boolean;
  availableFiles?: { id: string; fileName: string }[];
  /** Source bindings used to map baseline structural diffs onto real parameters (no unmapped). */
  parameterSources?: ParameterSourceLookup[];
  /** Config revision validated through the topology port (toolchain gate). */
  revisionId?: string;
  validateRevision?: (projectId: string, revisionId: string) => Promise<ValidationRun>;
  /** When omitted, the first listed config set is treated as the project default. */
  defaultConfigSetId?: string;
  onAudit?: (event: ConfigSetBaselinePanelAuditEvent) => void;
};

const CONFIG_SET_ROLES: ConfigSetRole[] = ["base", "overlay", "charging", "thermal", "misc"];

const CONFIG_SET_ROLE_LABELS: Record<ConfigSetRole, string> = {
  base: "基础",
  overlay: "覆盖层",
  charging: "充电",
  thermal: "温控",
  misc: "其他"
};

const BASELINE_STATUS_LABELS: Record<string, string> = {
  draft: "草稿",
  released: "已发布",
  rolled_back: "已回滚",
  superseded: "已被替代"
};

const GATE_SEVERITY_LABELS: Record<string, string> = {
  error: "错误",
  warning: "警告",
  info: "提示"
};

function baselineStatusLabel(status: string): string {
  return BASELINE_STATUS_LABELS[status] ?? status;
}

type LocalMember = DtsConfigSetFile & { fileName: string };

/** A mutating action awaiting explicit human confirmation. */
type PendingConfirmation = {
  key: string;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  pendingLabel: string;
  tone: "primary" | "danger";
  acknowledgement?: ReactNode;
  run: () => Promise<void>;
};

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

function gateFromValidationRun(run: ValidationRun): DtsValidationGateResult {
  const failed = run.status === "failed";
  return {
    ok: !failed,
    mode: failed ? "block" : "warn",
    requiresConfirmation: failed,
    diagnostics: (run.diagnostics ?? []).map((item) => ({
      file: item.path,
      line: item.startLine,
      severity: item.severity === "warning" || item.severity === "info" ? item.severity : "error",
      message: item.message
    })),
    compiler: run.stage === "toolchain" || run.stage === "dtc" ? "dtc" : "unavailable"
  };
}

export function ConfigSetBaselinePanel({
  projectId,
  repository,
  canAdmin = true,
  availableFiles = [],
  parameterSources = [],
  revisionId = "revision-teaching-1",
  validateRevision,
  defaultConfigSetId,
  onAudit
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
  const [compareResult, setCompareResult] = useState<DtsCompareBaselineResult | null>(null);
  const [submitMessage, setSubmitMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<PendingConfirmation | null>(null);
  const [configSetNameError, setConfigSetNameError] = useState("");
  const [baselineNameError, setBaselineNameError] = useState("");

  const busy = pendingAction !== null;

  /**
   * Every mutating action runs through here so a second click cannot start a second
   * request while the first is in flight.
   */
  const runAction = useCallback(async (key: string, action: () => Promise<void>) => {
    setPendingAction(key);
    try {
      await action();
    } finally {
      setPendingAction(null);
    }
  }, []);

  const selectedConfigSet = configSets.find((item) => item.id === selectedConfigSetId) ?? null;
  const resolvedDefaultId = defaultConfigSetId ?? configSets[0]?.id ?? null;

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
      setConfigSetNameError("请先填写配置集名称。");
      return;
    }
    if (configSets.some((item) => item.name.toLowerCase() === name.toLowerCase())) {
      setConfigSetNameError(`已存在名为「${name}」的配置集。`);
      return;
    }
    setConfigSetNameError("");
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
    // The comparison is baseline-specific, but the revision gate is project-scoped:
    // clearing it here used to silently drop the verdict that gates a release.
    setCompareResult(null);
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

  const requestRemoveMember = (member: LocalMember) => {
    setConfirmation({
      key: `remove-member-${member.fileId}`,
      title: "移除配置集成员",
      description: (
        <p>
          将把 <code>{member.fileName}</code>（角色：
          {CONFIG_SET_ROLE_LABELS[member.role as ConfigSetRole] ?? member.role}）从配置集「
          {selectedConfigSet?.name}」中移除。该文件本身不会被删除，但基于此配置集的后续基线与导出将不再包含它。
        </p>
      ),
      confirmLabel: "确认移除",
      pendingLabel: "移除中…",
      tone: "danger",
      run: () => removeMember(member.fileId)
    });
  };

  const requestReleaseBaseline = (baseline: DtsReleaseBaseline) => {
    const gateBlocked = Boolean(gateResult && gateResult.requiresConfirmation);
    setConfirmation({
      key: `release-${baseline.id}`,
      title: "发布基线",
      description: (
        <>
          <p>
            将把基线「{baseline.name}」发布为配置集「{selectedConfigSet?.name}」的当前生效版本。
            发布后，依赖该配置集的下游取值将按此基线读取。
          </p>
          {gateBlocked ? (
            <p className="governance-confirm-dialog__risk">
              该项目最近一次修订校验未通过，门禁要求人工确认后才能发布。
            </p>
          ) : null}
        </>
      ),
      confirmLabel: "确认发布",
      pendingLabel: "发布中…",
      tone: gateBlocked ? "danger" : "primary",
      ...(gateBlocked
        ? { acknowledgement: "我已了解校验未通过，并承担本次发布的风险。" }
        : {}),
      run: () => releaseBaseline(baseline.id)
    });
  };

  const requestRollbackBaseline = (baseline: DtsReleaseBaseline) => {
    setConfirmation({
      key: `rollback-${baseline.id}`,
      title: "回滚基线",
      description: (
        <p>
          将把配置集「{selectedConfigSet?.name}」的参数取值恢复到基线「{baseline.name}」记录的状态。
          该基线之后发生的参数改动会被覆盖，此操作不可撤销。
        </p>
      ),
      confirmLabel: "确认回滚",
      pendingLabel: "回滚中…",
      tone: "danger",
      run: () => rollbackBaseline(baseline)
    });
  };

  const createBaseline = async () => {
    if (!canAdmin || !selectedConfigSetId) {
      return;
    }
    const name = newBaselineName.trim();
    if (!name) {
      setBaselineNameError("请先填写基线名称。");
      return;
    }
    if (baselines.some((item) => item.name.toLowerCase() === name.toLowerCase())) {
      setBaselineNameError(`该配置集下已存在名为「${name}」的基线。`);
      return;
    }
    setBaselineNameError("");
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
      onAudit?.({
        kind: "baseline-released",
        summary: `已发布基线「${result.item.name}」`
      });
    } catch (releaseError) {
      setError(releaseError instanceof Error ? releaseError.message : "发布基线失败。");
    }
  };

  const rollbackBaseline = async (baseline: DtsReleaseBaseline) => {
    if (!canAdmin) {
      return;
    }
    setError("");
    try {
      const result = await repository.rollbackBaseline(projectId, baseline.id);
      onAudit?.({
        kind: "baseline-rolled-back",
        summary: `已回滚基线「${baseline.name}」（恢复 ${result.restored} 项）`
      });
    } catch (rollbackError) {
      setError(rollbackError instanceof Error ? rollbackError.message : "回滚基线失败。");
    }
  };

  const runValidateRevision = async () => {
    if (!canAdmin || !validateRevision) {
      return;
    }
    setError("");
    try {
      const run = await validateRevision(projectId, revisionId);
      setGateResult(gateFromValidationRun(run));
      onAudit?.({
        kind: "revision-validated",
        summary: `已校验修订 ${revisionId}（${run.status}）`
      });
    } catch (validateError) {
      setError(validateError instanceof Error ? validateError.message : "修订校验失败。");
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
      onAudit?.({
        kind: "config-set-exported",
        summary: `已导出配置集「${selectedConfigSet.name}」`
      });
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "导出配置集失败。");
    }
  };

  const compareBaseline = async (baseline: DtsReleaseBaseline) => {
    if (!canAdmin) {
      return;
    }
    setError("");
    setSubmitMessage("");
    try {
      const result = await repository.compareBaseline(projectId, baseline.id);
      setCompareResult(result);
      onAudit?.({
        kind: "baseline-compared",
        summary: `已对比基线「${baseline.name}」`
      });
    } catch (compareError) {
      setError(compareError instanceof Error ? compareError.message : "基线对比失败。");
    }
  };

  const changeSet = compareResult
    ? aggregateStructuredChangeSet(compareResult, parameterSources)
    : null;

  const submitMappedChangeSet = async () => {
    if (!canAdmin || !changeSet || changeSet.items.length === 0 || !compareResult) {
      return;
    }
    setError("");
    setSubmitMessage("");
    try {
      const mappedEdits = [];
      for (const entry of changeSet.changes) {
        const change = entry.change;
        if (
          change.kind !== "prop_changed" &&
          change.kind !== "prop_added" &&
          change.kind !== "prop_removed"
        ) {
          continue;
        }
        const sourcePath = change.nodePath ? `${change.nodePath}/${change.prop}` : change.prop;
        const parameter = parameterSources.find(
          (candidate) =>
            candidate.sourceFileName === (entry.fileName ?? "") &&
            candidate.sourceNodePath === sourcePath
        );
        if (!parameter) {
          continue;
        }
        const item = changeSet.items.find((candidate) => candidate.parameterId === parameter.id);
        if (!item) {
          continue;
        }
        mappedEdits.push({
          fileId: entry.fileId,
          nodePath: change.nodePath,
          propertyName: change.prop,
          rawText: item.targetValue,
          reason: item.reason
        });
      }

      if (mappedEdits.length === 0) {
        setError("变更集没有可提交的已映射属性项。");
        return;
      }

      const round = await repository.submitStructuredEdits(projectId, {
        edits: mappedEdits,
        reason: `Baseline change-set ${compareResult.baselineId}`
      });
      setSubmitMessage(`已提交变更请求 ${round.id}（${round.items.length} 项）`);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "提交变更请求失败。");
    }
  };

  return (
    <section className="config-set-baseline-panel param-admin-panel" aria-label="配置集 / 基线">
      {error ? (
        <p className="config-set-baseline-panel__error" role="alert">
          {error}
        </p>
      ) : null}
      {submitMessage ? (
        <p className="config-set-baseline-panel__submit-success" role="status">
          {submitMessage}
        </p>
      ) : null}
      {loading ? <p className="config-set-baseline-panel__loading">配置集加载中…</p> : null}

      {!canAdmin ? (
        <p className="config-set-baseline-panel__hint" role="note">
          仅管理员可管理配置集与基线。
        </p>
      ) : null}

      <div className="config-set-baseline-panel__section param-admin-panel__section">
        <h3>配置集</h3>
        {canAdmin ? (
          <div className="config-set-baseline-panel__row">
            <label>
              配置集名称
              <input
                type="text"
                value={newConfigSetName}
                aria-invalid={configSetNameError ? "true" : "false"}
                aria-describedby={configSetNameError ? "config-set-name-error" : undefined}
                onChange={(event) => {
                  setNewConfigSetName(event.target.value);
                  setConfigSetNameError("");
                }}
                placeholder="board-a"
              />
            </label>
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() => void runAction("create-config-set", createConfigSet)}
            >
              {pendingAction === "create-config-set" ? "创建中…" : "创建配置集"}
            </button>
            {validateRevision ? (
              <button
                type="button"
                className="button subtle"
                disabled={busy}
                onClick={() => void runAction("validate-revision", runValidateRevision)}
              >
                {pendingAction === "validate-revision" ? "校验中…" : "校验修订"}
              </button>
            ) : null}
            {configSetNameError ? (
              <p className="field-error" id="config-set-name-error" role="alert">
                {configSetNameError}
              </p>
            ) : null}
          </div>
        ) : null}
        {/* Surfaced next to 校验修订 rather than at the bottom of the page. */}
        {gateResult ? <ValidationGateResult gate={gateResult} /> : null}
        {!loading && configSets.length === 0 ? (
          <ParamAdminEmptyState message="该项目还没有配置集。">
            <p>配置集把参数文件组合成一份可发布的集合，是创建基线的前提。</p>
          </ParamAdminEmptyState>
        ) : null}
        {configSets.length > 0 ? (
          <ul className="config-set-baseline-panel__list" aria-label="配置集列表">
            {configSets.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={item.id === selectedConfigSetId ? "is-active" : undefined}
                  aria-label={`选择 ${item.name}`}
                  aria-pressed={item.id === selectedConfigSetId}
                  onClick={() => selectConfigSet(item.id)}
                >
                  {item.name}
                  {item.id === resolvedDefaultId ? <span aria-label="默认配置集"> 默认</span> : null}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {selectedConfigSet ? (
        <>
          <div className="config-set-baseline-panel__section param-admin-panel__section">
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
                        {CONFIG_SET_ROLE_LABELS[role]}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="button"
                  onClick={() => void runAction("add-member", addMember)}
                  disabled={!memberFileId || busy}
                >
                  {pendingAction === "add-member" ? "添加中…" : "添加成员"}
                </button>
                <button
                  type="button"
                  className="button subtle"
                  disabled={busy}
                  onClick={() => void runAction("export-config-set", exportConfigSet)}
                >
                  {pendingAction === "export-config-set" ? "导出中…" : "导出配置集"}
                </button>
              </div>
            ) : null}
            {members.length === 0 ? (
              <ParamAdminEmptyState message="该配置集还没有成员文件。">
                <p>先从上方选择一个参数文件并指定角色，再加入配置集。</p>
              </ParamAdminEmptyState>
            ) : (
              <ul className="config-set-baseline-panel__list" aria-label="配置集成员">
                {members.map((member) => (
                  <li key={member.fileId}>
                    <span>{member.fileName}</span>
                    <span>{CONFIG_SET_ROLE_LABELS[member.role as ConfigSetRole] ?? member.role}</span>
                    {canAdmin ? (
                      <button
                        type="button"
                        className="button subtle"
                        aria-label={`移除 ${member.fileName}`}
                        disabled={busy}
                        onClick={() => requestRemoveMember(member)}
                      >
                        移除
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="config-set-baseline-panel__section param-admin-panel__section">
            <h3>基线</h3>
            {canAdmin ? (
              <div className="config-set-baseline-panel__row">
                <label>
                  基线名称
                  <input
                    type="text"
                    value={newBaselineName}
                    aria-invalid={baselineNameError ? "true" : "false"}
                    aria-describedby={baselineNameError ? "baseline-name-error" : undefined}
                    onChange={(event) => {
                      setNewBaselineName(event.target.value);
                      setBaselineNameError("");
                    }}
                    placeholder="v1-draft"
                  />
                </label>
                <button
                  type="button"
                  className="button"
                  disabled={busy}
                  onClick={() => void runAction("create-baseline", createBaseline)}
                >
                  {pendingAction === "create-baseline" ? "创建中…" : "创建基线"}
                </button>
                {baselineNameError ? (
                  <p className="field-error" id="baseline-name-error" role="alert">
                    {baselineNameError}
                  </p>
                ) : null}
              </div>
            ) : null}
            {baselines.length === 0 ? (
              <ParamAdminEmptyState message="该配置集还没有基线。">
                <p>基线是一次可发布、可回滚、可对比的取值快照。</p>
              </ParamAdminEmptyState>
            ) : (
              <ul className="config-set-baseline-panel__list" aria-label="基线列表">
                {baselines.map((item) => (
                  <li key={item.id}>
                    <span>{item.name}</span>
                    <span>{baselineStatusLabel(item.status)}</span>
                    {canAdmin ? (
                      <button
                        type="button"
                        className="button subtle"
                        aria-label={`对比 ${item.name}`}
                        disabled={busy}
                        onClick={() => void runAction(`compare-${item.id}`, () => compareBaseline(item))}
                      >
                        {pendingAction === `compare-${item.id}` ? "对比中…" : "对比"}
                      </button>
                    ) : null}
                    {canAdmin && item.status === "released" ? (
                      <button
                        type="button"
                        className="button subtle"
                        aria-label={`回滚 ${item.name}`}
                        disabled={busy}
                        onClick={() => requestRollbackBaseline(item)}
                      >
                        回滚
                      </button>
                    ) : null}
                    {canAdmin && item.status === "draft" ? (
                      <button
                        type="button"
                        className="button"
                        aria-label={`发布 ${item.name}`}
                        disabled={busy}
                        onClick={() => requestReleaseBaseline(item)}
                      >
                        发布
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      ) : null}

      {compareResult && changeSet ? (
        <div className="config-set-baseline-panel__compare">
          <StructuredDiffView result={compareResult} changeSet={changeSet} />
          {canAdmin && changeSet.items.length > 0 ? (
            <button
              type="button"
              className="button primary"
              disabled={busy}
              onClick={() => void runAction("submit-change-set", submitMappedChangeSet)}
            >
              {pendingAction === "submit-change-set"
                ? "提交中…"
                : `提交变更请求（${changeSet.items.length} 项）`}
            </button>
          ) : null}
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmation !== null}
        title={confirmation?.title ?? ""}
        description={confirmation?.description ?? null}
        confirmLabel={confirmation?.confirmLabel ?? "确认"}
        pendingLabel={confirmation?.pendingLabel}
        tone={confirmation?.tone ?? "primary"}
        acknowledgement={confirmation?.acknowledgement}
        pending={confirmation !== null && pendingAction === confirmation.key}
        onCancel={() => {
          if (!busy) {
            setConfirmation(null);
          }
        }}
        onConfirm={() => {
          const request = confirmation;
          if (!request) {
            return;
          }
          void runAction(request.key, request.run).then(() => setConfirmation(null));
        }}
      />
    </section>
  );
}

/**
 * The gate used to print `mode`, `requiresConfirmation` and `ok` as three raw
 * camelCase lines. The verdict is what the operator needs; the mode and compiler are
 * supporting detail.
 */
function ValidationGateResult({ gate }: { gate: DtsValidationGateResult }) {
  return (
    <div
      className="config-set-baseline-panel__gate"
      role="status"
      aria-label="校验门禁结果"
      data-ok={gate.ok ? "true" : "false"}
    >
      <p className="config-set-baseline-panel__gate-verdict">
        {gate.ok ? "修订校验通过。" : "修订校验未通过，发布前需要人工确认风险。"}
      </p>
      <p className="config-set-baseline-panel__gate-meta">
        {gate.mode === "block" ? "门禁：阻断发布" : "门禁：仅告警"}
        {" · "}
        {gate.compiler === "dtc" ? "由 dtc 编译校验" : "编译器不可用，仅做静态检查"}
      </p>
      {gate.diagnostics.length > 0 ? (
        <ul className="config-set-baseline-panel__gate-diagnostics">
          {gate.diagnostics.map((diagnostic, index) => (
            <li key={`${diagnostic.message}-${index}`} data-severity={diagnostic.severity}>
              <span className="config-set-baseline-panel__gate-severity">
                {GATE_SEVERITY_LABELS[diagnostic.severity] ?? diagnostic.severity}
              </span>
              <span>{diagnostic.message}</span>
              {diagnostic.file ? (
                <code>
                  {diagnostic.file}
                  {typeof diagnostic.line === "number" ? `:${diagnostic.line}` : ""}
                </code>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="config-set-baseline-panel__gate-meta">没有诊断信息。</p>
      )}
    </div>
  );
}
