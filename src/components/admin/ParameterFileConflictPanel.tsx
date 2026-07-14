import { useEffect, useMemo, useState } from "react";
import type { ParameterFileSyncConflict } from "@/application/ports/ParameterFileRepository";
import { createParameterFileClient } from "@/infrastructure/http/parameterFileClient";

type ParameterFileConflictPanelProps = {
  open: boolean;
  projectId: string;
  runtimeMode?: "api" | "mock";
  onClose: () => void;
  onOpenConflictCountChange?: (count: number) => void;
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
  runtimeMode = "mock",
  onClose,
  onOpenConflictCountChange
}: ParameterFileConflictPanelProps) {
  const client = useMemo(() => createParameterFileClient(), []);
  const [loading, setLoading] = useState(false);
  const [resolvingConflictId, setResolvingConflictId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [conflicts, setConflicts] = useState<ParameterFileSyncConflict[]>([]);
  const isApiMode = runtimeMode === "api";
  const openConflicts = useMemo(() => conflicts.filter((item) => item.status === "open"), [conflicts]);

  useEffect(() => {
    if (!open || !isApiMode) {
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError("");
    client.listConflicts(projectId)
      .then((items) => {
        if (cancelled) {
          return;
        }
        setConflicts(items);
        onOpenConflictCountChange?.(items.filter((item) => item.status === "open").length);
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
  }, [client, isApiMode, onOpenConflictCountChange, open, projectId]);

  const resolveConflict = async (conflictId: string, resolution: "file" | "ui") => {
    setResolvingConflictId(conflictId);
    setError("");
    try {
      const resolved = await client.resolveConflict(projectId, conflictId, resolution);
      setConflicts((current) => {
        const next = current.map((item) => (item.id === conflictId ? resolved : item));
        onOpenConflictCountChange?.(next.filter((item) => item.status === "open").length);
        return next;
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

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="参数文件冲突处理" onClick={onClose}>
      <section className="submission-dialog parameter-file-conflict-panel" onClick={(event) => event.stopPropagation()}>
        <header className="parameter-file-conflict-panel__header">
          <div>
            <h2>参数文件冲突</h2>
            <p>处理文件同步与界面草稿并发修改产生的冲突。</p>
          </div>
          <button type="button" className="button subtle" onClick={onClose}>
            关闭
          </button>
        </header>
        {!isApiMode ? (
          <p className="parameter-file-conflict-panel__placeholder">Mock 模式不提供冲突列表，请切换到 API 模式。</p>
        ) : (
          <>
            {loading ? <p className="parameter-file-conflict-panel__loading">冲突列表加载中…</p> : null}
            {error ? (
              <p className="parameter-file-conflict-panel__error" role="alert">
                {error}
              </p>
            ) : null}
            {!loading && openConflicts.length === 0 ? (
              <p className="parameter-file-conflict-panel__empty">当前项目没有待处理冲突。</p>
            ) : null}
            {openConflicts.length > 0 ? (
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
          </>
        )}
      </section>
    </div>
  );
}
