import { useEffect, useMemo, useRef, useState } from "react";
import type { ParameterFileRepository, ParameterFileSyncConflict } from "@/application/ports/ParameterFileRepository";
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
  }) => void;
};

function getParameterDisplayName(conflict: ParameterFileSyncConflict) {
  if (conflict.parameterName?.trim()) {
    return conflict.parameterName;
  }
  return conflict.parameterDefinitionId;
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

  const resolveConflict = async (conflictId: string, resolution: "file" | "ui") => {
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
        parameterName: getParameterDisplayName(resolved)
      });
    } catch (resolveError) {
      setError(resolveError instanceof Error ? resolveError.message : "冲突处理失败。");
    } finally {
      setResolvingConflictId(null);
    }
  };

  if (!open) {
    return null;
  }

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
          <h2>参数文件冲突</h2>
          <p>处理文件同步与界面草稿并发修改产生的冲突。</p>
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
                <div className="parameter-file-conflict-panel__values">
                  <article>
                    <h3>文件值</h3>
                    <pre>{conflict.fileValue || "(空值)"}</pre>
                  </article>
                  <article>
                    <h3>界面值</h3>
                    <pre>{conflict.uiDraftValue || "(空值)"}</pre>
                  </article>
                </div>
                <div className="parameter-file-conflict-panel__actions">
                  <button
                    type="button"
                    className="button subtle"
                    disabled={isResolving}
                    onClick={() => {
                      void resolveConflict(conflict.id, "file");
                    }}
                  >
                    保留文件值
                  </button>
                  <button
                    type="button"
                    className="button primary"
                    disabled={isResolving}
                    onClick={() => {
                      void resolveConflict(conflict.id, "ui");
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
