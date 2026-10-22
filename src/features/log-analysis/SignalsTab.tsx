import { DataTable, type Column } from "@/components/admin/DataTable";
import { SectionEmpty } from "@/components/common/SectionState";
import { Badge } from "@/components/ui/badge";
import { FileText } from "lucide-react";
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

function signalLevel(signal: LogSignal) {
  if (signal.kind === "first-error" || signal.kind === "error-burst") return "错误";
  const levels = signal.anchors.map((anchor) => /\b(ERROR|ERR|FATAL|WARN(?:ING)?|INFO|DEBUG|TRACE)\b/i.exec(anchor.content)?.[1].toUpperCase());
  if (levels.some((level) => level === "ERROR" || level === "ERR" || level === "FATAL")) return "错误";
  if (levels.some((level) => level === "WARN" || level === "WARNING")) return "警告";
  if (levels.includes("INFO")) return "信息";
  if (levels.includes("DEBUG")) return "调试";
  if (levels.includes("TRACE")) return "跟踪";
  return SEVERITY_LABELS[signal.severity];
}

export function SignalsTab({ summary, rawFilePath, rawLineCount, fileCount, allFilesAvailable = false, onAnchor }: {
  summary?: LogSignalSummary;
  rawFilePath: string;
  rawLineCount: number;
  fileCount?: number;
  allFilesAvailable?: boolean;
  onAnchor: (anchor: LogSignalAnchor) => void;
}) {
  const anchorChip = (anchor: LogSignalAnchor, templateLocation = false) => {
    const available = anchor.line > 0 && (allFilesAvailable || (anchor.file === rawFilePath && anchor.line <= rawLineCount));
    const label = templateLocation && fileCount === 1 ? `第 ${anchor.line} 行` : `${anchor.file}:${anchor.line}`;
    return <Badge asChild variant="outline" key={`${anchor.file}:${anchor.line}`}
      className={templateLocation ? "max-w-full gap-0 whitespace-nowrap" : "h-auto max-w-full whitespace-normal break-all text-left"}>
      <button type="button" disabled={!available} onClick={() => onAnchor(anchor)}
        aria-label={label} title={`${anchor.file}:${anchor.line} · ${anchor.content}${available ? "" : " · 当前原始日志视图未包含此行"}`}>
        {templateLocation && fileCount !== 1 ? <>
          <span dir="rtl" className="min-w-0 truncate text-left"><bdi dir="ltr">{anchor.file}</bdi></span>
          <span className="shrink-0">:{anchor.line}</span>
        </> : label}
      </button>
    </Badge>;
  };
  const signalColumns: Column<LogSignal>[] = [
    { key: "title", header: "信号", widthClass: "w-1/4", render: (signal) => <span className="break-words">{signalTitle(signal)}</span> },
    { key: "source", header: "来源", widthClass: "w-20", className: "whitespace-nowrap", render: (signal) => <Badge variant="secondary">{signal.source === "generic" ? "通用" : "技能"}</Badge> },
    { key: "severity", header: "级别", widthClass: "w-20", className: "whitespace-nowrap", render: (signal) => <Badge variant={signal.severity === "Critical" ? "destructive" : "outline"}>{signalLevel(signal)}</Badge> },
    { key: "count", header: "次数", widthClass: "w-24", className: "whitespace-nowrap", align: "right", sortAccessor: (signal) => signal.count, render: (signal) => signal.count },
    { key: "anchors", header: "日志位置", render: (signal) => <div className="flex flex-wrap gap-1">{signal.anchors.map((anchor) => anchorChip(anchor))}</div> }
  ];
  const templateColumns: Column<LogLineTemplate>[] = [
    { key: "template", header: "模板", widthClass: "w-1/2", render: (row) => <code className="break-all whitespace-pre-wrap">{row.template}</code> },
    { key: "count", header: "次数", widthClass: "w-24", className: "whitespace-nowrap", align: "right", sortAccessor: (row) => row.count, render: (row) => row.count },
    { key: "first", header: "首次出现", render: (row) => anchorChip(row.first, true) },
    { key: "last", header: "末次出现", render: (row) => anchorChip(row.last, true) }
  ];
  const signals = summary?.signals ?? [];
  const genericSignals = signals.filter((signal) => signal.source === "generic");
  const signalGroups = [
    { key: "skill", title: "技能信号", rows: signals.filter((signal) => signal.source === "skill") },
    ...Array.from(new Set(genericSignals.map((signal) => signal.kind))).map((kind) => ({
      key: kind, title: kindLabels[kind] ?? "其他信号", rows: genericSignals.filter((signal) => signal.kind === kind)
    }))
  ].filter((group) => group.rows.length);
  return <section aria-label="日志信号" className="space-y-4 p-3">
    {summary?.truncated || summary?.reason ? <p role="status" className="text-sm text-muted-foreground">
      {summary.reason ? truncationMessages[summary.reason] : "信号提取结果不完整，请结合原始日志核对。"}
    </p> : null}
    {!signals.length && summary?.reason !== "extraction_error" ? <SectionEmpty icon={<FileText aria-hidden size={20} />} message={summary ? "本次分析未保留信号。" : "暂无信号。"} /> : null}
    {signalGroups.map((group) => <section key={group.key} aria-label={`信号类型 ${group.title}`} className="space-y-2">
      <h3 className="text-sm font-medium">{group.title}</h3>
      <DataTable ariaLabel={group.title} tableClassName="table-fixed" rows={group.rows} rowKey={(signal) => JSON.stringify(signal)} columns={signalColumns} />
    </section>)}
    {summary?.truncatedSignals ? <p className="text-sm text-muted-foreground">信号已达上限，仅显示已保留的信号与日志位置。</p> : null}
    <section aria-label="行模板" className="space-y-2">
      <h3 className="text-sm font-medium">行模板</h3>
      <DataTable ariaLabel="行模板" tableClassName="table-fixed" rows={summary?.templates ?? []} rowKey={(row) => row.template} columns={templateColumns}
        emptyState={<SectionEmpty icon={<FileText aria-hidden size={20} />} message="暂无行模板。" />} />
      {summary?.truncatedTemplates ? <p className="text-sm text-muted-foreground">行模板已达上限，仅显示已保留的模板。</p> : null}
    </section>
  </section>;
}
