import type { LogSkillSpec } from "./skillSpec";
import type { SignalRuleSet } from "./signalRules";

const procedure = ["适用场景", "先检查什么", "根因判定", "常见误判", "建议动作"]
  .map((heading) => `## ${heading}\n请补充${heading}。`).join("\n\n");
const noHit: SignalRuleSet["noHit"] = { conclusion: "未发现已配置的异常信号", impact: "请结合上下文进一步检查。",
  severity: "Info", confidence: 0.3, suggestedActions: ["检查日志是否完整，并补充业务上下文。"] };
function signals(entries: Array<[string, string, string]>): SignalRuleSet {
  return { noHit, hitDefaults: { ...noHit, conclusion: "发现异常信号，请核对根因", severity: "Warning", confidence: 0.6 },
    rules: entries.map(([id, pattern, inference]) => ({ id, anyOf: [{ type: "text", pattern, flags: "i" }],
      stageId: "pattern", inference, suggestedAction: "检查异常前后的日志，核对触发条件。", analysis: { suggestedActions: [] } })) };
}
const generic = { severityMap: { error: ["(?i)\\b(error|fatal|critical)\\b"], warn: ["(?i)\\bwarn(ing)?\\b"], info: ["(?i)\\binfo\\b"] } };
export const logSkillTemplates: Array<{ id: string; label: string; description: string; spec: LogSkillSpec }> = [
  { id: "generic-text", label: "通用文本日志", description: "按常见严重程度识别文本日志。",
    spec: { schemaVersion: "skill/v1", procedure, formatProfile: generic, signalRules: signals([]) } },
  { id: "linux-dmesg", label: "Linux 内核日志", description: "识别内核时间戳、严重程度与常见崩溃信号。",
    spec: { schemaVersion: "skill/v1", procedure, formatProfile: { timestampPattern: "^\\[\\s*(\\d+\\.\\d+)\\]",
      severityMap: { error: ["<[0-3]>", "(?i)\\b(panic|Oops|BUG|segfault)\\b"], warn: ["<4>", "(?i)\\bwatchdog\\b"], info: ["<[5-7]>"] } },
    signalRules: signals([["panic", "\\bpanic\\b", "内核发生 panic"], ["oops", "\\bOops\\b", "内核发生 Oops"],
      ["bug", "\\bBUG\\b", "内核触发 BUG"], ["watchdog", "\\bwatchdog\\b", "看门狗触发"], ["segfault", "\\bsegfault\\b", "进程发生段错误"]]) } },
  { id: "android-logcat", label: "Android 系统日志", description: "识别线程时间格式与应用、系统崩溃信号。",
    spec: { schemaVersion: "skill/v1", procedure, formatProfile: { timestampPattern: "^(\\d{2}-\\d{2}\\s+\\d{2}:\\d{2}:\\d{2}\\.\\d+)",
      severityMap: { error: ["^\\d{2}-\\d{2}\\s+\\S+\\s+\\d+\\s+\\d+\\s+[EF]\\s"],
        warn: ["^\\d{2}-\\d{2}\\s+\\S+\\s+\\d+\\s+\\d+\\s+W\\s"], info: ["^\\d{2}-\\d{2}\\s+\\S+\\s+\\d+\\s+\\d+\\s+I\\s"] } },
    signalRules: signals([["fatal-exception", "FATAL EXCEPTION", "应用发生未处理异常"], ["anr", "\\bANR\\b", "应用无响应"],
      ["native-crash", "Fatal signal|native crash|tombstone", "原生进程崩溃"]]) } },
  { id: "json-lines", label: "逐行 JSON 日志", description: "按行读取结构化文本，识别错误级别字段。",
    spec: { schemaVersion: "skill/v1", procedure, formatProfile: generic,
      signalRules: signals([["json-error", '"level"\\s*:\\s*"(error|fatal|critical)"', "日志记录了错误级别事件"]]) } }
];
