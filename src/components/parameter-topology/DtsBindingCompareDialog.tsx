import { useEffect, useMemo, useState } from "react";
import { CircleX } from "lucide-react";

import { DiffCodeBlock } from "@/components/parameter-compare/ParameterDiffViews";
import {
  buildBindingCompareOverview,
  buildBindingProjectComparison,
  defaultBindingCompareTargetId,
  type BindingComparePeer
} from "@/domain/parameter-topology/bindingProjectComparison";
import { formatDtsRawValueForUi } from "@/domain/parameter-topology/formatDtsRawValueForUi";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";

export type DtsBindingCompareDialogProps = {
  propertyKey: string;
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
  baseProjectId,
  baseProjectName,
  baseRawValue,
  peers,
  canEdit,
  onClose,
  onUseCompareAsDraft
}: DtsBindingCompareDialogProps) {
  const [targetProjectId, setTargetProjectId] = useState<string | null>(null);

  useEffect(() => {
    setTargetProjectId(defaultBindingCompareTargetId(peers));
  }, [peers]);

  const comparison = useMemo(
    () =>
      buildBindingProjectComparison({
        baseProjectId,
        baseProjectName,
        baseRawValue,
        peers,
        targetProjectId
      }),
    [baseProjectId, baseProjectName, baseRawValue, peers, targetProjectId]
  );

  const overview = useMemo(
    () => buildBindingCompareOverview(comparison.rows, comparison.baseRow.rawValue),
    [comparison.rows, comparison.baseRow.rawValue]
  );

  const targetRow = comparison.targetRow;
  const draftFromTargetDisabled =
    !canEdit || !onUseCompareAsDraft || !targetRow || targetRow.rawValue.trim() === "";

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        aria-label={`${propertyKey} 跨项目对比`}
        className="dts-binding-compare-dialog max-h-[calc(100vh-2rem)] w-full gap-3 sm:max-w-5xl overflow-y-auto z-[61]"
        overlayClassName="dts-binding-compare-dialog__overlay z-[60]"
        showCloseButton={false}
      >
        <DialogHeader className="dts-binding-detail-dialog__header flex-row items-center justify-between gap-2">
          <DialogTitle>{propertyKey} 跨项目对比</DialogTitle>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="关闭跨项目对比" onClick={onClose}>
            <CircleX size={22} strokeWidth={1.75} aria-hidden="true" />
          </Button>
        </DialogHeader>
        <DialogDescription className="sr-only">
          选择目标项目，查看与当前项目的参数差异，并可将其配置加入草稿。
        </DialogDescription>

        <div className="dts-binding-compare dts-binding-compare--dialog grid gap-3">
          <div className="dts-binding-compare__head">
            <label className="dts-binding-compare__target">
              <span>目标项目</span>
              <select
                aria-label="对比目标项目"
                value={targetProjectId ?? ""}
                onChange={(event) => setTargetProjectId(event.target.value || null)}
              >
                {comparison.peers.map((peer) => (
                  <option key={peer.projectId} value={peer.projectId}>
                    {peer.projectName}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="dts-binding-compare__action-row">
            <span>
              {targetRow
                ? `可将 ${targetRow.projectName} 的当前配置作为草稿目标值`
                : "目标项目尚未配置该参数"}
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
              请选择至少一个目标项目进行对比
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
                      <li key={project.projectId}>
                        <button
                          type="button"
                          className="dts-binding-compare__overview-project-btn"
                          data-active={project.isTarget ? "true" : undefined}
                          onClick={() => setTargetProjectId(project.projectId)}
                        >
                          {project.projectName}
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

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
