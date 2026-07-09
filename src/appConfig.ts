import {
  Activity,
  ChartNoAxesCombined,
  Database,
  FileText,
  Gauge,
  Home,
  LucideIcon,
  MessageSquareText,
  ScrollText,
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
  | "parameter-admin-projects"
  | "log-dashboard"
  | "logs"
  | "log-admin"
  | "debugging"
  | "node-debugging"
  | "debugging-admin"
  | "user-permissions"
  | "feedback-admin"
  | "audit";

export type PageConfig = {
  key: PageKey;
  path: string;
  label: string;
  group: "平台总览" | "参数管理" | "调试平台" | "日志分析";
  icon: LucideIcon;
  title: string;
  subtitle: string;
};

export const navigationItems: PageConfig[] = [
  {
    key: "home",
    path: "/",
    label: "首页",
    group: "平台总览",
    icon: Home,
    title: "雷泽",
    subtitle: "业务流程里的 AI 协同工作系统"
  },
  {
    key: "parameter-home",
    path: "/parameter-home",
    label: "我的工作台",
    group: "参数管理",
    icon: Home,
    title: "我的工作台",
    subtitle: ""
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
    subtitle: "电池与充电参数数据库、批量导入管理"
  },
  {
    key: "node-debugging",
    path: "/node-debugging",
    label: "节点调试",
    group: "调试平台",
    icon: TerminalSquare,
    title: "节点调试平台",
    subtitle: "通过 HDC / ADB 读写设备节点，完成调试验证"
  },
  {
    key: "debugging-admin",
    path: "/debugging-admin",
    label: "管理后台",
    group: "调试平台",
    icon: Gauge,
    title: "调试管理后台",
    subtitle: "设备接入、可调节点目录、指标和权限管理"
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
  { label: "反馈管理", icon: MessageSquareText, path: "/feedback-admin" },
  { label: "审计中心", icon: ScrollText, path: "/audit" },
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
      subtitle: "统一管理雷泽平台用户、四档角色和访问权限"
    };
  }

  if (path === "/audit") {
    return {
      key: "audit",
      path: "/audit",
      label: "审计中心",
      group: "平台总览",
      icon: ScrollText,
      title: "审计中心",
      subtitle: "跨模块检索参数、日志、调试、Agent 与用户治理操作证据"
    };
  }

  if (path === "/feedback-admin") {
    return {
      key: "feedback-admin",
      path: "/feedback-admin",
      label: "反馈管理",
      group: "平台总览",
      icon: MessageSquareText,
      title: "产品反馈管理",
      subtitle: "内测反馈分诊、截图核查、处理备注和状态闭环"
    };
  }

  if (path === "/parameter-admin/projects") {
    return {
      key: "parameter-admin-projects",
      path: "/parameter-admin/projects",
      label: "项目管理",
      group: "参数管理",
      icon: Database,
      title: "项目参数管理后台",
      subtitle: "维护项目清单、初始化状态、模块覆盖与参数库入口"
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

  if (path === "/debugging") {
    return {
      key: "debugging",
      path: "/debugging",
      label: "参数调试",
      group: "调试平台",
      icon: TerminalSquare,
      title: "页面暂时不可用",
      subtitle: "参数调试工作区已下线，请使用节点调试或调试管理后台。"
    };
  }

  return navigationItems.find((item) => item.path === path) ?? navigationItems[0];
}

export function pageUsesProjectScope(pageKey: PageKey): boolean {
  switch (pageKey) {
    case "parameters":
    case "parameter-submissions":
    case "parameter-review":
    case "parameter-admin":
    case "parameter-admin-projects":
    case "parameter-home":
      return true;
    default:
      return false;
  }
}

export function getXiaozeContextSummary(path: string): string {
  const page = getPageByPath(path);

  switch (page.key) {
    case "parameters":
      return "正在关注快充电流、温控阈值、电池健康和待提交修改草稿。";
    case "parameter-comparison":
      return "独立参数对比页面已下线，请回到参数工作台查看行级跨项目对比。";
    case "parameter-review":
      return "正在汇总待审阅请求、历史表现和充电安全风险。";
    case "logs":
      return "正在跟踪充电日志解析、温升模式匹配、根因推断和证据链。";
    case "debugging":
      return "参数调试工作区已下线，请使用节点调试或调试管理后台。";
    case "node-debugging":
      return "正在关注 HDC 连接状态、节点访问模式、待读写目标值和回读校验结果。";
    case "parameter-admin":
      return "正在关注参数库健康、闲置参数、权限异常和导入风险。";
    case "parameter-admin-projects":
      return "正在关注项目清单、初始化进度、模块覆盖和参数规模。";
    case "log-admin":
      return "正在关注分析吞吐、失败记录、权限覆盖和使用趋势。";
    case "debugging-admin":
      return "正在关注设备在线率、可调节点目录覆盖和节点访问策略。";
    case "feedback-admin":
      return "正在关注内测产品反馈、待处理问题、截图证据和分诊闭环。";
    default:
      return "正在跨充电参数、日志、调试三个场景识别效率提升机会。";
  }
}
