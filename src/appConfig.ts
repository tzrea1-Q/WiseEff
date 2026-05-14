import {
  Activity,
  Bot,
  Database,
  FileText,
  Gauge,
  Home,
  LucideIcon,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  TerminalSquare
} from "lucide-react";

export type PageKey =
  | "home"
  | "parameter-home"
  | "parameters"
  | "parameter-submissions"
  | "parameter-comparison"
  | "parameter-review"
  | "parameter-admin"
  | "logs"
  | "log-admin"
  | "debugging"
  | "debugging-admin";

export type PageConfig = {
  key: PageKey;
  path: string;
  label: string;
  group: "平台总览" | "参数管理" | "调试平台" | "日志分析";
  icon: LucideIcon;
  title: string;
  subtitle: string;
};

export type AgentPlan = {
  shellVariant: "unified-glass-agent";
  contextTitle: string;
  contextSummary: string;
  prompts: string[];
  steps: string[];
  actions: Array<{
    id: string;
    label: string;
    requiresConfirm: boolean;
  }>;
};

export const navigationItems: PageConfig[] = [
  {
    key: "home",
    path: "/",
    label: "首页",
    group: "平台总览",
    icon: Home,
    title: "智效 WiseEff",
    subtitle: "业务流程里的 AI 协同工作系统"
  },
  {
    key: "parameter-home",
    path: "/parameter-home",
    label: "看板",
    group: "参数管理",
    icon: Home,
    title: "智能参数管理",
    subtitle: "参数治理态势 · 入口看板 · AI 热区"
  },
  {
    key: "parameters",
    path: "/parameters",
    label: "参数修改",
    group: "参数管理",
    icon: SlidersHorizontal,
    title: "项目参数用户工作台",
    subtitle: "查看、筛选、对比并提交充电与电池参数修改请求"
  },
  {
    key: "parameter-comparison",
    path: "/parameter-comparison",
    label: "对比分析",
    group: "参数管理",
    icon: SlidersHorizontal,
    title: "项目参数对比分析",
    subtitle: "对比两个实际项目的充电、温控与电池保护参数差异，查看风险并同步选择项"
  },
  {
    key: "parameter-review",
    path: "/parameter-review",
    label: "参数审阅",
    group: "参数管理",
    icon: ShieldCheck,
    title: "参数管理员工作台",
    subtitle: "审阅快充、温控与电池保护变更并推进合入上库流程"
  },
  {
    key: "parameter-admin",
    path: "/parameter-admin",
    label: "管理后台",
    group: "参数管理",
    icon: Database,
    title: "项目参数管理后台",
    subtitle: "电池与充电参数数据库、批量导入、权限和审计管理"
  },
  {
    key: "debugging",
    path: "/debugging",
    label: "参数调试",
    group: "调试平台",
    icon: TerminalSquare,
    title: "参数调试平台",
    subtitle: "连接样机、实时调节充电参数并准备回滚"
  },
  {
    key: "debugging-admin",
    path: "/debugging-admin",
    label: "管理后台",
    group: "调试平台",
    icon: Gauge,
    title: "参数调试管理后台",
    subtitle: "设备接入、可调充电参数目录、指标和权限管理"
  },
  {
    key: "logs",
    path: "/logs",
    label: "智能分析",
    group: "日志分析",
    icon: FileText,
    title: "日志智能分析",
    subtitle: "上传充电与热管理日志、跟踪 AI 分析进度并阅读证据链"
  },
  {
    key: "log-admin",
    path: "/log-admin",
    label: "管理后台",
    group: "日志分析",
    icon: Activity,
    title: "日志分析管理后台",
    subtitle: "日志分析应用指标、记录和后台权限配置"
  }
];

export const utilityItems = [
  { label: "Agent 能力", icon: Bot },
  { label: "系统设置", icon: Settings2 }
];

export function getPageByPath(path: string): PageConfig {
  if (path === "/parameter-submissions") {
    return {
      key: "parameter-submissions",
      path: "/parameter-submissions",
      label: "我的历史提交",
      group: "参数管理",
      icon: FileText,
      title: "我的历史提交",
      subtitle: "查看、撤回和追踪当前用户发起的参数提交轮次"
    };
  }

  return navigationItems.find((item) => item.path === path) ?? navigationItems[0];
}

export function createAgentPlan(path: string): AgentPlan {
  const page = getPageByPath(path);
  const shared = {
    shellVariant: "unified-glass-agent" as const,
    steps: ["读取当前项目与角色上下文", "识别高风险业务对象", "生成建议与可执行动作", "等待人工确认后写入前端状态"]
  };

  switch (page.key) {
    case "parameters":
      return {
        ...shared,
        contextTitle: "项目参数巡检 Agent",
        contextSummary: "正在关注快充电流、温控阈值、电池健康和待提交修改草稿。",
        prompts: ["筛查高风险充电参数", "解释项目间差异", "生成修改理由"],
        actions: [
          { id: "filter-high-risk", label: "筛出高风险参数", requiresConfirm: false },
          { id: "draft-parameter-change", label: "生成参数修改草稿", requiresConfirm: true }
        ]
      };
    case "parameter-comparison":
      return {
        ...shared,
        contextTitle: "参数对比 Agent",
        contextSummary: "正在关注两个实际项目之间的快充档位、温控阈值和协议协商差异。",
        prompts: ["解释参数漂移影响", "生成同步建议", "筛出高风险差异"],
        actions: [
          { id: "summarize-comparison", label: "生成差异摘要", requiresConfirm: false },
          { id: "sync-comparison", label: "同步选中差异", requiresConfirm: true }
        ]
      };
    case "parameter-review":
      return {
        ...shared,
        contextTitle: "参数审阅 Agent",
        contextSummary: "正在汇总待审阅请求、历史表现和充电安全风险。",
        prompts: ["总结审阅队列", "生成审阅意见", "检查高风险变更"],
        actions: [
          { id: "summarize-review", label: "生成审阅摘要", requiresConfirm: false },
          { id: "advance-review", label: "推进当前流程", requiresConfirm: true }
        ]
      };
    case "logs":
      return {
        ...shared,
        contextTitle: "日志根因分析 Agent",
        contextSummary: "正在跟踪充电日志解析、温升模式匹配、根因推断和证据链。",
        prompts: ["解释当前根因", "生成排查清单", "关联历史记录"],
        actions: [
          { id: "advance-log", label: "推进分析阶段", requiresConfirm: false },
          { id: "make-checklist", label: "生成排查清单", requiresConfirm: false }
        ]
      };
    case "debugging":
      return {
        ...shared,
        contextTitle: "参数调试 Agent",
        contextSummary: "正在关注样机连接、待下发充电参数和回滚准备状态。",
        prompts: ["推荐调试值", "检查连接状态", "准备回滚方案"],
        actions: [
          { id: "connect-device", label: "连接推荐样机", requiresConfirm: false },
          { id: "push-debug-value", label: "下发调试值", requiresConfirm: true }
        ]
      };
    case "parameter-admin":
      return {
        ...shared,
        contextTitle: "参数治理 Agent",
        contextSummary: "正在关注参数库健康、闲置参数、权限异常和导入风险。",
        prompts: ["扫描闲置参数", "预审下次导入风险", "汇总本周审计", "生成闲置清理建议"],
        actions: [
          { id: "scan-orphans", label: "扫描闲置参数", requiresConfirm: false },
          { id: "preview-import", label: "预审导入风险", requiresConfirm: false },
          { id: "summarize-audit", label: "汇总本周审计", requiresConfirm: false },
          { id: "draft-cleanup", label: "生成清理建议", requiresConfirm: true }
        ]
      };
    case "log-admin":
      return {
        ...shared,
        contextTitle: "日志治理 Agent",
        contextSummary: "正在关注分析吞吐、失败记录、权限覆盖和使用趋势。",
        prompts: ["查看失败原因", "汇总本周吞吐", "检查后台权限"],
        actions: [
          { id: "audit-scan", label: "生成治理摘要", requiresConfirm: false },
          { id: "advance-log", label: "刷新处理指标", requiresConfirm: false }
        ]
      };
    case "debugging-admin":
      return {
        ...shared,
        contextTitle: "调试治理 Agent",
        contextSummary: "正在关注设备在线率、充电参数目录覆盖和高风险下发策略。",
        prompts: ["检查离线设备", "汇总可调参数", "生成权限建议"],
        actions: [
          { id: "connect-device", label: "模拟设备接入", requiresConfirm: false },
          { id: "audit-scan", label: "生成治理摘要", requiresConfirm: false }
        ]
      };
    default:
      return {
        ...shared,
        contextTitle: "平台级协同 Agent",
        contextSummary: "正在跨充电参数、日志、调试三个场景识别效率提升机会。",
        prompts: ["说明平台能力", "展示跨域关联", "生成演示路线"],
        actions: [
          { id: "platform-tour", label: "生成演示路线", requiresConfirm: false },
          { id: "audit-scan", label: "汇总治理承诺", requiresConfirm: false }
        ]
      };
  }
}
