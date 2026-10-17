import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatAbsolute } from "@/domain/format/formatDateTime";

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
      return "未定版";
    case "released":
      return "正式版本";
    case "historical":
      return "历史版本";
  }
}

export type WorkbenchBaselineDockProps = {
  baselines: DtsReleaseBaseline[];
  releasedTipId?: string;
  selectedBaselineId: string | null;
  loading?: boolean;
  error?: string;
  /** Failure from the latest baseline command (compare / restore preview…). */
  actionError?: string;
  compareMembers?: DtsBaselineMemberComparison[] | null;
  compareAgainst?: "working" | "released";
  pinnedMembers?: Array<{ fileId: string; fileVersionId: string; versionNumber: number }>;
  pinnedMembersLoading?: boolean;
  pinnedMembersError?: string;
  onRetryMembers?: () => void;
  fileNames?: Record<string, string>;
  restoreReadOnly?: boolean;
  canAdmin: boolean;
  canRelease: boolean;
  canPreviewRestore: boolean;
  releaseBlockedReason?: string;
  onSelectBaseline: (baselineId: string) => void;
  onRetry?: () => void;
  onCompare: (against: "working" | "released") => void;
  onOpenRelease: () => void;
  onOpenRestore: () => void;
  onSelectCompareMember?: (member: DtsBaselineMemberComparison) => void;
  comparing?: boolean;
};

export function WorkbenchBaselineDock({
  baselines,
  releasedTipId,
  selectedBaselineId,
  loading,
  error,
  actionError,
  compareMembers,
  compareAgainst,
  pinnedMembers,
  pinnedMembersLoading = false,
  pinnedMembersError = "",
  onRetryMembers,
  fileNames,
  restoreReadOnly = false,
  canAdmin,
  canRelease,
  canPreviewRestore,
  releaseBlockedReason,
  onSelectBaseline,
  onRetry,
  onCompare,
  onOpenRelease,
  onOpenRestore,
  onSelectCompareMember,
  comparing
}: WorkbenchBaselineDockProps) {
  const selected = useMemo(
    () => !loading && !error ? baselines.find((item) => item.id === selectedBaselineId) ?? null : null,
    [baselines, selectedBaselineId, loading, error]
  );
  const identity = selected ? workbenchBaselineIdentity(selected, releasedTipId) : null;

  const changedCount = compareMembers?.filter((member) => member.status !== "unchanged").length ?? 0;
  return (
    <section className="configuration-workbench__baseline-dock" aria-label="配置版本列表与详情">
      <div className="configuration-versions__history">
        <h3>已保存版本</h3>
        {loading ? <p role="status">正在加载配置版本…</p> : null}
        {error ? <div role="alert"><p>{error}</p>{onRetry ? <Button size="sm" variant="outline" onClick={onRetry}>重新加载</Button> : null}</div> : null}
        {!loading && !error && baselines.length === 0 ? <p className="configuration-versions__empty">尚未保存版本快照。</p> : null}
        <ul className="configuration-workbench__baseline-list" aria-label="配置版本历史">
          {!loading && !error ? baselines.map((baseline) => {
            const itemIdentity = workbenchBaselineIdentity(baseline, releasedTipId);
            return <li key={baseline.id}>
              <button type="button" className="configuration-workbench__baseline-item"
                aria-pressed={baseline.id === selectedBaselineId} data-baseline-id={baseline.id}
                data-baseline-identity={itemIdentity} onClick={() => onSelectBaseline(baseline.id)}>
                <span className="configuration-versions__version-name">{baseline.name}</span>
                <span className={`configuration-versions__badge is-${itemIdentity}`}>{workbenchBaselineIdentityLabel(itemIdentity)}</span>
                <time dateTime={baseline.createdAt}>{formatAbsolute(baseline.createdAt)}</time>
              </button>
            </li>;
          }) : null}
        </ul>
      </div>
      <div className="configuration-versions__detail" aria-label="配置版本详情">
        {actionError ? <p role="alert">{actionError}</p> : null}
        {selected ? <>
          <header className="configuration-versions__detail-head">
            <div><h3>{selected.name}</h3><p>保存时固定的文件版本</p></div>
            {canAdmin && identity === "draft" ? <Button size="sm" disabled={!canRelease} title={releaseBlockedReason} onClick={onOpenRelease}>设为正式版本</Button> : null}
          </header>
          {pinnedMembersLoading ? <p role="status">正在读取快照文件…</p>
            : pinnedMembersError ? <div role="alert"><p>{pinnedMembersError}</p>{onRetryMembers ? <Button size="sm" variant="outline" onClick={onRetryMembers}>重试读取文件</Button> : null}</div>
            : pinnedMembers?.length ? <Table className="configuration-versions__files" aria-label="快照中的文件版本">
              <TableHeader><TableRow><TableHead>文件</TableHead><TableHead>固定版本</TableHead></TableRow></TableHeader>
              <TableBody>{pinnedMembers.map((member) => <TableRow key={member.fileId}>
                <TableCell>{fileNames?.[member.fileId] ?? member.fileId}</TableCell><TableCell>v{member.versionNumber}</TableCell>
              </TableRow>)}</TableBody>
            </Table> : <p className="configuration-versions__empty">此快照未记录文件。</p>}
          {canAdmin ? <div className="configuration-workbench__baseline-actions" aria-label="配置版本操作">
            <Button size="sm" variant="outline" disabled={comparing} onClick={() => onCompare("working")}>对比当前配置</Button>
            {(identity === "released" || identity === "historical") && !restoreReadOnly ? <Button size="sm" variant="outline" disabled={!canPreviewRestore} onClick={onOpenRestore}>恢复到此版本…</Button> : null}
          </div> : null}
          {canAdmin && restoreReadOnly && (identity === "released" || identity === "historical") ? <p className="configuration-versions__recovery" role="note">需要回退时，请在文件管理的版本历史中申请回滚审核。</p> : null}
          {compareMembers ? <section className="configuration-workbench__baseline-compare" aria-label="配置版本对比结果">
            <h4>{compareAgainst === "released" ? "与正式版本的差异" : "与当前配置的差异"}</h4>
            <p role="status">{changedCount ? `${changedCount} 个文件发生变化` : "文件版本一致，无需查看差异。"}</p>
            <ul aria-label="文件差异">{compareMembers.map((member) => {
              const label = <>{member.fileName ?? fileNames?.[member.fileId] ?? member.fileId}<span>{{ unchanged: "无变化", version_changed: "版本变化", file_added: "新增文件", file_removed: "移除文件" }[member.status]}</span></>;
              return <li key={member.fileId}>{onSelectCompareMember && member.status !== "unchanged" && member.baselineVersionId
                ? <Button size="sm" variant="ghost" onClick={() => onSelectCompareMember(member)}>{label}</Button> : <div>{label}</div>}</li>;
            })}</ul>
          </section> : null}
        </> : !loading && !error ? <div className="configuration-versions__empty-detail"><h3>{baselines.length ? "选择一个配置版本" : "保存整套配置的版本组合"}</h3><p>{baselines.length ? "查看快照中的文件版本，或与当前配置对比。" : "将当前各文件的版本一起保存，作为验收和后续追溯的依据。"}</p></div> : null}
      </div>
    </section>
  );
}

export function formatRestorePreviewDescription(
  baselineName: string,
  members: DtsRestorePreviewMember[],
  releasedBaselineUnchanged: boolean,
  readOnly = false
) {
  const drifted = members.filter((item) => item.action === "rollback-pointer");
  return (
    <div>
      <p>
        {readOnly
          ? `版本快照「${baselineName}」与当前配置的差异，仅供查看。`
          : `将把当前配置恢复到快照「${baselineName}」记录的文件版本，仅为有差异的文件创建回滚版本。`}
      </p>
      <p role="status">
        影响范围：{drifted.length} 个文件
        {releasedBaselineUnchanged ? "；当前正式版本保持不变。" : ""}
      </p>
      {drifted.length > 0 ? (
        <ul aria-label="恢复影响范围">
          {drifted.map((item) => (
            <li key={item.fileId}>
              {item.fileName ?? item.fileId}：{item.fromVersionNumber ? `v${item.fromVersionNumber}` : "无当前版本"} → v{item.toVersionNumber}
              <details><summary>版本标识</summary>{item.fromVersionId ?? "无"} → {item.toVersionId}</details>
            </li>
          ))}
        </ul>
      ) : (
        <p>{readOnly ? "所有文件已对齐。" : "所有文件已对齐，恢复不会写入新版本。"}</p>
      )}
    </div>
  );
}
