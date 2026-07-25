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
      setError(loadError instanceof Error ? loadError.message : "无法加载身份映射任务。");
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
                : "identity-mapping-resolved",
            summary:
              input.decision === "dismissed"
                ? `已驳回身份映射任务 ${taskId}`
                : `已确认身份映射 ${input.selectedLogicalNodeId ?? taskId}`,
            reason: input.reason,
            recordedAt: new Date().toISOString()
          }
        });
        await reload();
      } catch (resolveError) {
        setError(resolveError instanceof Error ? resolveError.message : "身份映射决议失败。");
      }
    },
    [application, dispatch, reload]
  );

  const openTasks = tasks.filter((task) => task.status === "open");

  return (
    <section className="param-admin-main" aria-label="身份映射治理">
      <div className="parameters-table-heading">
        <div>
          <h2>身份映射治理</h2>
          <p>决议迁移期未能自动对齐的参数身份。待处理 {state.queueCounts.identityMapping}。</p>
        </div>
      </div>
      {loading && openTasks.length === 0 ? <p className="form-hint">正在加载身份映射任务…</p> : null}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {!loading && openTasks.length === 0 ? (
        <p className="form-hint" role="status">
          当前没有待处理的身份映射任务。
        </p>
      ) : (
        <IdentityMappingReview tasks={tasks} onResolve={handleResolve} />
      )}
    </section>
  );
}
