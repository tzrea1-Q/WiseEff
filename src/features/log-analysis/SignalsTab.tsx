import { DataTable, type Column } from "@/components/admin/DataTable";
import { SectionEmpty } from "@/components/common/SectionState";
import { Badge } from "@/components/ui/badge";
import type { LogLineTemplate, LogSignal, LogSignalAnchor, LogSignalSummary } from "@/domain/logs/types";
import { SEVERITY_LABELS } from "@/domain/prototype/types";

const kindLabels: Record<string, string> = { crash: "崩溃特征", "first-error": "首个错误", restart: "重启",
  "timestamp-gap": "时间间隔", "error-burst": "错误突发" };
const truncationMessages = {
  time_cap: "信号提取已达时间上限，仅显示已完成的部分结果。",
  line_cap: "部分日志行超出扫描长度，信号仅基于已扫描的行首内容。",
  extraction_error: "信号提取未完成，本次暂无信号结果；可继续查看报告与原始日志。"
};
function signalTitle(signal: LogSignal) {
  if (signal.source === "skill") return signal.title;
  if (signal.kind === "crash") return signal.signature ? `崩溃特征：${signal.signature}` : "崩溃特征";
  return ({ "first-error": "文件中的首个错误", restart: "启动标记或时间戳重置",
    "timestamp-gap": "相邻时间戳间隔至少 60 秒", "error-burst": "10 秒内至少 5 条错误" } as Record<string, string>)[signal.kind] ?? signal.title;
}

export function SignalsTab({ summary, rawFilePath, rawLineCount, allFilesAvailable = false, onAnchor }: {
  summary?: LogSignalSummary;
  rawFilePath: string;
  rawLineCount: number;
  allFilesAvailable?: boolean;
  onAnchor: (anchor: LogSignalAnchor) => void;
}) {
  const anchorChip = (anchor: LogSignalAnchor) => {
    const available = anchor.line > 0 && (allFilesAvailable || (anchor.file === rawFilePath && anchor.line <= rawLineCount));
    return <Badge asChild variant="outline" key={`${anchor.file}:${anchor.line}`} className="max-w-full">
      <button type="button" disabled={!available} onClick={() => onAnchor(anchor)} className="truncate"
        title={`${anchor.content}${available ? "" : " · 当前原始日志视图未包含此行"}`}>
        {anchor.file}:{anchor.line}
      </button>
    </Badge>;
  };
  const signalColumns: Column<LogSignal>[] = [
    { key: "title", header: "信号", widthClass: "w-1/4", render: (signal) => <span className="break-words">{signalTitle(signal)}</span> },
    { key: "source", header: "来源", widthClass: "w-20", className: "whitespace-nowrap", render: (signal) => <Badge variant="secondary">{signal.source === "generic" ? "通用" : "技能"}</Badge> },
    { key: "severity", header: "级别", widthClass: "w-20", className: "whitespace-nowrap", render: (signal) => <Badge variant={signal.severity === "Critical" ? "destructive" : "outline"}>{SEVERITY_LABELS[signal.severity]}</Badge> },
    { key: "count", header: "次数", widthClass: "w-24", className: "whitespace-nowrap", align: "right", sortAccessor: (signal) => signal.count, render: (signal) => signal.count },
    { key: "anchors", header: "日志位置", render: (signal) => <div className="flex flex-wrap gap-1">{signal.anchors.map(anchorChip)}</div> }
  ];
  const templateColumns: Column<LogLineTemplate>[] = [
    { key: "template", header: "模板", widthClass: "w-1/2", render: (row) => <code className="break-all whitespace-pre-wrap">{row.template}</code> },
    { key: "count", header: "次数", widthClass: "w-24", className: "whitespace-nowrap", align: "right", sortAccessor: (row) => row.count, render: (row) => row.count },
    { key: "first", header: "首次出现", className: "whitespace-nowrap", render: (row) => anchorChip(row.first) },
    { key: "last", header: "末次出现", className: "whitespace-nowrap", render: (row) => anchorChip(row.last) }
  ];
  const signals = summary?.signals ?? [];
  return <section aria-label="日志信号" className="space-y-4 p-3">
    {summary?.truncated || summary?.reason ? <p role="status" className="text-sm text-muted-foreground">
      {summary.reason ? truncationMessages[summary.reason] : "信号提取结果不完整，请结合原始日志核对。"}
    </p> : null}
    {!signals.length && summary?.reason !== "extraction_error" ? <SectionEmpty message={summary ? "本次分析未保留信号。" : "暂无信号。历史记录可能尚未提取通用信号。"} /> : null}
    {Array.from(new Set(signals.map((signal) => signal.kind))).map((kind) => <section key={kind} aria-label={`信号类型 ${kindLabels[kind] ?? "技能信号"}`} className="space-y-2">
      <h3 className="text-sm font-medium">{kindLabels[kind] ?? "技能信号"}</h3>
      <DataTable ariaLabel={`${kindLabels[kind] ?? "技能"}信号`} tableClassName="table-fixed" rows={signals.filter((signal) => signal.kind === kind)} rowKey={(signal) => JSON.stringify(signal)} columns={signalColumns} />
    </section>)}
    {summary?.truncatedSignals ? <p className="text-sm text-muted-foreground">信号已达上限，仅显示已保留的信号与日志位置。</p> : null}
    <section aria-label="行模板" className="space-y-2">
      <h3 className="text-sm font-medium">行模板</h3>
      <DataTable ariaLabel="行模板" tableClassName="table-fixed" rows={summary?.templates ?? []} rowKey={(row) => row.template} columns={templateColumns}
        emptyState={<SectionEmpty message="暂无行模板。" />} />
      {summary?.truncatedTemplates ? <p className="text-sm text-muted-foreground">行模板已达上限，仅显示已保留的模板。</p> : null}
    </section>
  </section>;
}
