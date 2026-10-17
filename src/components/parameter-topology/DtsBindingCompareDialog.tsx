import { useEffect, useMemo, useRef, useState } from "react";
import { CircleX } from "lucide-react";

import { ModalDialog } from "@/components/common/ModalDialog";
import { SelectControl } from "@/components/common/SelectControl";
import { DiffCodeBlock } from "@/components/parameter-compare/ParameterDiffViews";
import {
  buildBindingCompareOverview,
  buildBindingProjectComparison,
  bindingComparePeerDisplayLabel,
  defaultBindingCompareTargetId,
  type BindingComparePeer
} from "@/domain/parameter-topology/bindingProjectComparison";
import { formatDtsRawValueForUi, formatDtsValueForUi, isDtsEmptyValueAllowed } from "@/domain/parameter-topology/formatDtsRawValueForUi";
import type { DtsValue } from "@/domain/parameter-topology/types";
import { Button } from "@/components/ui/button";

export type DtsBindingCompareDialogProps = {
  propertyKey: string;
  baseBindingId?: string;
  baseProjectId: string;
  baseProjectName: string;
  baseRawValue: string;
  baseEffectiveValue?: DtsValue;
  embedded?: boolean;
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
  baseEffectiveValue,
  embedded = false,
  peers,
  canEdit,
  onClose,
  onUseCompareAsDraft
}: DtsBindingCompareDialogProps) {
  const [targetBindingId, setTargetBindingId] = useState<string | null>(null);
  const targetSelectRef = useRef<HTMLButtonElement | null>(null);

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
    !canEdit || !onUseCompareAsDraft || !targetRow || targetRow.valueState === "deleted" ||
    (targetRow.rawValue.trim() === "" && !isDtsEmptyValueAllowed(baseEffectiveValue));

  const content = (
          <div className="dts-binding-compare-dialog__content">
            <div className="dts-binding-compare dts-binding-compare--dialog">
              <div className="dts-binding-compare__head">
                <label className="dts-binding-compare__target">
                  <span>对比项目与配置实例</span>
                  <SelectControl
                    ref={targetSelectRef}
                    ariaLabel="对比目标配置实例"
                    value={targetBindingId ?? ""}
                    onValueChange={(value) => setTargetBindingId(value || null)}
                    options={[
                      ...(targetBindingId === null ? [{ value: "", label: "请选择配置实例" }] : []),
                      ...comparison.peers.map((peer) => ({ value: peer.comparisonKey, label: bindingComparePeerDisplayLabel(peer)
                          ? `${peer.projectName} · ${bindingComparePeerDisplayLabel(peer)}`
                          : peer.projectName }))
                    ]}
                  />
                </label>
              </div>

              {!embedded || targetRow ? <div className="dts-binding-compare__action-row">
                {targetRow ? <span>可将 {targetRow.projectName} 的当前配置作为草稿目标值</span> : null}
                <Button type="button" variant="outline" size="sm" disabled={draftFromTargetDisabled}
                  onClick={() => {
                    if (draftFromTargetDisabled || !targetRow || !onUseCompareAsDraft) return;
                    onUseCompareAsDraft({
                      rawValue: formatDtsRawValueForUi(targetRow.rawValue),
                      reason: `参考 ${targetRow.projectName} 当前配置生成草稿`
                    });
                  }}>
                  使用该项目配置加入草稿
                </Button>
              </div> : null}

              {targetRow && hasRevisionMismatch ? (
                <details aria-label="目标修订身份">
                  <summary>值的固定修订与当前有效修订不同</summary>
                  <dl>
                    <div><dt>值的固定修订</dt><dd><code>{targetRow.definitionRevisionId}</code></dd></div>
                    <div><dt>当前有效修订</dt><dd><code>{targetRow.effectiveRevisionId}</code></dd></div>
                  </dl>
                </details>
              ) : null}

              {targetRow ? (
                <article className="parameter-diff-comparison" aria-label={`${targetRow.projectName} 参数差异`}>
                  <div className="parameter-diff-summary" aria-label="基准与目标项目">
                    <div className="parameter-diff-summary__card" data-side="base">
                      <span>当前项目 · 基准值</span><strong>{comparison.baseRow.projectName}</strong>
                    </div>
                    <div className="parameter-diff-summary__connector" aria-hidden="true">→</div>
                    <div className="parameter-diff-summary__card" data-side="target">
                      <span>对比项目 · 参考值</span><strong>{targetRow.projectName}</strong>
                      <small>{bindingComparePeerDisplayLabel(targetRow)}</small>
                    </div>
                  </div>
                  <DiffCodeBlock
                    baseValue={formatDtsValueForUi(comparison.baseRow.rawValue, baseEffectiveValue)}
                    targetValue={formatDtsValueForUi(targetRow.rawValue, baseEffectiveValue, targetRow.valueState)}
                  />
                </article>
              ) : embedded && comparison.peers.length ? null : (
                <div className="parameter-diff-empty" role="status">
                  {comparison.peers.length > 0 ? "请选择要比较的配置实例" : "暂无可比较实例"}
                </div>
              )}

              <div className="dts-binding-compare__overview" aria-label="项目配置概览">
                <div className="dts-binding-compare__overview-head">
                  <h4>项目概览</h4><p className="dts-binding-compare__overview-summary">{overview.summary}</p>
                </div>
                <ul aria-label="跨项目对比">
                  {overview.groups.map((group) => (
                    <li key={group.kind} data-kind={group.kind}>
                      <span className="dts-binding-compare__overview-label">{group.label}</span>
                      <ul className="dts-binding-compare__overview-projects">
                        {group.projects.map((project) => (
                          <li key={project.comparisonKey}>
                            <button type="button" className="dts-binding-compare__overview-project-btn"
                              data-active={project.isTarget ? "true" : undefined}
                              onClick={() => setTargetBindingId(project.comparisonKey ?? project.bindingId ?? project.projectId)}>
                              <strong>{project.projectName}</strong>
                              <small title={project.displayLabel ?? undefined}>{project.displayLabel?.startsWith(`${project.projectName} · `)
                                ? project.displayLabel.slice(project.projectName.length + 3) : null}</small>
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
  );
  if (embedded) return content;

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

          {content}

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
