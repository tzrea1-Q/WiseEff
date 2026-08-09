import { useEffect, useMemo, useRef, useState } from "react";

import type {
  ParameterFileConflictBulkPreview,
  ParameterFileConflictResolution,
  ParameterFileRepository,
  ParameterFileSyncConflict
} from "@/application/ports/ParameterFileRepository";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";

export type WorkbenchConflictArbitrationDockProps = {
  projectId: string;
  repository: ParameterFileRepository;
  conflicts: ParameterFileSyncConflict[];
  onConflictsChange?: (conflicts: ParameterFileSyncConflict[]) => void;
  onLocateConflict?: (conflict: ParameterFileSyncConflict) => void;
  onQueueEmpty?: () => void;
  /** Auto-call onLocateConflict when the active conflict changes. Default true. */
  autoLocate?: boolean;
  /** Optional controlled active conflict id. */
  activeConflictId?: string | null;
  onActiveConflictIdChange?: (conflictId: string | null) => void;
};

const RESOLUTION_LABELS: Record<ParameterFileConflictResolution, string> = {
  file: "文件值",
  ui: "界面值"
};

const OUTCOME_TITLES: Record<ParameterFileConflictResolution, string> = {
  file: "使用文件值",
  ui: "保留界面值"
};

function getParameterDisplayName(conflict: ParameterFileSyncConflict) {
  if (conflict.parameterName?.trim()) {
    return conflict.parameterName;
  }
  return conflict.parameterDefinitionId;
}

function formatConflictTime(value: string | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString("zh-CN", { hour12: false });
}

function fileVersionDisplay(conflict: ParameterFileSyncConflict): string {
  if (conflict.fileVersionLabel?.trim()) {
    return conflict.fileVersionLabel.trim();
  }
  if (typeof conflict.fileVersionNumber === "number") {
    return `v${conflict.fileVersionNumber}`;
  }
  return conflict.fileVersionId;
}

function displayValue(value: string | undefined): string {
  return value && value.length > 0 ? value : "(空值)";
}

function openOnly(conflicts: ParameterFileSyncConflict[]) {
  return conflicts.filter((item) => item.status === "open");
}

export function WorkbenchConflictArbitrationDock({
  projectId,
  repository,
  conflicts,
  onConflictsChange,
  onLocateConflict,
  onQueueEmpty,
  autoLocate = true,
  activeConflictId,
  onActiveConflictIdChange
}: WorkbenchConflictArbitrationDockProps) {
  const openConflicts = useMemo(() => openOnly(conflicts), [conflicts]);
  const [internalIndex, setInternalIndex] = useState(0);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [arbitration, setArbitration] = useState<{
    conflict: ParameterFileSyncConflict;
    resolution: ParameterFileConflictResolution;
  } | null>(null);
  const [bulkChoosing, setBulkChoosing] = useState(false);
  const [bulkPreview, setBulkPreview] = useState<ParameterFileConflictBulkPreview | null>(null);
  const [bulkReason, setBulkReason] = useState("");

  const controlled = activeConflictId !== undefined;
  const activeIndex = useMemo(() => {
    if (openConflicts.length === 0) return 0;
    if (controlled) {
      const found = openConflicts.findIndex((item) => item.id === activeConflictId);
      return found >= 0 ? found : 0;
    }
    return Math.min(internalIndex, openConflicts.length - 1);
  }, [activeConflictId, controlled, internalIndex, openConflicts]);

  const activeConflict = openConflicts[activeIndex] ?? null;

  const onLocateRef = useRef(onLocateConflict);
  onLocateRef.current = onLocateConflict;
  const lastLocatedIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!autoLocate || !activeConflict) return;
    if (lastLocatedIdRef.current === activeConflict.id) return;
    lastLocatedIdRef.current = activeConflict.id;
    onLocateRef.current?.(activeConflict);
  }, [activeConflict, autoLocate]);

  useEffect(() => {
    if (!controlled) {
      setInternalIndex((current) => {
        if (openConflicts.length === 0) return 0;
        return Math.min(current, openConflicts.length - 1);
      });
    }
  }, [controlled, openConflicts.length]);

  const setActiveByIndex = (nextIndex: number) => {
    if (openConflicts.length === 0) {
      onActiveConflictIdChange?.(null);
      if (!controlled) setInternalIndex(0);
      return;
    }
    const clamped = Math.max(0, Math.min(nextIndex, openConflicts.length - 1));
    if (controlled) {
      onActiveConflictIdChange?.(openConflicts[clamped]?.id ?? null);
    } else {
      setInternalIndex(clamped);
    }
  };

  const refreshOpenConflicts = async () => {
    const items = await repository.listConflicts(projectId);
    const nextOpen = openOnly(items);
    onConflictsChange?.(nextOpen);
    return nextOpen;
  };

  const confirmResolve = async () => {
    if (!arbitration) return;
    setPending(true);
    setError("");
    try {
      const trimmed = reason.trim();
      await repository.resolveConflict(projectId, arbitration.conflict.id, {
        resolution: arbitration.resolution,
        ...(trimmed ? { reason: trimmed } : {})
      });
      const nextOpen = await refreshOpenConflicts();
      setArbitration(null);
      setReason("");
      if (nextOpen.length === 0) {
        onQueueEmpty?.();
      } else {
        // Keep the same index so the next conflict slides into place.
        const nextIndex = Math.min(activeIndex, nextOpen.length - 1);
        if (controlled) {
          onActiveConflictIdChange?.(nextOpen[nextIndex]?.id ?? null);
        } else {
          setInternalIndex(nextIndex);
        }
      }
    } catch (resolveError) {
      setError(resolveError instanceof Error ? resolveError.message : "冲突裁决失败。");
    } finally {
      setPending(false);
    }
  };

  const startBulkPreview = async (resolution: ParameterFileConflictResolution) => {
    setPending(true);
    setError("");
    setBulkChoosing(false);
    try {
      const preview = await repository.previewBulkConflictResolution(projectId, {
        resolution,
        conflictIds: openConflicts.map((item) => item.id)
      });
      setBulkPreview(preview);
      setBulkReason("");
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : "批量预览失败。");
      setBulkPreview(null);
    } finally {
      setPending(false);
    }
  };

  const confirmBulkResolve = async () => {
    if (!bulkPreview) return;
    setPending(true);
    setError("");
    try {
      const trimmed = bulkReason.trim();
      await repository.resolveConflictsBulk(projectId, {
        resolution: bulkPreview.resolution,
        conflictIds: bulkPreview.eligible.map((item) => item.id),
        ...(trimmed ? { reason: trimmed } : {})
      });
      const nextOpen = await refreshOpenConflicts();
      setBulkPreview(null);
      setBulkReason("");
      if (nextOpen.length === 0) {
        onQueueEmpty?.();
      } else {
        setActiveByIndex(0);
      }
    } catch (bulkError) {
      setError(bulkError instanceof Error ? bulkError.message : "批量裁决失败。");
    } finally {
      setPending(false);
    }
  };

  if (openConflicts.length === 0 || !activeConflict) {
    return null;
  }

  const baseMissing = activeConflict.baseValue === undefined || activeConflict.baseValue === "";
  const fileVersionTime = formatConflictTime(activeConflict.fileVersionCreatedAt);
  const uiDraftTime = formatConflictTime(activeConflict.uiDraftUpdatedAt);
  const identityBits = [
    activeConflict.configSetId ? `配置集 ${activeConflict.configSetId}` : null,
    activeConflict.fileName ?? null,
    activeConflict.nodePath ?? null,
    activeConflict.propertyName ?? null
  ].filter(Boolean);

  return (
    <section
      className="workbench-conflict-dock parameter-file-conflict-panel parameter-file-conflict-panel--embedded"
      aria-label="冲突仲裁"
    >
      <header className="workbench-conflict-dock__header parameter-file-conflict-panel__header">
        <div>
          <h3>
            冲突仲裁
            <span className="parameter-file-conflict-panel__count">
              {activeIndex + 1}/{openConflicts.length}
            </span>
          </h3>
          <p>对比基线、文件/候选值与界面草稿，等权选择一侧后确认；另一侧将被丢弃。</p>
        </div>
        <div className="workbench-conflict-dock__header-actions">
          {openConflicts.length >= 2 ? (
            <button
              type="button"
              className="button subtle"
              disabled={pending}
              onClick={() => {
                setBulkChoosing(true);
                setError("");
              }}
            >
              批量裁决
            </button>
          ) : null}
          <button
            type="button"
            className="button subtle"
            disabled={pending}
            onClick={() => onLocateConflict?.(activeConflict)}
          >
            在源码中定位
          </button>
        </div>
      </header>

      <div className="parameter-file-conflict-panel__item-header">
        <strong>{getParameterDisplayName(activeConflict)}</strong>
        <span>{activeConflict.parameterModule ?? "未归属模块"}</span>
      </div>
      {identityBits.length > 0 ? (
        <p className="workbench-conflict-dock__identity">
          {identityBits.map((bit, index) => (
            <span key={`${bit}-${index}`}>
              {index > 0 ? " · " : null}
              <code>{bit}</code>
            </span>
          ))}
        </p>
      ) : null}

      <div className="parameter-file-conflict-panel__values workbench-conflict-dock__values">
        <article data-side="base">
          <h4>基线值</h4>
          <pre>{baseMissing ? "—" : displayValue(activeConflict.baseValue)}</pre>
          {baseMissing ? <small>无基线</small> : null}
        </article>
        <article data-side="file">
          <h4>文件值</h4>
          <pre>{displayValue(activeConflict.fileValue)}</pre>
          <dl className="parameter-file-conflict-panel__provenance">
            <div>
              <dt>版本</dt>
              <dd>
                <code>{fileVersionDisplay(activeConflict)}</code>
              </dd>
            </div>
            {fileVersionTime ? (
              <div>
                <dt>版本时间</dt>
                <dd>
                  <time dateTime={activeConflict.fileVersionCreatedAt}>{fileVersionTime}</time>
                </dd>
              </div>
            ) : null}
            {activeConflict.fileName ? (
              <div>
                <dt>文件</dt>
                <dd>{activeConflict.fileName}</dd>
              </div>
            ) : null}
          </dl>
        </article>
        <article data-side="ui">
          <h4>界面草稿值</h4>
          <pre>{displayValue(activeConflict.uiDraftValue)}</pre>
          {uiDraftTime ? (
            <dl className="parameter-file-conflict-panel__provenance">
              <div>
                <dt>草稿更新</dt>
                <dd>
                  <time dateTime={activeConflict.uiDraftUpdatedAt}>{uiDraftTime}</time>
                </dd>
              </div>
            </dl>
          ) : null}
        </article>
      </div>

      {/* Symmetric emphasis: neither outcome is the safe default. */}
      <div className="parameter-file-conflict-panel__actions workbench-conflict-dock__actions">
        <button
          type="button"
          className="button"
          disabled={pending}
          onClick={() => {
            setReason("");
            setArbitration({ conflict: activeConflict, resolution: "file" });
          }}
        >
          使用文件值
        </button>
        <button
          type="button"
          className="button"
          disabled={pending}
          onClick={() => {
            setReason("");
            setArbitration({ conflict: activeConflict, resolution: "ui" });
          }}
        >
          保留界面值
        </button>
      </div>

      {error ? (
        <p className="parameter-file-conflict-panel__error" role="alert">
          {error}
        </p>
      ) : null}

      <ConfirmDialog
        open={arbitration !== null}
        title={arbitration ? OUTCOME_TITLES[arbitration.resolution] : ""}
        description={
          arbitration ? (
            <>
              <p>
                参数「{getParameterDisplayName(arbitration.conflict)}」将采用
                {RESOLUTION_LABELS[arbitration.resolution]}：
              </p>
              <pre className="parameter-file-conflict-panel__confirm-value">
                {displayValue(
                  arbitration.resolution === "file"
                    ? arbitration.conflict.fileValue
                    : arbitration.conflict.uiDraftValue
                )}
              </pre>
              <p>
                另一侧的
                {RESOLUTION_LABELS[arbitration.resolution === "file" ? "ui" : "file"]}
                会被丢弃，此操作不可撤销。
              </p>
            </>
          ) : null
        }
        extra={
          <label className="parameter-file-conflict-panel__reason">
            <span>裁决原因（记入审计，可选）</span>
            <textarea
              rows={2}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="例如：以硬件实测值为准"
            />
          </label>
        }
        confirmLabel="确认裁决"
        pendingLabel="裁决中…"
        tone="danger"
        pending={pending}
        error={error}
        onCancel={() => {
          if (!pending) {
            setArbitration(null);
            setReason("");
            setError("");
          }
        }}
        onConfirm={() => {
          void confirmResolve();
        }}
      />

      {bulkChoosing ? (
        <div className="workbench-conflict-dock__bulk-chooser" role="group" aria-label="批量裁决选项">
          <p>选择等权批量结果；预览会排除无法安全一并处理的项。</p>
          <div className="parameter-file-conflict-panel__actions workbench-conflict-dock__actions">
            <button
              type="button"
              className="button"
              disabled={pending}
              onClick={() => void startBulkPreview("file")}
            >
              批量使用文件值
            </button>
            <button
              type="button"
              className="button"
              disabled={pending}
              onClick={() => void startBulkPreview("ui")}
            >
              批量保留界面值
            </button>
            <button
              type="button"
              className="button subtle"
              disabled={pending}
              onClick={() => {
                setBulkChoosing(false);
                setError("");
              }}
            >
              取消批量
            </button>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={bulkPreview !== null}
        title={
          bulkPreview
            ? bulkPreview.resolution === "file"
              ? "批量使用文件值"
              : "批量保留界面值"
            : ""
        }
        description={
          bulkPreview ? (
            <>
              <p>
                将裁决 <strong>{bulkPreview.impact.eligibleCount}</strong>{" "}
                条合格冲突为
                {RESOLUTION_LABELS[bulkPreview.resolution]}。
              </p>
              {bulkPreview.impact.parameterNames.length > 0 ? (
                <p>参数：{bulkPreview.impact.parameterNames.join("、")}</p>
              ) : null}
              {bulkPreview.impact.ineligibleCount > 0 ? (
                <p>
                  已排除 {bulkPreview.impact.ineligibleCount}{" "}
                  条不合格冲突，不会一并处理。
                </p>
              ) : null}
              <p>另一侧草稿/文件值将被丢弃，此操作不可撤销。</p>
            </>
          ) : null
        }
        extra={
          <label className="parameter-file-conflict-panel__reason">
            <span>裁决原因（记入审计，可选）</span>
            <textarea
              rows={2}
              value={bulkReason}
              onChange={(event) => setBulkReason(event.target.value)}
              placeholder="例如：同步后统一采用文件侧"
            />
          </label>
        }
        confirmLabel="确认批量裁决"
        pendingLabel="批量裁决中…"
        tone="danger"
        pending={pending}
        error={error}
        onCancel={() => {
          if (!pending) {
            setBulkPreview(null);
            setBulkReason("");
            setError("");
          }
        }}
        onConfirm={() => {
          if (!bulkPreview || bulkPreview.impact.eligibleCount <= 0) return;
          void confirmBulkResolve();
        }}
      />
    </section>
  );
}
