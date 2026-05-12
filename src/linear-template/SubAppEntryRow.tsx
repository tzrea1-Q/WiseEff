import { FileText, SlidersHorizontal, TerminalSquare } from "lucide-react";
import type { PrototypeState } from "../mockData";
import { SubAppCard, type SubAppCardProps } from "./SubAppCard";
import { deriveSubAppBadges } from "./subAppBadges";

type SubAppEntryRowProps = {
  state: PrototypeState;
};

export function SubAppEntryRow({ state }: SubAppEntryRowProps) {
  const badges = deriveSubAppBadges(state);

  const cards: SubAppCardProps[] = [
    {
      accent: "#2857FF",
      icon: SlidersHorizontal,
      title: "参数管理",
      description: "跨项目统一查询、对比充电/电池参数，提交并审阅变更。",
      chips: ["查询对比", "提交变更", "审阅合入"],
      primary: { label: "进入参数首页", href: "/parameter-home" },
      secondary: { label: "打开参数管理后台", href: "/parameter-admin" },
      badge: badges.parameterManagement
    },
    {
      accent: "#7C3AED",
      icon: TerminalSquare,
      title: "调试平台",
      description: "连接样机、实时下发调试值，保留快照与回滚入口。",
      chips: ["设备接入", "实时下发", "快照回滚"],
      primary: { label: "进入调试工作台", href: "/debugging" },
      secondary: { label: "打开调试管理后台", href: "/debugging-admin" },
      badge: badges.parameterDebugging
    },
    {
      accent: "#00B8D4",
      icon: FileText,
      title: "日志分析",
      description: "上传日志，让 AI 还原异常根因并生成可审阅证据链。",
      chips: ["上传解析", "根因推断", "证据追溯"],
      primary: { label: "进入日志分析", href: "/logs" },
      secondary: { label: "打开日志分析后台", href: "/log-admin" },
      badge: badges.logAnalysis
    }
  ];

  return (
    <div className="sub-app-entry-row" role="list" aria-label="子应用入口">
      {cards.map((card, index) => (
        <div role="listitem" key={card.title} className={`linear-fade-item delay-${index + 3}`}>
          <SubAppCard {...card} />
        </div>
      ))}
    </div>
  );
}
