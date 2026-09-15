import { BookOpenCheck, ShieldCheck, Sparkles } from "lucide-react";
import { dispatchXiaozeOpenHandoff } from "./xiaozeOpenHandoff";

const CAPABILITIES = [
  {
    icon: BookOpenCheck,
    title: "页面感知答疑",
    description: "结合当前页面与权限内的参数、日志、调试等数据回答您的问题。"
  },
  {
    icon: Sparkles,
    title: "行动建议",
    description: "理解意图后给出可执行建议，并附上可追溯的引用依据。"
  },
  {
    icon: ShieldCheck,
    title: "审批后执行",
    description: "涉及写入、变更或设备操作时，必须经您批准后才进入现有审批与审计流程。"
  }
] as const;

const STARTER_PROMPTS = [
  "如何申请参数修改权限？",
  "帮我分析最近一条错误日志",
  "检查当前页面相关服务状态"
] as const;

export function XiaozeWelcomePanel() {
  const handlePromptClick = (prompt: string) => {
    dispatchXiaozeOpenHandoff(prompt);
  };

  return (
    <section className="xiaoze-welcome" aria-label="小泽欢迎引导" data-testid="xiaoze-welcome-panel">
      <div className="xiaoze-welcome__hero">
        <p className="xiaoze-welcome__eyebrow">WiseEff 智能助手</p>
        <h2 className="xiaoze-welcome__title">有什么可以帮您的？</h2>
        <p className="xiaoze-welcome__subtitle">
          我是小泽，可以基于当前页面和您有权限的平台数据答疑；涉及变更、提交或设备写入等操作，会在您批准后再协助执行。
        </p>
      </div>
      <ul className="xiaoze-welcome__capabilities">
        {CAPABILITIES.map((item) => {
          const Icon = item.icon;
          return (
            <li key={item.title} className="xiaoze-welcome__capability">
              <span className="xiaoze-welcome__capability-icon" aria-hidden="true">
                <Icon size={16} />
              </span>
              <span className="xiaoze-welcome__capability-copy">
                <strong>{item.title}</strong>
                <span>{item.description}</span>
              </span>
            </li>
          );
        })}
      </ul>
      <div className="xiaoze-welcome__prompts" data-testid="xiaoze-starter-prompts">
        <p className="xiaoze-welcome__prompts-title">您可以试着问我：</p>
        <div className="xiaoze-welcome__prompt-pills">
          {STARTER_PROMPTS.map((prompt) => (
            <button
              key={prompt}
              type="button"
              className="xiaoze-welcome__prompt-pill"
              onClick={() => handlePromptClick(prompt)}
            >
              <Sparkles size={13} aria-hidden="true" />
              <span>{prompt}</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
