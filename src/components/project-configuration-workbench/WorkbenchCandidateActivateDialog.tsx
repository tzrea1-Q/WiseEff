import { SelectControl } from "@/components/common/SelectControl";
import type { ConfigSetRole } from "@/application/ports/DtsStructuredRepository";
import type { ParameterFileCandidate } from "@/application/ports/ParameterFileRepository";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { ReviewProvenance } from "@/features/parameter-review/ReviewProvenance";

const ROLE_LABELS: Record<ConfigSetRole, string> = {
  base: "基础",
  overlay: "覆盖层",
  charging: "充电",
  thermal: "温控",
  misc: "其他"
};

export type WorkbenchCandidateActivateDialogProps = {
  open: boolean;
  activeCandidate: ParameterFileCandidate | null;
  configSetName: string | null;
  activateRole: ConfigSetRole;
  onActivateRoleChange: (role: ConfigSetRole) => void;
  activating: boolean;
  activateError: string;
  onCancel: () => void;
  onConfirm: () => void;
};

export function WorkbenchCandidateActivateDialog({
  open,
  activeCandidate,
  configSetName,
  activateRole,
  onActivateRoleChange,
  activating,
  activateError,
  onCancel,
  onConfirm
}: WorkbenchCandidateActivateDialogProps) {
  return (
    <ConfirmDialog
      open={open && activeCandidate?.status === "ready"}
      className="workbench-candidate-activate-dialog"
      title="确认应用来源更新"
      description={
        <div>
          <p>
            将 <code>{activeCandidate?.fileName}</code> 设为工作配置的当前版本，后续创建的基线将包含此版本。
          </p>
          <ul>
            <li>结构差异：{(activeCandidate?.impact.structuralDiff?.length ?? 0) || 0} 项</li>
            <li>
              覆盖/映射：
              {activeCandidate?.impact.coverage
                ? `已注册 ${activeCandidate.impact.coverage.matchedRegisteredCount} · 未注册 ${activeCandidate.impact.coverage.newUnregisteredCount}`
                : "不适用"}
            </li>
            {activeCandidate?.blockers.length ? <li>待解决问题：{activeCandidate.blockers.length} 项</li> : null}
          </ul>
          {activeCandidate?.impact.textDiff ? (
            <pre className="configuration-workbench__diff mono" aria-label="激活候选文本差异" tabIndex={0 /* eslint-disable-line jsx-a11y/no-noninteractive-tabindex -- This overflowing diff scrollport must support keyboard scrolling. */}>
              {activeCandidate.impact.textDiff}
            </pre>
          ) : null}
          <ReviewProvenance entries={[{ label: "候选版本", value: activeCandidate }, { label: "目标配置", value: configSetName }, { label: "文件用途", value: activateRole }]} />
        </div>
      }
      confirmLabel="确认应用"
      tone="primary"
      pending={activating}
      pendingLabel="应用中…"
      error={activateError}
      acknowledgement="我已审查影响范围，并确认对照的是当前活跃基版本。"
      extra={
        !activeCandidate?.fileId ? (
          <label className="configuration-workbench__activate-role">
            <span>新文件用途</span>
            <SelectControl
              value={activateRole}
              disabled={activating}
              onValueChange={(value) => onActivateRoleChange(value as ConfigSetRole)}
              ariaLabel="新文件用途"
              options={(Object.keys(ROLE_LABELS) as ConfigSetRole[]).map((role) => ({ value: role, label: ROLE_LABELS[role] }))}
            />
            <small>将加入配置 {configSetName ?? "（未选择）"}。</small>
          </label>
        ) : null
      }
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}
