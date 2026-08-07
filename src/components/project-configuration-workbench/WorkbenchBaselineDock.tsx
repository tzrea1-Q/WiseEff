import { useMemo } from "react";

import type {
  DtsBaselineMemberComparison,
  DtsReleaseBaseline,
  DtsRestorePreviewMember
} from "@/application/ports/DtsStructuredRepository";

export type WorkbenchBaselineIdentity = "draft" | "released" | "historical";

export function workbenchBaselineIdentity(
  baseline: DtsReleaseBaseline,
  releasedTipId: string | undefined
): WorkbenchBaselineIdentity {
  if (baseline.status === "draft") return "draft";
  if (baseline.status === "historical") return "historical";
  if (baseline.status === "released" && releasedTipId && baseline.id !== releasedTipId) {
    return "historical";
  }
  if (baseline.status === "released") return "released";
  return "historical";
}

export function workbenchBaselineIdentityLabel(identity: WorkbenchBaselineIdentity): string {
  switch (identity) {
    case "draft":
      return "草稿";
    case "released":
      return "已发布";
    case "historical":
      return "历史";
  }
}

export type WorkbenchBaselineDockProps = {
  baselines: DtsReleaseBaseline[];
  releasedTipId?: string;
  selectedBaselineId: string | null;
  loading?: boolean;
  error?: string;
  compareMembers?: DtsBaselineMemberComparison[] | null;
  compareAgainst?: "working" | "released";
  pinnedMembers?: Array<{ fileId: string; fileVersionId: string; versionNumber: number }>;
  canAdmin: boolean;
  canRelease: boolean;
  canRestore: boolean;
  releaseBlockedReason?: string;
  onSelectBaseline: (baselineId: string) => void;
  onRetry?: () => void;
  onCompare: (against: "working" | "released") => void;
  onOpenRelease: () => void;
  onOpenRestore: () => void;
  onExitCompare: () => void;
  onSelectCompareMember?: (member: DtsBaselineMemberComparison) => void;
  comparing?: boolean;
};

export function WorkbenchBaselineDock({
  baselines,
  releasedTipId,
  selectedBaselineId,
  loading,
  error,
  compareMembers,
  compareAgainst,
  pinnedMembers,
  canAdmin,
  canRelease,
  canRestore,
  releaseBlockedReason,
  onSelectBaseline,
  onRetry,
  onCompare,
  onOpenRelease,
  onOpenRestore,
  onExitCompare,
  onSelectCompareMember,
  comparing
}: WorkbenchBaselineDockProps) {
  const selected = useMemo(
    () => baselines.find((item) => item.id === selectedBaselineId) ?? null,
    [baselines, selectedBaselineId]
  );
  const identity = selected ? workbenchBaselineIdentity(selected, releasedTipId) : null;

  return (
    <section className="configuration-workbench__baseline-dock" aria-label="发布基线">
      <header className="configuration-workbench__baseline-dock-header">
        <strong>发布基线</strong>
        {loading ? <span role="status">加载中…</span> : null}
        {error ? (
          <span role="alert">
            {error}
            {onRetry ? (
              <button className="button subtle" type="button" onClick={onRetry}>
                重试
              </button>
            ) : null}
          </span>
        ) : null}
      </header>

      {baselines.length === 0 && !loading ? (
        <p role="status">尚无基线。就绪后可从命令栏创建草稿快照。</p>
      ) : (
        <ul className="configuration-workbench__baseline-list" aria-label="基线历史">
          {baselines.map((baseline) => {
            const itemIdentity = workbenchBaselineIdentity(baseline, releasedTipId);
            return (
              <li key={baseline.id}>
                <button
                  type="button"
                  className="button subtle configuration-workbench__baseline-item"
                  aria-pressed={baseline.id === selectedBaselineId}
                  data-baseline-id={baseline.id}
                  data-baseline-identity={itemIdentity}
                  onClick={() => onSelectBaseline(baseline.id)}
                >
                  <span>{baseline.name}</span>
                  <span>{workbenchBaselineIdentityLabel(itemIdentity)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {selected ? (
        <div className="configuration-workbench__baseline-detail" aria-label="基线详情">
          <p>
            <strong>{selected.name}</strong> · {identity ? workbenchBaselineIdentityLabel(identity) : ""}
          </p>
          {pinnedMembers && pinnedMembers.length > 0 ? (
            <ul aria-label="钉住的成员版本">
              {pinnedMembers.map((member) => (
                <li key={member.fileId}>
                  {member.fileId} · v{member.versionNumber}
                </li>
              ))}
            </ul>
          ) : null}
          {canAdmin ? (
            <div className="configuration-workbench__baseline-actions" aria-label="基线操作">
              <button
                className="button subtle"
                type="button"
                disabled={comparing}
                onClick={() => onCompare("working")}
              >
                对比 Working
              </button>
              <button
                className="button subtle"
                type="button"
                disabled={comparing || !releasedTipId}
                title={!releasedTipId ? "尚无已发布 tip，无法对比 released" : undefined}
                onClick={() => onCompare("released")}
              >
                对比 Released
              </button>
              {identity === "draft" ? (
                <button
                  className="button subtle"
                  type="button"
                  disabled={!canRelease}
                  title={releaseBlockedReason}
                  onClick={onOpenRelease}
                >
                  发布
                </button>
              ) : null}
              {identity === "released" || identity === "historical" ? (
                <button
                  className="button subtle"
                  type="button"
                  disabled={!canRestore}
                  onClick={onOpenRestore}
                >
                  恢复
                </button>
              ) : null}
              {comparing ? (
                <button className="button subtle" type="button" onClick={onExitCompare}>
                  退出对比
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {compareMembers ? (
        <div className="configuration-workbench__baseline-compare" aria-label="基线对比结果">
          <p role="status">
            对比目标：{compareAgainst === "released" ? "已发布 tip" : "Working"}
          </p>
          <ul aria-label="成员差异">
            {compareMembers.map((member) => (
              <li key={member.fileId}>
                <button
                  type="button"
                  className="button subtle"
                  disabled={!onSelectCompareMember || member.status === "unchanged"}
                  onClick={() => onSelectCompareMember?.(member)}
                >
                  {member.fileName ?? member.fileId} · {member.status}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

export function formatRestorePreviewDescription(
  baselineName: string,
  members: DtsRestorePreviewMember[],
  releasedBaselineUnchanged: boolean
) {
  const drifted = members.filter((item) => item.action === "rollback-pointer");
  return (
    <div>
      <p>
        将把 Working 配置恢复到基线「{baselineName}」钉住的成员版本。仅漂移成员会新建
        origin=rollback 指针版本。
      </p>
      <p role="status">
        影响范围：{drifted.length} 个漂移成员
        {releasedBaselineUnchanged ? "；当前已发布 tip 保持不变。" : ""}
      </p>
      {drifted.length > 0 ? (
        <ul aria-label="恢复 blast radius">
          {drifted.map((item) => (
            <li key={item.fileId}>
              {item.fileName ?? item.fileId}: {item.fromVersionId ?? "无"} → {item.toVersionId} (v
              {item.toVersionNumber})
            </li>
          ))}
        </ul>
      ) : (
        <p>所有成员已对齐，恢复不会写入新版本。</p>
      )}
    </div>
  );
}
