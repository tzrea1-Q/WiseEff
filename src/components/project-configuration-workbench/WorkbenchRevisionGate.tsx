import type { ConfigRevisionStatus } from "@/domain/parameter-topology/types";
import {
  presentRevisionValidation,
  type ConfigRevisionGateSnapshot
} from "@/application/project-configuration/configRevisionGateSession";

const STATUS_LABELS: Record<ConfigRevisionStatus, string> = {
  draft: "草稿",
  resolving: "解析中",
  needs_mapping: "待节点对应",
  invalid: "无效",
  resolved: "已解析",
  validated: "已校验",
  validation_failed: "校验失败",
  compiled: "已编译",
  pending_approval: "待审批"
};

export function configRevisionOptionLabel(revisionNumber: number, status: ConfigRevisionStatus): string {
  return `修订 ${revisionNumber} · ${STATUS_LABELS[status]}`;
}

export type WorkbenchRevisionGateProps = {
  snapshot: ConfigRevisionGateSnapshot;
  canAdmin: boolean;
  onSelect: (revisionId: string) => void;
  onValidate: () => void;
  onRetry: () => void;
};

export function WorkbenchRevisionGate({
  snapshot,
  canAdmin,
  onSelect,
  onValidate,
  onRetry
}: WorkbenchRevisionGateProps) {
  const presented = presentRevisionValidation(snapshot.lastRun);
  const empty = !snapshot.loading && snapshot.revisions.length === 0 && !snapshot.error;
  const validateDisabledReason = !canAdmin
    ? "仅管理员可以校验配置修订。"
    : snapshot.loading
      ? "配置修订仍在加载。"
      : snapshot.validating
        ? "正在校验配置修订。"
        : !snapshot.selectedRevisionId
          ? "请先选择配置修订。"
          : undefined;
  const validateDisabled = Boolean(validateDisabledReason);

  return (
    <section className="configuration-workbench__revision-gate" aria-label="配置修订门禁">
      <header className="configuration-workbench__revision-gate-header">
        <strong>配置修订</strong>
        {snapshot.loading ? <span role="status">加载中…</span> : null}
      </header>

      {snapshot.error ? (
        <p role="alert">
          {snapshot.error}
          <button className="button subtle" type="button" onClick={onRetry}>
            重试
          </button>
        </p>
      ) : null}

      {empty ? (
        <p role="status">尚未生成配置修订。请先在项目管理中上传 DTS 以触发 ingest。</p>
      ) : (
        <label>
          <span>配置修订</span>
          <select
            aria-label="配置修订"
            value={snapshot.selectedRevisionId ?? ""}
            disabled={snapshot.loading || snapshot.revisions.length === 0}
            onChange={(event) => {
              if (event.target.value) onSelect(event.target.value);
            }}
          >
            {snapshot.revisions.length === 0 ? <option value="">暂无配置修订</option> : null}
            {snapshot.revisions.map((revision) => (
              <option key={revision.id} value={revision.id}>
                {configRevisionOptionLabel(revision.revisionNumber, revision.status)}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="configuration-workbench__revision-gate-actions">
        <button
          className="button subtle"
          type="button"
          disabled={validateDisabled}
          title={validateDisabledReason}
          onClick={onValidate}
        >
          {snapshot.validating ? "校验中…" : "校验修订"}
        </button>
      </div>

      {snapshot.actionError ? <p role="alert">{snapshot.actionError}</p> : null}
      {presented ? (
        <p role="status" data-tone={presented.tone}>
          {presented.summary}
        </p>
      ) : null}
    </section>
  );
}
