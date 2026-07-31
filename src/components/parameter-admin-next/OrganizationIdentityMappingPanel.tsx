import { useCallback, useEffect, useState } from "react";
import type { IdentityMappingTask, ResolveMappingInput } from "@/domain/parameter-topology/types";
import { IdentityMappingReview } from "@/components/parameter-topology/IdentityMappingReview";
import { useParameterAdmin } from "./ParameterAdminProvider";

/**
 * Organization-scoped identity mapping task governance.
 * Composes IdentityMappingReview for organization-scoped governance in `/parameter-admin`.
 */
export function OrganizationIdentityMappingPanel() {
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
      const openCount = next.filter((task) => task.status === "open").length;
      dispatch({ type: "SET_QUEUE_COUNTS", counts: { identityMapping: openCount } });
    } catch (loadError) {
      setTasks([]);
      dispatch({ type: "SET_QUEUE_COUNTS", counts: { identityMapping: 0 } });
      setError(loadError instanceof Error ? loadError.message : "无法加载节点对应任务。");
    } finally {
      setLoading(false);
    }
  }, [application, dispatch]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleResolve = useCallback(
    async (taskId: string, input: ResolveMappingInput) => {
      setError(null);
      try {
        await application.resolveMapping(taskId, input);
        dispatch({
          type: "PUSH_AUDIT_HINT",
          hint: {
            kind:
              input.decision === "dismissed"
                ? "identity-mapping-dismissed"
                : input.decision === "new-identity"
                  ? "identity-mapping-new-identity"
                  : "identity-mapping-resolved",
            summary:
              input.decision === "dismissed"
                ? `已驳回节点对应任务 ${taskId}`
                : input.decision === "new-identity"
                  ? `已声明新身份（任务 ${taskId}）`
                  : `已确认节点对应 ${input.selectedLogicalNodeId ?? taskId}`,
            reason: input.reason,
            recordedAt: new Date().toISOString()
          }
        });
        await reload();
      } catch (resolveError) {
        setError(resolveError instanceof Error ? resolveError.message : "节点对应确认失败。");
      }
    },
    [application, dispatch, reload]
  );

  const openTasks = tasks.filter((task) => task.status === "open");

  return (
    <section className="param-admin-main param-admin-governance-card" aria-label="节点对应确认">
      <div className="parameters-table-heading">
        <div>
          <h2>节点对应确认</h2>
          <p>确认迁移期未能自动对齐的参数节点对应关系。待处理 {state.queueCounts.identityMapping}。</p>
        </div>
      </div>
      {loading && openTasks.length === 0 ? <p className="form-hint">正在加载节点对应任务…</p> : null}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {!loading && openTasks.length === 0 ? (
        <p className="form-hint" role="status">
          当前没有待处理的节点对应任务。
        </p>
      ) : (
        <IdentityMappingReview tasks={tasks} onResolve={handleResolve} />
      )}
    </section>
  );
}
