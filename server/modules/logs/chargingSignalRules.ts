import type { SignalRuleSet } from "./signalRules";

/** Array order preserves evidence order and breaks equal analysis priorities. */
export const defaultChargingRuleSet: SignalRuleSet = {
  rules: [
    {
      id: "thermal-foldback",
      anyOf: [
        { type: "text", pattern: "\\bfoldback\\b|THERMAL_FOLDBACK|\\bderat(?:e|ed|ing)\\b|\\b(?:battery_temp|temperature|thermal)\\b.*\\bexceeds? (?:the )?limit\\b", flags: "i" }
      ],
      stageId: "rootcause",
      inference: "过热保护降低了充电输出。",
      suggestedAction: "恢复快充前，请检查电池温度、散热路径及电池管理系统的温度保护阈值。",
      analysis: {
        conclusion: { value: "充电表现符合过热保护降额特征。", priority: 0 },
        impact: { value: "电池温度恢复到安全范围前，充电速度可能降低。", priority: 1 },
        severity: { value: "Warning", priority: 1 },
        confidence: { value: 0.85, priority: 0, requiresErrorEvidence: true },
        suggestedActions: [
          { value: "恢复快充前，请检查电池温度、散热路径及电池管理系统的温度保护阈值。", priority: 0 },
          { value: "检查环境温度和近期请求的充电电流，确认是否存在过热风险。", priority: 2 }
        ]
      }
    },
    {
      id: "charge-current-reduction",
      anyOf: [
        { type: "text", pattern: "current reduced", flags: "i" },
        { type: "text", pattern: "reduced current", flags: "i" },
        { type: "text", pattern: "charge current reduced", flags: "i" },
        { type: "numericComparison", leftTokens: ["charge_current_ma", "current_ma"], operator: "lt", rightTokens: ["requested_ma"] }
      ],
      stageId: "pattern",
      inference: "控制器降低了请求的充电电流。",
      suggestedAction: "对比异常发生前后请求的充电电流与实际电流。",
      analysis: {
        conclusion: { value: "日志显示充电电流降低，具体原因尚未确认。", priority: 3 },
        severity: { value: "Warning", priority: 1 },
        suggestedActions: [{ value: "对比异常发生前后请求的充电电流与实际电流。", priority: 0 }]
      }
    },
    {
      id: "communication-timeout",
      anyOf: [
        { type: "text", pattern: "\\btimeout\\b|\\btimed out\\b|\\bretry[=: ]+[1-9][0-9]*\\b|\\bretry (?:request|connection|after|due|attempt|scheduled)\\b|\\b(?:scheduling|scheduled) (?:a )?retry\\b|\\bretrying\\b|E_TIMEOUT", flags: "i" }
      ],
      stageId: "pattern",
      inference: "控制器通信出现超时或重试。",
      suggestedAction: "检查网络延迟、控制器连接状态和重试次数。",
      analysis: {
        conclusion: { value: "日志显示通信超时或重试。", priority: 2 },
        impact: { value: "通信不稳定可能延迟诊断，或导致无法获取设备的实际状态。", priority: 2 },
        severity: { value: "Warning", priority: 1 },
        confidence: { value: 0.72, priority: 1 },
        suggestedActions: [{ value: "检查网络延迟、控制器连接状态和重试次数。", priority: 0 }]
      }
    },
    {
      id: "device-offline",
      anyOf: [
        { type: "text", pattern: "\\boffline\\b", flags: "i" },
        { type: "text", pattern: "\\bdisconnect(?:ed|ion)?\\b", flags: "i" },
        { type: "text", pattern: "DEVICE_UNAVAILABLE", flags: "i" }
      ],
      stageId: "rootcause",
      inference: "设备不可用或连接已断开。",
      suggestedAction: "检查设备供电、连接状态及能否重新连接。",
      analysis: {
        conclusion: { value: "日志显示设备离线或不可用。", priority: 1 },
        impact: { value: "设备不可用可能阻碍读写操作或后续充电诊断。", priority: 0 },
        severity: { value: "Critical", priority: 0, requiresErrorEvidence: true },
        confidence: { value: 0.85, priority: 0, requiresErrorEvidence: true },
        suggestedActions: [{ value: "检查设备供电、连接状态及能否重新连接。", priority: 0 }]
      }
    },
    {
      id: "error-code",
      anyOf: [{ type: "severityToken", severity: "error", token: "code" }],
      stageId: "pattern",
      inference: "错误日志中包含明确的错误码。",
      suggestedAction: "根据错误码核对固件诊断结果和历史故障。",
      analysis: {
        conclusion: { value: "日志包含需要进一步排查的错误码。", priority: 4 },
        severity: { value: "Warning", priority: 1 },
        suggestedActions: [{ value: "根据错误码核对固件诊断结果和近期参数变更。", priority: 1 }]
      }
    }
  ],
  noHit: {
    confidence: 0.42,
    conclusion: "未发现符合已知规则的异常。",
    impact: "所提供的日志尚未显示直接的运行影响。",
    severity: "Info",
    suggestedActions: ["进一步处理前，请收集设备状态及相邻时段的日志。"]
  },
  hitDefaults: {
    confidence: 0.64,
    conclusion: "未发现符合已知规则的异常。",
    impact: "关闭故障记录前，可能需要人工复核分析结果。",
    severity: "Info",
    suggestedActions: []
  }
};

/** Published seed labels extend the legacy rules without changing unclassified uploads. */
const chargingRuleNames: Record<string, string> = {
  "thermal-foldback": "热降额", "charge-current-reduction": "充电限流", "communication-timeout": "通信超时",
  "device-offline": "设备离线", "error-code": "错误码"
};
export const seededChargingRuleSet: SignalRuleSet = { ...defaultChargingRuleSet,
  rules: defaultChargingRuleSet.rules.map((rule) => ({ ...rule, name: chargingRuleNames[rule.id] })) };
