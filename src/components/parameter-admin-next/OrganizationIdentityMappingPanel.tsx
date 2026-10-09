import { useCallback, useEffect, useState } from "react";
import type { IdentityMappingTask } from "@/domain/parameter-topology/types";
import { presentError } from "@/infrastructure/http/presentError";
import { IdentityMappingReview } from "@/components/parameter-topology/IdentityMappingReview";
import { PARAMETER_ADMIN_UI } from "@/application/parameters/parameterAdminUiCopy";
import { ParamAdminEmptyState } from "./ParamAdminEmptyState";
import { useParameterAdmin } from "./ParameterAdminProvider";

export type OrganizationIdentityMappingPanelProps = {
  /** Sync open/history counts into the parent specs shell after each successful load. */
  onTasksLoaded?: (counts: { openCount: number; historyCount: number }) => void;
};

/**
 * Organization-scoped identity mapping task governance.
 * Nested under `/parameter-admin/specs/identity-mapping` (ADR-0015).
 */
export function OrganizationIdentityMappingPanel({
  onTasksLoaded
}: OrganizationIdentityMappingPanelProps = {}) {
  const { application, dispatch, state } = useParameterAdmin();
  const [tasks, setTasks] = useState<IdentityMappingTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await application.listMappingTasks();
      setTasks(next);
      const openCount = next.filter((task) => task.status === "open" || task.status === "dismissed").length;
      const historyCount = next.length - openCount;
      dispatch({ type: "SET_QUEUE_COUNTS", counts: { identityMapping: openCount } });
      onTasksLoaded?.({ openCount, historyCount });
    } catch (loadError) {
      setTasks([]);
      // IA-R2: do not overwrite a known open count with zero on transient failure.
      setError(presentError(loadError, PARAMETER_ADMIN_UI.identityMappingLoadError));
    } finally {
      setLoading(false);
    }
  }, [application, dispatch, onTasksLoaded]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const openTasks = tasks.filter((task) => task.status === "open");
  const historyTasks = tasks.filter((task) => task.status !== "open");

  return (
    <section className="param-admin-main param-admin-governance-card" aria-label="节点对应确认">
      <div className="parameters-table-heading">
        <div>
          <h2>{PARAMETER_ADMIN_UI.identityMapping}</h2>
          <p>
            历史节点对应证据。未决 {state.queueCounts.identityMapping}。
          </p>
        </div>
      </div>
      <p className="form-hint" role="status">
        历史节点对应任务仅作为只读证据保留。没有精确等价项的连续性选择不会自动迁移为审核项。
        未决任务需要在规范审核队列中作出决定，不会按名称自动对应。
      </p>
      <a className="button subtle" href="/parameter-admin/specs?review=open">
        打开规范审核队列
      </a>
      {loading && openTasks.length === 0 && historyTasks.length === 0 ? (
        <p className="form-hint">{PARAMETER_ADMIN_UI.identityMappingLoading}</p>
      ) : null}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {!loading && !error && openTasks.length === 0 && historyTasks.length === 0 ? (
        <ParamAdminEmptyState message={PARAMETER_ADMIN_UI.identityMappingEmpty}>
          <p>新的未知或歧义证据请前往规范审核队列查看。</p>
        </ParamAdminEmptyState>
      ) : (
        <IdentityMappingReview tasks={tasks} />
      )}
    </section>
  );
}
