import type { ReactNode } from "react";
import { SectionEmpty } from "@/components/common/SectionState";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/admin";
import { OverviewPage, OverviewTile } from "@/components/layout/OverviewPage";
import { formatBytes } from "@/domain/format/formatBytes";
import { formatLogDateTime } from "@/domain/format/formatDateTime";
import type { LogFeedbackInsight, LogRecord, TimeWindow } from "@/domain/logs/types";
import { deriveMetrics } from "@/logAdminAnalytics";
import { presentErrorMessage } from "@/infrastructure/http/presentError";

export type OverviewRecordFilter =
  | { kind: "degraded" }
  | { kind: "generic" }
  | { kind: "skill"; id: string | undefined }
  | { kind: "failure"; reason?: string }
  | { kind: "review" };

export function matchesOverviewFilter(log: LogRecord, filter: OverviewRecordFilter | null): boolean {
  if (!filter) return true;
  switch (filter.kind) {
    case "degraded": return log.status === "Complete" && log.analysisSource === "rules-fallback";
    case "generic": return !log.logDomainId;
    case "skill": return log.logDomainId === filter.id;
    case "failure": return log.status === "Failed" && (!filter.reason || failureReason(log) === filter.reason);
    case "review": return log.status === "Complete" && log.confidence > 0 && log.confidence < 90;
  }
}

const sourceNames: Record<string, string> = { upload: "手动上传", api: "接口接入", integration: "集成接入", agent: "智能助手", device: "设备采集" };
const recordName = (log: LogRecord) => log.fileName.trim() || log.reportId || "未命名文件";
const sourceName = (log: LogRecord) => sourceNames[log.source] ?? "其他来源";
const failureReason = (log: LogRecord) => presentErrorMessage(log.failureReason, "未记录可识别的失败原因");
const delta = (value: number | null, suffix: string) => value === null ? "—" : `${value >= 0 ? "+" : ""}${value}${suffix}`;
const share = (count: number, total: number) => total > 0 ? `${Math.round(count / total * 100)}%` : "—";

export function LogAdminOverview({ logs, allLogs, timeWindow, feedback, feedbackLoading, feedbackUnavailable, controls, onViewRecords }: {
  logs: LogRecord[];
  allLogs: LogRecord[];
  timeWindow: TimeWindow;
  feedback: LogFeedbackInsight[];
  feedbackLoading: boolean;
  feedbackUnavailable: boolean;
  controls: ReactNode;
  onViewRecords: (filter: OverviewRecordFilter | null) => void;
}) {
  const metrics = deriveMetrics(logs, timeWindow, allLogs);
  const complete = logs.filter((log) => log.status === "Complete");
  const quality = complete.filter((log) => log.confidence > 0);
  const review = quality.filter((log) => log.confidence < 90);
  const degraded = complete.filter((log) => log.analysisSource === "rules-fallback");
  const generic = logs.filter((log) => !log.logDomainId);
  const failures = logs.filter((log) => log.status === "Failed");
  const reasons = new Map<string, number>();
  for (const log of failures) {
    const reason = failureReason(log);
    reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
  }
  // ponytail: per-skill scans of the already-loaded record list; use a single-pass map if tenant volumes make this costly.
  const skills = Array.from(new Set(logs.map((log) => log.logDomainId))).map((id) => {
    const records = logs.filter((log) => log.logDomainId === id);
    const rows = feedback.filter((row) => (row.logDomainId ?? undefined) === id);
    const count = rows.reduce((sum, row) => sum + row.totalCount, 0);
    return { id, name: id ? records[0].logDomainName || "未命名技能" : "通用分析", volume: records.length,
      helpful: share(rows.reduce((sum, row) => sum + row.helpfulCount, 0), count), feedbackCount: count };
  });
  const stalled = logs.filter((log) => log.status === "Processing" && Date.now() - Date.parse(log.updatedAtIso) > 10 * 60_000);

  return <section aria-label="日志概览" data-testid="log-admin-overview" aria-busy={feedbackLoading} className="flex flex-col gap-4">
    <div className="flex flex-wrap items-center justify-between gap-2">{controls}</div>
    <OverviewPage label="日志分析概览" summary={logs.length > 0 ? <dl className="overview-page__tiles">
        <OverviewTile label="分析总量" value={<span data-testid="overview-total">{logs.length}</span>} hasSamples
          trend={timeWindow === "today" ? `较昨日 ${delta(metrics.todayCount.trendPct, "%")}` : undefined} />
        <OverviewTile label="平均置信度" value={<span data-testid="overview-confidence">{quality.length > 0 ? `${metrics.avgConfidence.value}%` : "—"}</span>} hasSamples
          trend={timeWindow === "today" ? `较昨日 ${delta(metrics.avgConfidence.trendPct, " 点")}` : undefined} />
        <OverviewTile label="失败文件" value={<span data-testid="overview-failed">{failures.length}</span>} hasSamples />
        <div role="group" aria-label="分析状态拆分" className="overview-tile" data-has-samples="true">
          <dt className="overview-tile__label">处理状态</dt><dd className="text-sm">完成 <strong>{complete.length}</strong> / 处理中 <strong>{logs.length - complete.length - failures.length}</strong> / 失败 <strong>{failures.length}</strong></dd>
          <dd className="text-sm">{failures.length ? "存在失败记录，请查看失败原因。" : stalled.length ? `${stalled.length} 条分析超过 10 分钟未完成。` : "处理队列稳定"}</dd>
        </div>
      </dl> : undefined}>
    {logs.length === 0 ? <div data-testid="log-admin-overview-empty" className="col-span-full"><SectionEmpty message="当前时间窗口内暂无日志" /></div> : <>
        <article aria-label="降级到规则" className="rounded-lg border border-border bg-card p-4">
          <h2 className="text-base font-semibold">降级到规则</h2><p className="text-2xl font-semibold">{share(degraded.length, complete.length)}</p>
          <p className="text-sm text-muted-foreground">{degraded.length} / {complete.length} 份已完成分析</p>
          {degraded.length > 0 && degraded.length / complete.length >= 0.5 ? <p role="alert" className="mt-2 rounded-md border border-destructive p-2 text-sm text-destructive">当前窗口至少一半的已完成分析已降级到规则，请检查 AI 服务可用性与调用额度。</p> : null}
          <Button variant="link" onClick={() => onViewRecords({ kind: "degraded" })}>查看降级记录</Button>
        </article>
        <article aria-label="通用分析占比" className="rounded-lg border border-border bg-card p-4">
          <h2 className="text-base font-semibold">通用分析占比</h2><p className="text-2xl font-semibold">{share(generic.length, logs.length)}</p>
          <p className="text-sm text-muted-foreground">{generic.length} / {logs.length} 份日志未使用专用技能。</p>
          <Button variant="link" onClick={() => onViewRecords({ kind: "generic" })}>查看通用分析记录</Button>
        </article>
        <article aria-label="技能使用与反馈" className="min-w-0 rounded-lg border border-border bg-card p-4">
          <h2 className="mb-2 text-base font-semibold">技能使用与反馈</h2>
          <DataTable aria-label="技能分析量与有帮助率" rows={skills} rowKey={(row) => row.id ?? "generic"} pageSize={6} columns={[
            { key: "name", header: "技能", render: (row) => <Button variant="link" onClick={() => onViewRecords({ kind: "skill", id: row.id })}>{row.name}</Button> },
            { key: "volume", header: "分析量", render: (row) => row.volume, align: "right" },
            { key: "helpful", header: "有帮助率", render: (row) => <span title={feedbackUnavailable || feedbackLoading ? undefined : `${row.feedbackCount} 条反馈`}>{feedbackLoading ? "加载中…" : feedbackUnavailable ? "暂不可用" : row.helpful}</span>, align: "right" }
          ]} />
          <p role={feedbackUnavailable ? "alert" : undefined} className="mt-2 text-xs text-muted-foreground">{feedbackUnavailable ? "反馈数据暂不可用，请刷新重试。" : "有帮助率按当前窗口收到的反馈统计；无反馈时显示 —。"}</p>
        </article>
        <article aria-label="失败原因" className="rounded-lg border border-border bg-card p-4">
          <h2 className="text-base font-semibold">失败原因</h2>
          {reasons.size ? <ul>{Array.from(reasons).sort((a, b) => b[1] - a[1]).map(([reason, count]) => <li key={reason} className="flex items-center justify-between gap-2">
            <Button variant="link" className="h-auto whitespace-normal text-left" onClick={() => onViewRecords({ kind: "failure", reason })}>{reason}</Button><span className="shrink-0">{count} 份</span>
          </li>)}</ul> : <p className="text-sm text-muted-foreground">当前窗口无失败记录。</p>}
          <ul aria-label="失败记录">{failures.slice(0, 3).map((log) => <li key={log.id} className="mt-2 text-sm">
            <Button variant="link" onClick={() => onViewRecords({ kind: "failure" })}>{recordName(log)}</Button>
            <p className="text-xs text-muted-foreground">{sourceName(log)} · {formatBytes(log.fileSizeMB * 1024 ** 2)} · {formatLogDateTime(log.updatedAtIso)}</p>
          </li>)}</ul>
        </article>
      <section aria-label="置信度复核队列" className="col-span-full rounded-lg border border-border bg-card p-4">
        <h2 className="text-base font-semibold">复核队列</h2>
        {review.length ? <><ul>{review.slice(0, 3).map((log) => <li key={log.id} className="text-sm">{recordName(log)} · {sourceName(log)} · {log.confidence}%</li>)}</ul>
          <Button variant="link" onClick={() => onViewRecords({ kind: "review" })}>查看待复核记录</Button></> : <p className="text-sm text-muted-foreground">{quality.length ? "当前窗口无低置信度样本。" : "当前窗口尚无已完成的置信度样本。"}</p>}
      </section>
    </>}
    </OverviewPage>
  </section>;
}
