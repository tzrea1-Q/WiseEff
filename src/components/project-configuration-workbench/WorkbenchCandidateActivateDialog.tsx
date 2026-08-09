import type { ConfigSetRole } from "@/application/ports/DtsStructuredRepository";
import type { ParameterFileCandidate } from "@/application/ports/ParameterFileRepository";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";

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
      title="确认激活候选"
      description={
        <div>
          <p>
            将把候选 <code>{activeCandidate?.fileName}</code> 晋升为工作配置的活跃版本。此操作会改变后续基线可发布内容。
          </p>
          <ul>
            <li>
              对照活跃版本：{" "}
              <code className="mono">{activeCandidate?.baseVersionId ?? "新文件（无基）"}</code>
            </li>
            <li>结构差异：{(activeCandidate?.impact.structuralDiff?.length ?? 0) || 0} 项</li>
            <li>
              覆盖/映射：
              {activeCandidate?.impact.coverage
                ? `已注册 ${activeCandidate.impact.coverage.matchedRegisteredCount} · 未注册 ${activeCandidate.impact.coverage.newUnregisteredCount}`
                : "不适用"}
            </li>
            <li>阻断：{(activeCandidate?.blockers?.length ?? 0) === 0 ? "无" : activeCandidate?.blockers.length}</li>
          </ul>
          {activeCandidate?.impact.textDiff ? (
            <pre className="configuration-workbench__diff-view mono" tabIndex={0}>
              {activeCandidate.impact.textDiff}
            </pre>
          ) : null}
        </div>
      }
      confirmLabel="确认激活"
      tone="primary"
      pending={activating}
      pendingLabel="激活中…"
      error={activateError}
      acknowledgement="我已审查影响范围，并确认对照的是当前活跃基版本。"
      extra={
        !activeCandidate?.fileId ? (
          <label className="configuration-workbench__activate-role">
            <span>新文件成员角色</span>
            <select
              value={activateRole}
              disabled={activating}
              onChange={(event) => onActivateRoleChange(event.target.value as ConfigSetRole)}
            >
              {(Object.keys(ROLE_LABELS) as ConfigSetRole[]).map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABELS[role]}
                </option>
              ))}
            </select>
            <small>将加入配置集 {configSetName ?? "（未选择）"}，不会隐式创建其他成员关系。</small>
          </label>
        ) : null
      }
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}
