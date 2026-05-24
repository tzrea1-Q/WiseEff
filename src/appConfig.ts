import {
  Activity,
  Bot,
  ChartNoAxesCombined,
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
import type { ActionKey } from "@/app/permissions";

export type PageKey =
  | "home"
  | "parameter-home"
  | "parameters"
  | "parameter-submissions"
  | "parameter-comparison"
  | "parameter-review"
  | "parameter-admin"
  | "log-dashboard"
  | "logs"
  | "log-admin"
  | "debugging"
  | "node-debugging"
  | "debugging-admin"
  | "user-permissions";

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
    requiredPermission?: ActionKey;
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
    label: "我的工作台",
    group: "参数管理",
    icon: Home,
    title: "我的工作台",
    subtitle: "待办事项 · 主要功能 · 热榜"
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
    key: "node-debugging",
    path: "/node-debugging",
    label: "节点调试",
    group: "调试平台",
    icon: TerminalSquare,
    title: "节点调试平台",
    subtitle: "通过 HDC 读写设备节点，完成调试参数验证"
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
    key: "log-dashboard",
    path: "/log-dashboard",
    label: "看板",
    group: "日志分析",
    icon: ChartNoAxesCombined,
    title: "日志分析看板",
    subtitle: "日志分析应用态势、处理质量、失败分布和吞吐表现"
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

export const utilityItems: Array<{ label: string; icon: LucideIcon; path?: string }> = [
  { label: "Agent 能力", icon: Bot },
  { label: "用户管理", icon: Settings2, path: "/user-permissions" }
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

  if (path === "/user-permissions") {
    return {
      key: "user-permissions",
      path: "/user-permissions",
      label: "用户权限",
      group: "平台总览",
      icon: Settings2,
      title: "用户权限管理",
      subtitle: "统一管理 WiseEff 平台用户、四档角色和访问权限"
    };
  }

  if (path === "/parameter-comparison") {
    return {
      key: "parameter-comparison",
      path: "/parameter-comparison",
      label: "对比分析",
      group: "参数管理",
      icon: SlidersHorizontal,
      title: "页面不可用",
      subtitle: "独立参数对比已下线，请回到参数工作台查看行级对比"
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
          { id: "draft-parameter-change", label: "生成参数修改草稿", requiresConfirm: true, requiredPermission: "parameter.edit" }
        ]
      };
    case "parameter-comparison":
      return {
        ...shared,
        contextTitle: "页面不可用 Agent",
        contextSummary: "独立参数对比页面已下线，请回到参数工作台查看行级跨项目对比。",
        prompts: ["返回参数工作台", "查看行级参数详情", "说明页面下线原因"],
        actions: [
          { id: "open-parameters", label: "返回参数工作台", requiresConfirm: false }
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
          { id: "advance-review", label: "推进当前流程", requiresConfirm: true, requiredPermission: "parameter.review" }
        ]
      };
    case "logs":
      return {
        ...shared,
        contextTitle: "日志根因分析 Agent",
        contextSummary: "正在跟踪充电日志解析、温升模式匹配、根因推断和证据链。",
        prompts: ["解释当前根因", "生成排查清单", "关联历史记录"],
        actions: [
          { id: "advance-log", label: "推进分析阶段", requiresConfirm: false, requiredPermission: "logs.upload" },
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
          { id: "connect-device", label: "连接推荐样机", requiresConfirm: false, requiredPermission: "debugging.use" },
          { id: "push-debug-value", label: "下发调试值", requiresConfirm: true, requiredPermission: "debugging.use" }
        ]
      };
    case "node-debugging":
      return {
        ...shared,
        contextTitle: "节点调试 Agent",
        contextSummary: "正在关注 HDC 连接状态、节点访问模式、待读写目标值和回读校验结果。",
        prompts: ["检查设备连接", "汇总回读异常", "筛选可写节点"],
        actions: [
          { id: "connect-device", label: "重新检测设备", requiresConfirm: false, requiredPermission: "debugging.use" },
          { id: "audit-scan", label: "汇总节点调试风险", requiresConfirm: false }
        ]
      };
    case "parameter-admin":
      return {
        ...shared,
        contextTitle: "参数治理 Agent",
        contextSummary: "正在关注参数库健康、闲置参数、权限异常和导入风险。",
        prompts: ["扫描闲置参数", "预审下次导入风险", "汇总本周审计", "生成闲置清理建议"],
        actions: [
          { id: "scan-orphans", label: "扫描闲置参数", requiresConfirm: false, requiredPermission: "admin.access" },
          { id: "preview-import", label: "预审导入风险", requiresConfirm: false, requiredPermission: "admin.access" },
          { id: "summarize-audit", label: "汇总本周审计", requiresConfirm: false, requiredPermission: "admin.access" },
          { id: "draft-cleanup", label: "生成清理建议", requiresConfirm: true, requiredPermission: "admin.access" }
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
          { id: "advance-log", label: "刷新处理指标", requiresConfirm: false, requiredPermission: "admin.access" }
        ]
      };
    case "debugging-admin":
      return {
        ...shared,
        contextTitle: "调试治理 Agent",
        contextSummary: "正在关注设备在线率、充电参数目录覆盖和高风险下发策略。",
        prompts: ["检查离线设备", "汇总可调参数", "生成权限建议"],
        actions: [
          { id: "connect-device", label: "模拟设备接入", requiresConfirm: false, requiredPermission: "debugging.use" },
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
