import { useTopBarActions } from "@/components/layout";
import { applyTimeWindow, deriveMetrics, isSparseSparkline } from "@/logAdminAnalytics";
import { STAGE_LABELS, type LogRecord, type PrototypeState } from "@/domain/prototype/types";
import { AlertTriangle, CheckCircle2, FileText, Info } from "lucide-react";
import { useMemo, type CSSProperties } from "react";

export function LogDashboardPage({ state, onNavigate }: { state: PrototypeState; onNavigate: (path: string) => void }) {
  const visibleLogs = useMemo(
    () => state.logs.filter((log) => !state.archivedLogIds.includes(log.id)),
    [state.archivedLogIds, state.logs]
  );
  const todayLogs = useMemo(() => applyTimeWindow(visibleLogs, "today"), [visibleLogs]);
  const metrics = useMemo(() => deriveMetrics(todayLogs, "today", visibleLogs), [todayLogs, visibleLogs]);
  const sortedByUpdate = useMemo(
    () => [...todayLogs].sort((a, b) => Date.parse(b.updatedAtIso) - Date.parse(a.updatedAtIso)),
    [todayLogs]
  );
  const sortedBySize = useMemo(() => [...todayLogs].sort((a, b) => b.fileSizeMB - a.fileSizeMB), [todayLogs]);
  const completeCount = todayLogs.filter((log) => log.status === "Complete").length;
  const processingCount = todayLogs.filter((log) => log.status === "Processing").length;
  const failedLogs = todayLogs.filter((log) => log.status === "Failed");
  const lowConfidenceLogs = todayLogs.filter((log) => log.status !== "Failed" && log.confidence > 0 && log.confidence < 90);
  const confidenceLogs = todayLogs.filter((log) => log.status !== "Failed" && log.confidence > 0);
  const totalCount = Math.max(todayLogs.length, 1);
  const statusSegments = [
    { label: "完成", value: completeCount, percent: Math.round((completeCount / totalCount) * 100), className: "is-complete" },
    { label: "处理中", value: processingCount, percent: Math.round((processingCount / totalCount) * 100), className: "is-processing" },
    { label: "失败", value: failedLogs.length, percent: Math.round((failedLogs.length / totalCount) * 100), className: "is-failed" }
  ];
  const qualityBands = [
    { label: "高置信", value: confidenceLogs.filter((log) => log.confidence >= 90).length, className: "is-strong" },
    { label: "需复核", value: confidenceLogs.filter((log) => log.confidence >= 80 && log.confidence < 90).length, className: "is-watch" },
    { label: "低置信", value: confidenceLogs.filter((log) => log.confidence > 0 && log.confidence < 80).length, className: "is-risk" }
  ];
  const totalFileSize = todayLogs.reduce((sum, log) => sum + log.fileSizeMB, 0);
  const latestLog = sortedByUpdate[0];
  const qualityFloor = confidenceLogs.length > 0 ? Math.min(...confidenceLogs.map((log) => log.confidence)) : 0;
  const peakShare = totalFileSize > 0 ? Math.round((metrics.throughputPeak.sizeMB / totalFileSize) * 100) : 0;
  const formatSize = (sizeMB: number) => (sizeMB >= 100 ? `${(sizeMB / 1024).toFixed(1)}GB` : `${sizeMB.toFixed(1)}MB`);
  const compactLogLabel = (log?: LogRecord) => (log ? `${log.reportId} · ${log.source}` : "暂无样本");
  const reviewQueue = (lowConfidenceLogs.length > 0 ? lowConfidenceLogs : confidenceLogs).slice(0, 2);
  const peakLog = sortedBySize[0];
  const trendDateLabels = Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - (6 - index));
    return `${date.getMonth() + 1}月${date.getDate()}日`;
  });
  const trendSampleSparse = isSparseSparkline(metrics.todayCount.sparkline);
  // The queue verdict is earned from real failure / stuck-processing counts,
  // never asserted unconditionally.
  const stalledProcessingLogs = todayLogs.filter(
    (log) => log.status === "Processing" && Date.now() - Date.parse(log.updatedAtIso) > 10 * 60_000
  );
  const queueJudgement =
    failedLogs.length > 0
      ? {
          tone: "risk" as const,
          headline: `${failedLogs.length} 条失败待处理`,
          detail: `今日覆盖 ${totalCount} 份日志，其中 ${failedLogs.length} 份解析失败，请优先处理失败记录。`
        }
      : stalledProcessingLogs.length > 0
        ? {
            tone: "risk" as const,
            headline: `${stalledProcessingLogs.length} 条分析滞留`,
            detail: `今日覆盖 ${totalCount} 份日志，${stalledProcessingLogs.length} 份分析超过 10 分钟未完成。`
          }
        : {
            tone: "ok" as const,
            headline: "处理队列稳定",
            detail: `今日覆盖 ${totalCount} 份日志，最新样本 ${compactLogLabel(latestLog)} 已进入看板监控。`
          };
  const topActions = Array.from(
    new Set(
      [...failedLogs, ...lowConfidenceLogs, ...sortedByUpdate]
        .flatMap((log) => log.suggestedActions)
        .filter(Boolean)
    )
  ).slice(0, 3);
  useTopBarActions(
    <>
      <button className="button subtle" type="button" onClick={() => onNavigate("/log-admin")}>
        查看管理后台
      </button>
      <button className="button primary" type="button" onClick={() => onNavigate("/logs")}>
        进入智能分析
      </button>
    </>,
    [onNavigate]
  );

  return (
    <div className="log-dashboard-page">
      <section className="log-dashboard-topic-grid" aria-label="日志分析核心指标">
        <article className="log-dashboard-topic-card topic-throughput" aria-label="今日分析">
          <div className="topic-card-head">
            <div>
              <span>处理节奏</span>
              <h2>今日分析</h2>
            </div>
            <div className="topic-primary-metric">
              <strong>{metrics.todayCount.value}</strong>
              <span>份</span>
            </div>
          </div>

          <div className={`topic-decision-panel${queueJudgement.tone === "risk" ? " is-risk" : ""}`}>
            {queueJudgement.tone === "risk" ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}
            <div>
              <span>关键判断</span>
              <strong>{queueJudgement.headline}</strong>
              <p>{queueJudgement.detail}</p>
            </div>
          </div>

          <div className="topic-evidence-grid">
            <section className="topic-evidence-block">
              <div className="topic-section-head">
                <strong>趋势洞察</strong>
                <span>较昨日 {metrics.todayCount.trendPct >= 0 ? "+" : ""}{metrics.todayCount.trendPct}%</span>
              </div>
              <div className="topic-line-chart" aria-hidden="true">
                {metrics.todayCount.sparkline.map((value, index) => (
                  <span className="topic-line-chart__bar" key={`${value}-${index}`}>
                    <strong className="topic-line-chart__value">{value}</strong>
                    <i style={{ height: `${Math.max(8, value * 10)}px` }} />
                    <small className="topic-line-chart__time">{trendDateLabels[index] ?? ""}</small>
                  </span>
                ))}
              </div>
              {trendSampleSparse ? (
                <p className="topic-trend-note" role="note">样本不足，趋势仅供参考。</p>
              ) : null}
            </section>

            <section className="topic-evidence-block">
              <div className="topic-section-head">
                <strong>状态构成</strong>
                <span>{completeCount} 完成 / {processingCount} 处理中 / {failedLogs.length} 失败</span>
              </div>
              <div className="topic-stack-bar" aria-hidden="true">
                {statusSegments.map((item) => (
                  <i key={item.label} className={item.className} style={{ width: `${Math.max(8, item.percent)}%` }} />
                ))}
              </div>
              <div className="topic-segmented-summary" aria-label="今日状态拆分">
                {statusSegments.map((item) => (
                  <div key={item.label}>
                    <span>{item.label}</span>
                    <strong>{item.value}</strong>
                  </div>
                ))}
              </div>
            </section>
          </div>

        </article>

        <article className="log-dashboard-topic-card topic-confidence" aria-label="平均置信度">
          <div className="topic-card-head">
            <div>
              <span>完成质量</span>
              <h2>平均置信度</h2>
            </div>
            <div className="topic-primary-metric">
              <strong>{metrics.avgConfidence.value}</strong>
              <span>%</span>
            </div>
          </div>

          <div className="topic-decision-panel is-quality">
            <Info size={18} />
            <div>
              <span>关键判断</span>
              <strong>{lowConfidenceLogs.length > 0 ? "存在复核样本" : "质量表现稳定"}</strong>
              <p>平均置信度 {metrics.avgConfidence.value}%，最低样本 {qualityFloor}%，较昨日 {metrics.avgConfidence.trendPct >= 0 ? "+" : ""}{metrics.avgConfidence.trendPct} pts。</p>
            </div>
          </div>

          <div className="topic-evidence-grid">
            <section className="topic-evidence-block">
              <div className="topic-section-head">
                <strong>质量分布</strong>
                <span>{lowConfidenceLogs.length} 份需关注</span>
              </div>
              <div className="topic-quality-panel">
                <div className="topic-score-meter" style={{ "--score": `${metrics.avgConfidence.value}%` } as CSSProperties}>
                  <span />
                  <strong>{metrics.avgConfidence.value}%</strong>
                </div>
                <div className="topic-quality-bands">
                  {qualityBands.map((band) => (
                    <div key={band.label}>
                      <span>{band.label}</span>
                      <i className={band.className} style={{ width: `${Math.max(8, (band.value / Math.max(confidenceLogs.length, 1)) * 100)}%` }} />
                      <strong>{band.value}</strong>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <section className="topic-evidence-block">
              <div className="topic-section-head">
                <strong>复核队列</strong>
                <span>{reviewQueue.length} 份样本</span>
              </div>
              <div className="topic-review-queue" aria-label="置信度复核队列">
                {reviewQueue.map((log) => (
                  <div key={log.id}>
                    <span>{compactLogLabel(log)}</span>
                    <strong>{log.confidence}%</strong>
                    <p>{log.conclusion}</p>
                  </div>
                ))}
              </div>
            </section>
          </div>

        </article>

        <article className="log-dashboard-topic-card topic-failures" aria-label="失败文件">
          <div className="topic-card-head">
            <div>
              <span>失败影响</span>
              <h2>失败文件</h2>
            </div>
            <div className="topic-primary-metric">
              <strong>{metrics.failedCount.value}</strong>
              <span>份</span>
            </div>
          </div>

          <div className="topic-decision-panel is-risk">
            <AlertTriangle size={18} />
            <div>
              <span>关键判断</span>
              <strong>{failedLogs.length > 0 ? "需要人工介入" : "无需人工介入"}</strong>
              <p>{failedLogs[0]?.failureReason ?? "所有日志均进入正常分析流程。"}</p>
            </div>
          </div>

          <div className="topic-evidence-grid">
            <section className="topic-evidence-block">
              <div className="topic-section-head">
                <strong>失败记录</strong>
                <span>{failedLogs[0]?.reportId ?? "无失败记录"}</span>
              </div>
              <div className="topic-failure-record">
                <span>{compactLogLabel(failedLogs[0])}</span>
                <strong>{failedLogs[0]?.stage ? STAGE_LABELS[failedLogs[0].stage] : "当前队列正常"}</strong>
                <p>{failedLogs[0]?.source ?? "解析流程未发现阻断项"}</p>
              </div>
            </section>

            <section className="topic-evidence-block">
              <div className="topic-section-head">
                <strong>建议动作</strong>
                <span>按优先级处理</span>
              </div>
              <ol className="topic-action-list" aria-label="失败处理建议">
                {(topActions.length > 0 ? topActions : ["继续监控上传格式", "保留失败原件以便复查"]).map((action, index) => (
                  <li key={action}>
                    <span>{index + 1}</span>
                    {action}
                  </li>
                ))}
              </ol>
            </section>
          </div>

        </article>

        <article className="log-dashboard-topic-card topic-capacity" aria-label="吞吐峰值">
          <div className="topic-card-head">
            <div>
              <span>大文件压力</span>
              <h2>吞吐峰值</h2>
            </div>
            <div className="topic-primary-metric">
              <strong>{formatSize(metrics.throughputPeak.sizeMB)}</strong>
            </div>
          </div>

          <div className="topic-decision-panel is-capacity">
            <FileText size={18} />
            <div>
              <span>关键判断</span>
              <strong>峰值占比 {peakShare}%</strong>
              <p>今日总解析容量 {formatSize(totalFileSize)}，峰值样本来自 {compactLogLabel(peakLog)}。</p>
            </div>
          </div>

          <div className="topic-evidence-grid">
            <section className="topic-evidence-block">
              <div className="topic-section-head">
                <strong>容量结构</strong>
                <span>峰值 / 总量</span>
              </div>
              <div className="topic-capacity-structure">
                <div>
                  <span>峰值占比</span>
                  <strong>{peakShare}%</strong>
                </div>
                <i>
                  <span style={{ width: `${Math.max(8, peakShare)}%` }} />
                </i>
                <p>{formatSize(metrics.throughputPeak.sizeMB)} / {formatSize(totalFileSize)}</p>
              </div>
            </section>

            <section className="topic-evidence-block">
              <div className="topic-section-head">
                <strong>容量排行</strong>
                <span>Top {Math.min(sortedBySize.length, 3)}</span>
              </div>
              <div className="topic-capacity-rank" aria-label="文件容量排行">
                {sortedBySize.slice(0, 3).map((log) => (
                  <div key={log.id}>
                    <span title={compactLogLabel(log)}>{compactLogLabel(log)}</span>
                    <strong>{formatSize(log.fileSizeMB)}</strong>
                    <i style={{ width: `${Math.max(10, (log.fileSizeMB / Math.max(metrics.throughputPeak.sizeMB, 1)) * 100)}%` }} />
                  </div>
                ))}
              </div>
            </section>
          </div>

        </article>
      </section>

    </div>
  );
}
