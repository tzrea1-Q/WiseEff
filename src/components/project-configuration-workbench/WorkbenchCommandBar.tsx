import { useEffect, useRef, useState, type RefObject } from "react";
import { Activity, ChevronLeft, PanelRight } from "lucide-react";

import type {
  DtsConfigSet,
  DtsConfigSetMemberFile,
  DtsReleaseBaseline,
  DtsReleaseReadiness
} from "@/application/ports/DtsStructuredRepository";
import type { ParameterFileCandidate } from "@/application/ports/ParameterFileRepository";
import { ModalDialog } from "@/components/common/ModalDialog";
import {
  WorkbenchReleaseReadinessSummary,
  workbenchReadinessAllowsCreate
} from "./WorkbenchReleaseReadiness";

export type WorkbenchCommandBarProps = {
  project: {
    id: string;
    name: string;
    code: string;
    statusLabel: string;
  };
  onLeave: () => void;
  configSets: DtsConfigSet[];
  selectedConfigSet: DtsConfigSet | null;
  configSetsLoading: boolean;
  configSetsError: string;
  onSelectConfigSet: (configSetId: string) => void;
  canAdmin: boolean;
  selectedMember: DtsConfigSetMemberFile | null;
  activeCandidate: ParameterFileCandidate | null;
  baselinesLoading: boolean;
  baselinesError: string;
  releasedBaseline: DtsReleaseBaseline | null;
  onBaselinesRetry: () => void;
  releaseReadiness: DtsReleaseReadiness | null;
  readinessLoading: boolean;
  readinessError: string;
  sessionDraftsDirty: boolean;
  onReadinessRetry: () => void;
  onOpenIssues: () => void;
  narrowViewport: boolean;
  inspectorOpen: boolean;
  onInspectorToggle: () => void;
  candidateFileInputRef: RefObject<HTMLInputElement | null>;
  uploadingCandidate: boolean;
  onCandidateFileChange: (file: File) => void;
  downloadingDts: boolean;
  onDownloadActiveDts: () => void;
  pendingAction: string | null;
  onOpenActivity: () => void;
  onExportConfigSet: () => void;
  onOpenCreateBaseline: () => void;
  /** Returns null on success, a message for field validation errors, or undefined to keep the dialog open. */
  onCreateConfigSet: (name: string) => Promise<string | null | undefined>;
};

export function WorkbenchCommandBar({
  project,
  onLeave,
  configSets,
  selectedConfigSet,
  configSetsLoading,
  configSetsError,
  onSelectConfigSet,
  canAdmin,
  selectedMember,
  activeCandidate,
  baselinesLoading,
  baselinesError,
  releasedBaseline,
  onBaselinesRetry,
  releaseReadiness,
  readinessLoading,
  readinessError,
  sessionDraftsDirty,
  onReadinessRetry,
  onOpenIssues,
  narrowViewport,
  inspectorOpen,
  onInspectorToggle,
  candidateFileInputRef,
  uploadingCandidate,
  onCandidateFileChange,
  downloadingDts,
  onDownloadActiveDts,
  pendingAction,
  onOpenActivity,
  onExportConfigSet,
  onOpenCreateBaseline,
  onCreateConfigSet
}: WorkbenchCommandBarProps) {
  const [identitiesExpanded, setIdentitiesExpanded] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement | null>(null);
  const [createConfigSetOpen, setCreateConfigSetOpen] = useState(false);
  const [newConfigSetName, setNewConfigSetName] = useState("");
  const [configSetNameError, setConfigSetNameError] = useState("");

  useEffect(() => {
    if (!moreMenuOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && moreMenuRef.current && !moreMenuRef.current.contains(target)) {
        setMoreMenuOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMoreMenuOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [moreMenuOpen]);

  const handleSubmitCreateConfigSet = async () => {
    const result = await onCreateConfigSet(newConfigSetName);
    if (result === null) {
      setNewConfigSetName("");
      setConfigSetNameError("");
      setCreateConfigSetOpen(false);
      return;
    }
    if (typeof result === "string") {
      setConfigSetNameError(result);
    }
  };

  return (
    <>
      <header className="configuration-workbench__command" aria-label="配置命令栏">
        <button
          type="button"
          className="button subtle configuration-workbench__back"
          onClick={onLeave}
        >
          <ChevronLeft size={16} aria-hidden="true" />
          项目清单
        </button>
        <div
          className="configuration-workbench__project"
          title={`${project.code} · ${project.statusLabel}`}
        >
          <strong>{project.name}</strong>
        </div>
        <label className="configuration-workbench__config-select">
          <span>配置集</span>
          <select
            aria-label="配置集"
            value={selectedConfigSet?.id ?? ""}
            disabled={configSetsLoading || Boolean(configSetsError)}
            onChange={(event) => {
              const next = event.target.value;
              if (next === "__create_config_set__") {
                event.target.value = selectedConfigSet?.id ?? "";
                setConfigSetNameError("");
                setCreateConfigSetOpen(true);
                return;
              }
              onSelectConfigSet(next);
            }}
          >
            {configSets.length === 0 ? (
              <option value="" disabled>
                {canAdmin ? "选择或新建配置集" : "暂无配置集"}
              </option>
            ) : null}
            {configSets.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
            {canAdmin ? (
              <option value="__create_config_set__">+ 新建配置集…</option>
            ) : null}
          </select>
        </label>
        <div className="configuration-workbench__identities" aria-label="配置身份">
          <span className="configuration-workbench__working">工作配置</span>
          <div className="configuration-workbench__identity-fold-wrap">
            <button
              type="button"
              className="button subtle configuration-workbench__identity-fold"
              aria-expanded={identitiesExpanded}
              aria-controls="workbench-identity-details"
              onClick={() => setIdentitiesExpanded((open) => !open)}
            >
              版本{identitiesExpanded ? " ▴" : " ▾"}
            </button>
            {identitiesExpanded ? (
              <div
                id="workbench-identity-details"
                className="configuration-workbench__identity-details"
                role="region"
                aria-label="版本详情"
              >
                <span className="configuration-workbench__identity-chip" data-identity="file-version">
                  文件版本：
                  {selectedMember?.currentVersionNumber
                    ? `v${selectedMember.currentVersionNumber}`
                    : selectedMember?.currentVersionId ?? "无"}
                </span>
                <span className="configuration-workbench__identity-chip" data-identity="candidate">
                  候选文件版本：
                  {activeCandidate && activeCandidate.status !== "abandoned"
                    ? `${activeCandidate.fileName} · ${activeCandidate.status}`
                    : "尚未上传"}
                </span>
                <span className="configuration-workbench__identity-chip" data-identity="release-baseline">
                  发布基线：
                  {baselinesLoading ? "加载中…" : baselinesError ? "不可用" : releasedBaseline?.name ?? "尚未发布"}
                </span>
                {baselinesError ? (
                  <button
                    className="button subtle configuration-workbench__baseline-retry"
                    type="button"
                    onClick={onBaselinesRetry}
                  >
                    重试发布基线
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
        <div className="configuration-workbench__unavailable-actions" aria-label="后续阶段操作">
          {canAdmin ? (
            <WorkbenchReleaseReadinessSummary
              readiness={releaseReadiness}
              loading={readinessLoading}
              error={readinessError}
              localSessionDirty={sessionDraftsDirty}
              onRetry={onReadinessRetry}
              onOpenIssues={onOpenIssues}
            />
          ) : null}
          {!narrowViewport ? (
            <button
              className="button subtle configuration-workbench__inspector-toggle"
              type="button"
              aria-label="检查器"
              aria-expanded={inspectorOpen}
              onClick={onInspectorToggle}
            >
              <PanelRight size={16} aria-hidden="true" />
              检查器
            </button>
          ) : null}
          <input
            ref={candidateFileInputRef}
            type="file"
            accept=".dts,.dtsi,.json,text/plain,application/json"
            hidden
            aria-hidden="true"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              onCandidateFileChange(file);
            }}
          />
          <button
            className="button subtle"
            type="button"
            disabled={uploadingCandidate || !selectedConfigSet || !canAdmin}
            title="上传创建候选文件版本，不会激活工作配置"
            onClick={() => candidateFileInputRef.current?.click()}
          >
            {uploadingCandidate ? "上传中…" : "上传候选"}
          </button>
          <div className="dropdown-root configuration-workbench__more" ref={moreMenuRef}>
            <button
              type="button"
              className="button subtle"
              aria-expanded={moreMenuOpen}
              aria-haspopup="menu"
              aria-label="更多"
              onClick={() => setMoreMenuOpen((open) => !open)}
            >
              更多{moreMenuOpen ? " ▴" : " ▾"}
            </button>
            {moreMenuOpen ? (
              <div className="dropdown-menu configuration-workbench__more-menu" role="menu" aria-label="更多操作">
                {!narrowViewport ? (
                  <button
                    type="button"
                    className="dropdown-item"
                    role="menuitem"
                    onClick={() => {
                      setMoreMenuOpen(false);
                      onOpenActivity();
                    }}
                  >
                    <Activity size={14} aria-hidden="true" />
                    活动
                  </button>
                ) : null}
                <button
                  type="button"
                  className="dropdown-item"
                  role="menuitem"
                  disabled={!selectedMember?.currentVersionId || downloadingDts}
                  title={
                    !selectedMember
                      ? "请先选择一个成员文件"
                      : !selectedMember.currentVersionId
                        ? "当前成员没有可下载的活跃版本"
                        : "下载当前选中成员的活跃 DTS 版本"
                  }
                  onClick={() => {
                    setMoreMenuOpen(false);
                    void onDownloadActiveDts();
                  }}
                >
                  {downloadingDts ? "下载中…" : "下载 DTS"}
                </button>
                {canAdmin && selectedConfigSet ? (
                  <button
                    type="button"
                    className="dropdown-item"
                    role="menuitem"
                    disabled={pendingAction !== null}
                    onClick={() => {
                      setMoreMenuOpen(false);
                      onExportConfigSet();
                    }}
                  >
                    {pendingAction === "export-config-set" ? "导出中…" : "导出配置集"}
                  </button>
                ) : null}
                {canAdmin && selectedConfigSet ? (
                  <button
                    type="button"
                    className="dropdown-item"
                    role="menuitem"
                    disabled={
                      pendingAction !== null ||
                      !workbenchReadinessAllowsCreate(releaseReadiness, sessionDraftsDirty) ||
                      readinessLoading
                    }
                    title={
                      sessionDraftsDirty
                        ? "还有未保存的本机会话变更，不能创建基线"
                        : !releaseReadiness?.available
                          ? "发布就绪不可用，不能创建基线"
                          : !releaseReadiness.canCreateBaseline
                            ? "发布就绪门禁阻止创建基线"
                            : "创建发布基线快照"
                    }
                    onClick={() => {
                      setMoreMenuOpen(false);
                      onOpenCreateBaseline();
                    }}
                  >
                    创建基线
                  </button>
                ) : (
                  <button type="button" className="dropdown-item" role="menuitem" disabled title="需要管理员权限才能创建基线">
                    创建基线
                  </button>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <ModalDialog
        open={createConfigSetOpen}
        onDismiss={pendingAction === "create-config-set" ? undefined : () => setCreateConfigSetOpen(false)}
        className="submission-dialog configuration-workbench__create-config-dialog"
        backdropClassName="param-admin-modal-backdrop"
        describedBy
      >
        {({ titleId, descriptionId }) => (
          <>
            <div className="submission-dialog-head">
              <div>
                <h2 id={titleId}>新建配置集</h2>
                <p id={descriptionId}>创建后需明确把文件编入成员；上传候选不会自动激活工作配置。</p>
              </div>
              <button
                type="button"
                className="audit-dialog-close-icon"
                aria-label="关闭"
                disabled={pendingAction === "create-config-set"}
                onClick={() => setCreateConfigSetOpen(false)}
              >
                ×
              </button>
            </div>
            <form
              className="configuration-workbench__create-config-form"
              onSubmit={(event) => {
                event.preventDefault();
                void handleSubmitCreateConfigSet();
              }}
            >
              <label>
                配置集名称
                <input
                  type="text"
                  value={newConfigSetName}
                  autoFocus
                  aria-invalid={configSetNameError ? "true" : "false"}
                  aria-describedby={configSetNameError ? "workbench-config-set-name-error" : undefined}
                  onChange={(event) => {
                    setNewConfigSetName(event.target.value);
                    setConfigSetNameError("");
                  }}
                  placeholder="board-a"
                />
              </label>
              {configSetNameError ? (
                <p className="field-error" id="workbench-config-set-name-error" role="alert">
                  {configSetNameError}
                </p>
              ) : null}
              <div className="configuration-workbench__create-config-actions">
                <button
                  type="button"
                  className="button subtle"
                  disabled={pendingAction === "create-config-set"}
                  onClick={() => setCreateConfigSetOpen(false)}
                >
                  取消
                </button>
                <button className="button" type="submit" disabled={pendingAction !== null}>
                  {pendingAction === "create-config-set" ? "创建中…" : "创建配置集"}
                </button>
              </div>
            </form>
          </>
        )}
      </ModalDialog>
    </>
  );
}
