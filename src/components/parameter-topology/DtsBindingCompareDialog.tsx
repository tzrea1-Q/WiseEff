import { useEffect, useMemo, useRef, useState } from "react";
import { CircleX } from "lucide-react";

import { ModalDialog } from "@/components/common/ModalDialog";
import { DiffCodeBlock } from "@/components/parameter-compare/ParameterDiffViews";
import {
  buildBindingCompareOverview,
  buildBindingProjectComparison,
  bindingComparePeerDisplayLabel,
  defaultBindingCompareTargetId,
  type BindingComparePeer
} from "@/domain/parameter-topology/bindingProjectComparison";
import { formatDtsRawValueForUi } from "@/domain/parameter-topology/formatDtsRawValueForUi";
import { Button } from "@/components/ui/button";

export type DtsBindingCompareDialogProps = {
  propertyKey: string;
  baseBindingId?: string;
  baseProjectId: string;
  baseProjectName: string;
  baseRawValue: string;
  peers: readonly BindingComparePeer[];
  canEdit: boolean;
  onClose: () => void;
  onUseCompareAsDraft?: (input: { rawValue: string; reason: string }) => void;
};

export function DtsBindingCompareDialog({
  propertyKey,
  baseBindingId,
  baseProjectId,
  baseProjectName,
  baseRawValue,
  peers,
  canEdit,
  onClose,
  onUseCompareAsDraft
}: DtsBindingCompareDialogProps) {
  const [targetBindingId, setTargetBindingId] = useState<string | null>(null);
  const targetSelectRef = useRef<HTMLSelectElement | null>(null);

  useEffect(() => {
    setTargetBindingId(defaultBindingCompareTargetId(peers));
  }, [peers]);

  const comparison = useMemo(
    () =>
      buildBindingProjectComparison({
        baseProjectId,
        baseProjectName,
        baseRawValue,
        peers,
        baseBindingId,
        targetBindingId
      }),
    [baseBindingId, baseProjectId, baseProjectName, baseRawValue, peers, targetBindingId]
  );

  const overview = useMemo(
    () => buildBindingCompareOverview(comparison.rows, comparison.baseRow.rawValue),
    [comparison.rows, comparison.baseRow.rawValue]
  );

  const targetRow = comparison.targetRow;
  const hasRevisionMismatch = Boolean(
    targetRow?.definitionRevisionId &&
    targetRow.effectiveRevisionId &&
    targetRow.definitionRevisionId !== targetRow.effectiveRevisionId
  );
  const draftFromTargetDisabled =
    !canEdit || !onUseCompareAsDraft || !targetRow || targetRow.rawValue.trim() === "";

  return (
    <ModalDialog
      open
      onDismiss={onClose}
      className="dts-binding-compare-dialog"
      backdropClassName="dts-binding-compare-dialog__overlay"
      describedBy
      initialFocusRef={targetSelectRef}
    >
      {({ titleId, descriptionId }) => (
        <>
          <div className="dts-binding-compare-dialog__header">
            <div>
              <h2 id={titleId}>{propertyKey} 跨项目对比</h2>
              <p id={descriptionId} className="sr-only">
                选择要比较的配置实例，查看与当前项目的参数差异，并可将其配置加入草稿。
              </p>
            </div>
            <Button type="button" variant="ghost" size="icon-sm" aria-label="关闭跨项目对比" onClick={onClose}>
              <CircleX size={22} strokeWidth={1.75} aria-hidden="true" />
            </Button>
          </div>

          <div className="dts-binding-compare-dialog__content">
            <div className="dts-binding-compare dts-binding-compare--dialog">
              <div className="dts-binding-compare__head">
                <label className="dts-binding-compare__target">
                  <span>目标配置实例</span>
                  <select
                    ref={targetSelectRef}
                    aria-label="对比目标配置实例"
                    value={targetBindingId ?? ""}
                    onChange={(event) => setTargetBindingId(event.target.value || null)}
                  >
                    {targetBindingId === null ? <option value="">请选择配置实例</option> : null}
                    {comparison.peers.map((peer) => (
                      <option key={peer.comparisonKey} value={peer.comparisonKey}>
                        {bindingComparePeerDisplayLabel(peer)
                          ? `${peer.projectName} · ${bindingComparePeerDisplayLabel(peer)}`
                          : peer.projectName}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="dts-binding-compare__action-row">
                <span>
                  {targetRow
                    ? `可将 ${targetRow.projectName} 的当前配置作为草稿目标值`
                    : comparison.peers.length > 0
                      ? "请选择要比较的配置实例"
                      : "暂无可比较实例"}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={draftFromTargetDisabled}
                  onClick={() => {
                    if (!targetRow || !onUseCompareAsDraft) return;
                    onUseCompareAsDraft({
                      rawValue: formatDtsRawValueForUi(targetRow.rawValue) || targetRow.rawValue,
                      reason: `参考 ${targetRow.projectName} 当前配置生成草稿`
                    });
                  }}
                >
                  使用该项目配置加入草稿
                </Button>
              </div>

              {targetRow && hasRevisionMismatch ? (
                <section aria-label="目标修订身份">
                  <p role="status">值的固定修订与当前有效修订不同</p>
                  <dl>
                    <div>
                      <dt>值的固定修订</dt>
                      <dd><code>{targetRow.definitionRevisionId}</code></dd>
                    </div>
                    <div>
                      <dt>当前有效修订</dt>
                      <dd><code>{targetRow.effectiveRevisionId}</code></dd>
                    </div>
                  </dl>
                </section>
              ) : null}

              {targetRow ? (
                <article
                  className="parameter-diff-comparison"
                  aria-label={`${targetRow.projectName} 参数差异`}
                >
                  <div className="parameter-diff-summary" aria-label="基准与目标项目">
                    <div className="parameter-diff-summary__card" data-side="base">
                      <span>基准项目</span>
                      <strong>{comparison.baseRow.projectName}</strong>
                    </div>
                    <div className="parameter-diff-summary__connector" aria-hidden="true">
                      →
                    </div>
                    <div className="parameter-diff-summary__card" data-side="target">
                      <span>目标项目</span>
                      <strong>{targetRow.projectName}</strong>
                    </div>
                  </div>
                  <DiffCodeBlock
                    baseValue={formatDtsRawValueForUi(comparison.baseRow.rawValue) || comparison.baseRow.rawValue}
                    targetValue={formatDtsRawValueForUi(targetRow.rawValue) || targetRow.rawValue}
                  />
                </article>
              ) : (
                <div className="parameter-diff-empty" role="status">
                  {comparison.peers.length > 0 ? "请选择要比较的配置实例" : "暂无可比较实例"}
                </div>
              )}

              <div className="dts-binding-compare__overview" aria-label="项目配置概览">
                <div className="dts-binding-compare__overview-head">
                  <h4>项目概览</h4>
                  <p className="dts-binding-compare__overview-summary">{overview.summary}</p>
                </div>
                <ul aria-label="跨项目对比">
                  {overview.groups.map((group) => (
                    <li key={group.kind} data-kind={group.kind}>
                      <span className="dts-binding-compare__overview-label">{group.label}</span>
                      <ul className="dts-binding-compare__overview-projects">
                        {group.projects.map((project) => (
                          <li key={project.comparisonKey}>
                            <button
                              type="button"
                              className="dts-binding-compare__overview-project-btn"
                              data-active={project.isTarget ? "true" : undefined}
                              onClick={() => setTargetBindingId(project.comparisonKey ?? project.bindingId ?? project.projectId)}
                            >
                              {project.displayLabel ?? project.projectName}
                              {project.isTarget ? <em>目标</em> : null}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>

          <div className="dts-binding-compare-dialog__footer">
            <Button type="button" variant="outline" onClick={onClose}>
              关闭
            </Button>
          </div>
        </>
      )}
    </ModalDialog>
  );
}
