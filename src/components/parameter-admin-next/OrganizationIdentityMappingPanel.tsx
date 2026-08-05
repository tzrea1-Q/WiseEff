import { useCallback, useEffect, useState } from "react";
import type {
  IdentityMappingTask,
  ReopenMappingInput,
  ResolveMappingInput
} from "@/domain/parameter-topology/types";
import { IdentityMappingReview } from "@/components/parameter-topology/IdentityMappingReview";
import { PARAMETER_ADMIN_UI } from "@/application/parameters/parameterAdminUiCopy";
import { ParamAdminEmptyState } from "./ParamAdminEmptyState";
import { useParameterAdmin } from "./ParameterAdminProvider";
import { useRefreshParameterAdminRecentAudits } from "./useRefreshParameterAdminRecentAudits";

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
  const refreshRecentAudits = useRefreshParameterAdminRecentAudits();
  const [tasks, setTasks] = useState<IdentityMappingTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await application.listMappingTasks();
      setTasks(next);
      const openCount = next.filter((task) => task.status === "open").length;
      const historyCount = next.filter((task) => task.status !== "open").length;
      dispatch({ type: "SET_QUEUE_COUNTS", counts: { identityMapping: openCount } });
      onTasksLoaded?.({ openCount, historyCount });
    } catch (loadError) {
      setTasks([]);
      // IA-R2: do not overwrite a known open count with zero on transient failure.
      setError(
        loadError instanceof Error ? loadError.message : PARAMETER_ADMIN_UI.identityMappingLoadError
      );
    } finally {
      setLoading(false);
    }
  }, [application, dispatch, onTasksLoaded]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleResolve = useCallback(
    async (taskId: string, input: ResolveMappingInput) => {
      setError(null);
      try {
        await application.resolveMapping(taskId, input);
        await refreshRecentAudits();
        await reload();
      } catch (resolveError) {
        setError(
          resolveError instanceof Error
            ? resolveError.message
            : PARAMETER_ADMIN_UI.identityMappingResolveError
        );
      }
    },
    [application, refreshRecentAudits, reload]
  );

  const handleReopen = useCallback(
    async (taskId: string, input: ReopenMappingInput) => {
      setError(null);
      try {
        await application.reopenMapping(taskId, input);
        await refreshRecentAudits();
        await reload();
      } catch (reopenError) {
        setError(reopenError instanceof Error ? reopenError.message : "重新打开节点对应任务失败。");
      }
    },
    [application, refreshRecentAudits, reload]
  );

  const openTasks = tasks.filter((task) => task.status === "open");
  const historyTasks = tasks.filter((task) => task.status !== "open");

  return (
    <section className="param-admin-main param-admin-governance-card" aria-label="节点对应确认">
      <div className="parameters-table-heading">
        <div>
          <h2>{PARAMETER_ADMIN_UI.identityMapping}</h2>
          <p>
            {PARAMETER_ADMIN_UI.identityMappingBlurb} 待处理 {state.queueCounts.identityMapping}。
          </p>
        </div>
      </div>
      {loading && openTasks.length === 0 && historyTasks.length === 0 ? (
        <p className="form-hint">{PARAMETER_ADMIN_UI.identityMappingLoading}</p>
      ) : null}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {!loading && openTasks.length === 0 && historyTasks.length === 0 ? (
        <ParamAdminEmptyState message={PARAMETER_ADMIN_UI.identityMappingEmpty}>
          <p>导入或同步项目 DTS 后，未能自动对齐的节点会出现在这里。</p>
        </ParamAdminEmptyState>
      ) : (
        <IdentityMappingReview tasks={tasks} onResolve={handleResolve} onReopen={handleReopen} />
      )}
    </section>
  );
}
