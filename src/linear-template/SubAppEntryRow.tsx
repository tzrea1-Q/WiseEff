import { FileText, SlidersHorizontal, TerminalSquare } from "lucide-react";
import { isWorkflowVisible, type WorkflowId } from "@/domain/workflowDiscovery";
import { SubAppCard, type SubAppCardProps } from "./SubAppCard";

type SubAppEntryRowProps = {
  onNavigate?: (path: string) => void;
};

export function SubAppEntryRow({ onNavigate }: SubAppEntryRowProps) {
  const cards: Array<SubAppCardProps & { workflowId: WorkflowId }> = [
    {
      workflowId: "parameter-management",
      accent: "#2857FF",
      icon: SlidersHorizontal,
      kicker: "配置治理",
      title: "参数管理",
      description: "跨项目统一查询、对比充电/电池参数，提交并审阅变更。",
      chips: ["查询对比", "提交变更", "审阅合入"],
      primary: { label: "进入参数首页", href: "/parameter-home" },
      secondary: { label: "打开参数管理后台", href: "/parameter-admin" }
    },
    {
      workflowId: "debugging",
      accent: "#7C3AED",
      icon: TerminalSquare,
      kicker: "在线调试",
      title: "调试平台",
      description: "连接样机、通过 HDC/ADB 读写设备节点，保留快照与回滚入口。",
      chips: ["设备接入", "节点读写", "快照回滚"],
      primary: { label: "进入节点调试", href: "/node-debugging" },
      secondary: { label: "打开调试管理后台", href: "/debugging-admin" }
    },
    {
      workflowId: "log-analysis",
      accent: "#00B8D4",
      icon: FileText,
      kicker: "证据链路",
      title: "日志分析",
      description: "上传日志，让 AI 还原异常根因并生成可审阅证据链。",
      chips: ["上传解析", "根因推断", "证据追溯"],
      primary: { label: "进入日志分析", href: "/logs" },
      secondary: { label: "打开日志分析后台", href: "/log-admin" }
    }
  ];

  return (
    <div className="sub-app-entry-row" role="list" aria-label="子应用入口">
      {cards.filter((card) => isWorkflowVisible(card.workflowId)).map((card, index) => (
        <div role="listitem" key={card.title} className={`linear-fade-item delay-${index + 3}`}>
          <SubAppCard {...card} onNavigate={onNavigate} />
        </div>
      ))}
    </div>
  );
}
