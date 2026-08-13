import { CircleX } from "lucide-react";

import { ModalDialog } from "@/components/common/ModalDialog";
import type { RecomputeBindingModulesResult } from "@/application/ports/ParameterModuleRegistryRepository";

export type RecomputeBindingsResultDialogProps = {
  result: RecomputeBindingModulesResult;
  onClose: () => void;
};

/**
 * Ops report after full-org module-binding recompute.
 */
export function RecomputeBindingsResultDialog({
  result,
  onClose
}: RecomputeBindingsResultDialogProps) {
  const conflictCount = result.conflicts.length;
  const hasConflicts = conflictCount > 0;
  const preview = result.preview;
  const title = result.dryRun ? "全量重算预览" : "全量重算结果";

  return (
    <ModalDialog
      open
      onDismiss={onClose}
      className="submission-dialog param-admin-module-edit-dialog recompute-bindings-result-dialog"
      backdropClassName="param-admin-modal-backdrop"
    >
      {({ titleId }) => (
        <>
        <div className="submission-dialog-head param-admin-editor-dialog-head">
          <div className="param-admin-editor-dialog-head-text">
            <span className="eyebrow">运维工具</span>
            <h2 id={titleId}>{title}</h2>
            <p>
              {result.dryRun
                ? "本次为预览，未写入数据库。确认影响范围后再执行正式全量重算。"
                : "已按当前归属规则重新解析项目参数的模块归属，并写入审计。"}
            </p>
          </div>
          <button type="button" className="audit-dialog-close-icon" onClick={onClose} aria-label="关闭">
            <CircleX size={22} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>

        <div className="param-admin-module-edit-body recompute-bindings-result-dialog__body">
          <dl className="recompute-bindings-result-dialog__stats">
            <div>
              <dt>更新的项目参数</dt>
              <dd>
                <strong>{result.updated}</strong>
                <span>个</span>
              </dd>
            </div>
            <div>
              <dt>冲突</dt>
              <dd>
                <strong className={hasConflicts ? "is-danger" : undefined}>{conflictCount}</strong>
                <span>项</span>
              </dd>
            </div>
          </dl>

          {result.updated === 0 && !hasConflicts ? (
            <p className="muted recompute-bindings-result-dialog__empty">
              没有项目参数需要改写模块归属。若刚调整了规则，请确认映射已保存，或检查是否已按范围应用过归类。
            </p>
          ) : null}

          {preview && preview.byProject.length > 0 ? (
            <section aria-labelledby="recompute-by-project-title">
              <h3 id="recompute-by-project-title">按项目分布</h3>
              <ul className="recompute-bindings-result-dialog__projects">
                {preview.byProject.map((row) => (
                  <li key={row.projectId}>
                    <code>{row.projectId}</code>
                    <span>{row.count} 个参数</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {hasConflicts ? (
            <section aria-labelledby="recompute-conflicts-title">
              <h3 id="recompute-conflicts-title">冲突明细</h3>
              <ul className="recompute-bindings-result-dialog__conflicts">
                {result.conflicts.map((conflict) => (
                  <li key={conflict}>
                    <code>{conflict}</code>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>

        <div className="dialog-actions">
          <button className="button primary" type="button" onClick={onClose}>
            知道了
          </button>
        </div>
        </>
      )}
    </ModalDialog>
  );
}
