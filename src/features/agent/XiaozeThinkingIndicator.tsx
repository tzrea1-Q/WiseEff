import { Sparkles } from "lucide-react";

export function XiaozeThinkingIndicator() {
  return (
    <section className="xiaoze-reasoning-message is-streaming is-open" aria-live="polite" aria-busy="true">
      <div className="xiaoze-reasoning-message__toggle" aria-hidden="true">
        <span className="xiaoze-reasoning-message__icon">
          <Sparkles size={14} />
        </span>
        <span className="xiaoze-reasoning-message__label">思考中…</span>
      </div>
    </section>
  );
}
