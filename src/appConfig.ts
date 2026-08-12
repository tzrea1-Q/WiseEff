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
  TerminalSquare,
  TowerControl
} from "lucide-react";

import {
  DEBUGGING_ADMIN_UI,
  isDebuggingAdminPath,
  parseDebuggingAdminArea
} from "@/application/debugging/debuggingAdminPath";
import {
  isParameterAdminOrganizationEntryPath,
  parseParameterAdminModulesSubView,
  parseParameterAdminOrganizationPath,
  parseParameterAdminSpecsSubView,
  PARAMETER_ADMIN_ORGANIZATION_VIEW_LABELS
} from "@/application/parameters/parameterAdminOrganizationPath";
import { PARAMETER_ADMIN_UI } from "@/application/parameters/parameterAdminUiCopy";

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
  | "dts-reload"
  | "debugging-admin"
  | "user-permissions"
  | "feedback-admin"
  | "audit"
  | "platform-console";

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
    label: "变更审阅",
    group: "参数管理",
    icon: ShieldCheck,
    title: "参数管理员工作台",
    subtitle: "审阅快充、温控与电池保护变更并推进合入上库流程"
  },
  {
    key: "parameter-admin",
    path: "/parameter-admin",
    label: "参数后台",
    group: "参数管理",
    icon: Database,
    title: "项目参数管理后台",
    subtitle: PARAMETER_ADMIN_UI.adminSubtitle
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
    key: "dts-reload",
    path: "/dts-reload",
    label: "参数调试",
    group: "调试平台",
    icon: Settings2,
    title: "参数调试",
    subtitle: "DTS参数热重载，无需手动编译"
  },
  {
    key: "debugging-admin",
    path: "/debugging-admin",
    label: "调试后台",
    group: "调试平台",
    icon: Gauge,
    title: "调试管理后台",
    subtitle: DEBUGGING_ADMIN_UI.parameterSubtitle
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
    label: "日志后台",
    group: "日志分析",
    icon: Activity,
    title: "日志分析管理后台",
    subtitle: "日志分析应用指标、记录和后台权限配置"
  }
];

export const utilityItems: Array<{ label: string; icon: LucideIcon; path?: string }> = [
  { label: "平台控制台", icon: TowerControl, path: "/platform-console" },
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

  if (path === "/platform-console") {
    return {
      key: "platform-console",
      path: "/platform-console",
      label: "平台控制台",
      group: "平台总览",
      icon: TowerControl,
      title: "平台控制台",
      subtitle: ""
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

  // Project-scoped views share the single sidebar entry; keep deep-link path for in-page area switching.
  if (path === "/parameter-admin/projects" || path.startsWith("/parameter-admin/projects/")) {
    const adminNav = navigationItems.find((item) => item.key === "parameter-admin");
    const viewMatch = path.match(
      /^\/parameter-admin\/projects\/[^/]+(?:\/(files|config-sets|structure|conflicts|configuration))?\/?$/
    );
    const projectViewLabels: Record<string, string> = {
      files: "配置工作台",
      "config-sets": "配置工作台",
      structure: "配置工作台",
      conflicts: "配置工作台",
      configuration: "配置工作台"
    };
    const subtitle = viewMatch
      ? projectViewLabels[viewMatch[1] ?? "configuration"] ?? "配置工作台"
      : "项目清单";
    return {
      ...(adminNav as PageConfig),
      path,
      subtitle
    };
  }

  // Organization-scoped sub-views share the same sidebar entry.
  if (
    path === "/parameter-admin/specs" ||
    path === "/parameter-admin/spec-review" ||
    path === "/parameter-admin/modules" ||
    path === "/parameter-admin/identity-mapping" ||
    path.startsWith("/parameter-admin/specs/") ||
    path.startsWith("/parameter-admin/spec-review/") ||
    path.startsWith("/parameter-admin/modules/") ||
    path.startsWith("/parameter-admin/identity-mapping/")
  ) {
    const adminNav = navigationItems.find((item) => item.key === "parameter-admin");
    const view = parseParameterAdminOrganizationPath(path);
    const modulesSub = parseParameterAdminModulesSubView(path);
    const specsSub = parseParameterAdminSpecsSubView(path);
    const subtitle =
      modulesSub === "queue"
        ? PARAMETER_ADMIN_UI.moduleDiscoveryCompatible
        : specsSub === "identity-mapping"
          ? PARAMETER_ADMIN_UI.identityMapping
          : view
            ? PARAMETER_ADMIN_ORGANIZATION_VIEW_LABELS[view]
            : path.includes("identity-mapping")
              ? PARAMETER_ADMIN_UI.identityMapping
              : path.includes("spec-review")
                ? PARAMETER_ADMIN_UI.specDefinitionManagement
                : (adminNav?.subtitle ?? PARAMETER_ADMIN_UI.specDefinitionManagement);
    return {
      ...(adminNav as PageConfig),
      path,
      subtitle
    };
  }

  if (isParameterAdminOrganizationEntryPath(path)) {
    const adminNav = navigationItems.find((item) => item.key === "parameter-admin");
    return {
      ...(adminNav as PageConfig),
      path,
      subtitle: PARAMETER_ADMIN_ORGANIZATION_VIEW_LABELS.specs
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

  // Debugging-admin scope peers share one sidebar entry (parameter vs nodes).
  if (isDebuggingAdminPath(path)) {
    const adminNav = navigationItems.find((item) => item.key === "debugging-admin");
    const area = parseDebuggingAdminArea(path) ?? "parameter";
    return {
      ...(adminNav as PageConfig),
      path,
      subtitle:
        area === "nodes" ? DEBUGGING_ADMIN_UI.nodesSubtitle : DEBUGGING_ADMIN_UI.parameterSubtitle
    };
  }

  return navigationItems.find((item) => item.path === path) ?? navigationItems[0];
}

export function pageUsesProjectScope(pageKey: PageKey): boolean {
  switch (pageKey) {
    case "parameters":
    case "parameter-submissions":
    case "parameter-review":
    case "parameter-home":
      return true;
    // Organization governance and project operations own their own project pickers
    // (ADR-0001); do not hang the TopBar project selector on either admin area.
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
    case "dts-reload":
      return "正在关注项目参数候选、调试值、overlay 预检结果和可下载产物。";
    case "parameter-admin":
      if (path === "/parameter-admin/projects" || path.startsWith("/parameter-admin/projects/")) {
        return "正在关注项目配置工作台：配置集、源码、候选、冲突裁决与发布基线。";
      }
      if (path.includes("/spec-review")) {
        return PARAMETER_ADMIN_UI.xiaozeSpecReview;
      }
      if (path.includes("/modules")) {
        return "正在关注业务模块树与驱动 / compatible 归属配置。";
      }
      if (path.includes("/identity-mapping")) {
        return PARAMETER_ADMIN_UI.xiaozeIdentityMapping;
      }
      return PARAMETER_ADMIN_UI.xiaozeOrgDefault;
    case "log-admin":
      return "正在关注分析吞吐、失败记录、权限覆盖和使用趋势。";
    case "debugging-admin":
      if (path === "/debugging-admin/nodes" || path.startsWith("/debugging-admin/nodes/")) {
        return "正在关注设备在线率、可调节点目录覆盖和节点访问策略。";
      }
      return "正在关注 DTS 重载配置：落地路径、触发节点与内核日志命令。";
    case "feedback-admin":
      return "正在关注内测产品反馈、待处理问题、截图证据和分诊闭环。";
    default:
      return "正在跨充电参数、日志、调试三个场景识别效率提升机会。";
  }
}
