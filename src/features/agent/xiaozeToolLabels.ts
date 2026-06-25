const TOOL_LABELS_ZH: Record<string, string> = {
  "perception.getProjectOverview": "查询项目概览",
  "perception.searchParameters": "搜索参数定义",
  "perception.getNodeSnapshot": "读取节点快照",
  "perception.getRecentLogConclusions": "查看日志结论",
  "action.submitParameterChange": "提交参数变更"
};

export function getXiaozeToolLabel(toolName: string) {
  return TOOL_LABELS_ZH[toolName] ?? toolName;
}
