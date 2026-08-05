import { useEffect, useMemo, useRef, useState } from "react";
import type { ParameterFileRepository, ParameterFileSyncConflict } from "@/application/ports/ParameterFileRepository";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { ParamAdminEmptyState } from "@/components/parameter-admin-next/ParamAdminEmptyState";

type ParameterFileConflictPanelProps = {
  open: boolean;
  projectId: string;
  repository: ParameterFileRepository;
  onClose: () => void;
  onOpenConflictCountChange?: (count: number) => void;
  /** Route-embedded page mode (no modal). Default keeps legacy dialog behaviour. */
  variant?: "modal" | "embedded";
  onResolved?: (input: {
    conflictId: string;
    resolution: "file" | "ui";
    parameterName: string;
    reason: string;
  }) => void;
};

function getParameterDisplayName(conflict: ParameterFileSyncConflict) {
  if (conflict.parameterName?.trim()) {
    return conflict.parameterName;
  }
  return conflict.parameterDefinitionId;
}

const RESOLUTION_LABELS: Record<"file" | "ui", string> = {
  file: "文件值",
  ui: "界面值"
};

function formatConflictTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString("zh-CN", { hour12: false });
}

export function ParameterFileConflictPanel({
  open,
  projectId,
  repository,
  onClose,
  onOpenConflictCountChange,
  variant = "modal",
  onResolved
}: ParameterFileConflictPanelProps) {
  // Start true so the first paint after mount/open does not flash the empty state
  // before the fetch effect runs.
  const [loading, setLoading] = useState(true);
  const [resolvingConflictId, setResolvingConflictId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [conflicts, setConflicts] = useState<ParameterFileSyncConflict[]>([]);
  const [arbitration, setArbitration] = useState<{
    conflict: ParameterFileSyncConflict;
    resolution: "file" | "ui";
  } | null>(null);
  const [reason, setReason] = useState("");
  const openConflicts = useMemo(() => conflicts.filter((item) => item.status === "open"), [conflicts]);
  // Keep the count callback out of effect deps — parents often pass an inline
  // function that would otherwise re-trigger fetch → dispatch → re-render loops.
  const onOpenConflictCountChangeRef = useRef(onOpenConflictCountChange);
  onOpenConflictCountChangeRef.current = onOpenConflictCountChange;

  useEffect(() => {
    if (!open) {
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError("");
    setConflicts([]);
    repository
      .listConflicts(projectId)
      .then((items) => {
        if (cancelled) {
          return;
        }
        setConflicts(items);
        onOpenConflictCountChangeRef.current?.(items.filter((item) => item.status === "open").length);
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "冲突列表加载失败。");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [open, projectId, repository]);

  const resolveConflict = async (conflictId: string, resolution: "file" | "ui", reason: string) => {
    setResolvingConflictId(conflictId);
    setError("");
    try {
      const resolved = await repository.resolveConflict(projectId, conflictId, resolution);
      setConflicts((current) => {
        const next = current.map((item) => (item.id === conflictId ? resolved : item));
        onOpenConflictCountChangeRef.current?.(next.filter((item) => item.status === "open").length);
        return next;
      });
      onResolved?.({
        conflictId,
        resolution,
        parameterName: getParameterDisplayName(resolved),
        reason
      });
      setArbitration(null);
      setReason("");
    } catch (resolveError) {
      setError(resolveError instanceof Error ? resolveError.message : "冲突处理失败。");
    } finally {
      setResolvingConflictId(null);
    }
  };

  if (!open) {
    return null;
  }

  // Embedded in a project view the page already owns the h2, so this panel sits a level down.
  const PanelHeading = variant === "embedded" ? "h3" : "h2";
  const ValueHeading = variant === "embedded" ? "h4" : "h3";

  const body = (
    <section
      className={
        variant === "embedded"
          ? "parameter-file-conflict-panel parameter-file-conflict-panel--embedded param-admin-panel"
          : "submission-dialog parameter-file-conflict-panel"
      }
      aria-label="参数文件冲突处理"
      onClick={variant === "modal" ? (event) => event.stopPropagation() : undefined}
    >
      <header className="parameter-file-conflict-panel__header">
        <div>
          <PanelHeading>
            参数文件冲突
            {openConflicts.length > 0 ? (
              <span className="parameter-file-conflict-panel__count">{openConflicts.length}</span>
            ) : null}
          </PanelHeading>
          <p>
            文件同步与界面草稿改了同一个参数。两个取值都保留不了，选中的一侧会覆盖另一侧。
          </p>
        </div>
        {variant === "modal" ? (
          <button type="button" className="button subtle" onClick={onClose}>
            关闭
          </button>
        ) : null}
      </header>
      {loading ? <p className="parameter-file-conflict-panel__loading">冲突列表加载中…</p> : null}
      {error ? (
        <p className="parameter-file-conflict-panel__error" role="alert">
          {error}
        </p>
      ) : null}
      {!loading && !error && openConflicts.length === 0 ? (
        <ParamAdminEmptyState
          message="当前项目没有待处理冲突。"
          actionLabel={variant === "embedded" ? "前往参数文件" : undefined}
          onAction={variant === "embedded" ? onClose : undefined}
        >
          <p>文件同步与界面草稿不一致时会出现在这里。</p>
        </ParamAdminEmptyState>
      ) : null}
      {!loading && openConflicts.length > 0 ? (
        <ul className="parameter-file-conflict-panel__list" aria-label="参数文件冲突列表">
          {openConflicts.map((conflict) => {
            const isResolving = resolvingConflictId === conflict.id;
            return (
              <li key={conflict.id} className="parameter-file-conflict-panel__item">
                <div className="parameter-file-conflict-panel__item-header">
                  <strong>{getParameterDisplayName(conflict)}</strong>
                  <span>{conflict.parameterModule ?? "未归属模块"}</span>
                </div>
                <dl className="parameter-file-conflict-panel__provenance">
                  <div>
                    <dt>出现时间</dt>
                    <dd>
                      <time dateTime={conflict.createdAt}>{formatConflictTime(conflict.createdAt)}</time>
                    </dd>
                  </div>
                  <div>
                    <dt>来源文件版本</dt>
                    <dd>
                      <code>{conflict.fileVersionId}</code>
                    </dd>
                  </div>
                </dl>
                <div className="parameter-file-conflict-panel__values">
                  <article data-side="file">
                    <ValueHeading>文件值</ValueHeading>
                    <pre>{conflict.fileValue || "(空值)"}</pre>
                  </article>
                  <article data-side="ui">
                    <ValueHeading>界面值</ValueHeading>
                    <pre>{conflict.uiDraftValue || "(空值)"}</pre>
                  </article>
                </div>
                {/* Symmetric emphasis: both options discard the other side irreversibly. */}
                <div className="parameter-file-conflict-panel__actions">
                  <button
                    type="button"
                    className="button"
                    disabled={isResolving}
                    onClick={() => {
                      setReason("");
                      setArbitration({ conflict, resolution: "file" });
                    }}
                  >
                    保留文件值
                  </button>
                  <button
                    type="button"
                    className="button"
                    disabled={isResolving}
                    onClick={() => {
                      setReason("");
                      setArbitration({ conflict, resolution: "ui" });
                    }}
                  >
                    保留界面值
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}

      <ConfirmDialog
        open={arbitration !== null}
        title={arbitration ? `保留${RESOLUTION_LABELS[arbitration.resolution]}` : ""}
        description={
          arbitration ? (
            <>
              <p>
                参数「{getParameterDisplayName(arbitration.conflict)}」将采用
                {RESOLUTION_LABELS[arbitration.resolution]}：
              </p>
              <pre className="parameter-file-conflict-panel__confirm-value">
                {(arbitration.resolution === "file"
                  ? arbitration.conflict.fileValue
                  : arbitration.conflict.uiDraftValue) || "(空值)"}
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
        pending={arbitration !== null && resolvingConflictId === arbitration.conflict.id}
        onCancel={() => {
          if (!resolvingConflictId) {
            setArbitration(null);
            setReason("");
          }
        }}
        onConfirm={() => {
          if (arbitration) {
            void resolveConflict(arbitration.conflict.id, arbitration.resolution, reason.trim());
          }
        }}
      />
    </section>
  );

  if (variant === "embedded") {
    return body;
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="参数文件冲突处理" onClick={onClose}>
      {body}
    </div>
  );
}
