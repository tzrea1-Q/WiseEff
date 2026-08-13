import type { Message } from "@ag-ui/core";
import { xiaozePromptDebugEnabled } from "@/infrastructure/http/runtimeMode";
import { XiaozeUserMessage } from "./XiaozeUserMessage";
import { XiaozeCitationSources } from "./XiaozeCitationSources";
import { XiaozeThinkingIndicator } from "./XiaozeThinkingIndicator";
import { XiaozeTurnReasoningPanel } from "./XiaozeTurnReasoningPanel";
import { XiaozeAssistantMarkdown } from "./XiaozeAssistantMarkdown";
import { XiaozePromptDebugPanel } from "./XiaozePromptDebugPanel";
import { useXiaozePromptDebugSnapshotForTurn } from "./XiaozePromptDebugContext";
import { useXiaozeLiveRunSteps } from "./XiaozeRunStepsContext";
import { useXiaozeTurnReply } from "./XiaozeTurnReplyContext";
import { useXiaozeTurnState } from "./XiaozeTurnStateContext";
import { groupMessagesIntoTurns, pickAssistantForTurn, type XiaozeConversationTurn } from "./xiaozeTurnGrouping";
import { resolveXiaozeTurnView } from "./xiaozeTurnView";
import { XiaozeTurnPhaseStrip } from "./XiaozeTurnPhaseStrip";

type XiaozeTurnBlockProps = {
  turn: XiaozeConversationTurn;
  messages: Message[];
  isLatest: boolean;
  isRunning: boolean;
};

export function XiaozeTurnBlock({ turn, messages, isLatest, isRunning }: XiaozeTurnBlockProps) {
  const assistant = pickAssistantForTurn(turn);
  const turnReply = useXiaozeTurnReply(assistant?.id);
  const turnState = useXiaozeTurnState(assistant?.id);
  const liveRunSteps = useXiaozeLiveRunSteps();

  const view = resolveXiaozeTurnView({
    turn,
    assistant,
    messages,
    isLatest,
    isRunning,
    turnReply,
    turnState,
    liveRunSteps
  });

  const promptDebugSnapshot = useXiaozePromptDebugSnapshotForTurn(view.userMessageText, view.promptDebugRunId);

  return (
    <article className="xiaoze-turn-block" data-turn-id={turn.id} data-active={view.isActiveTurn ? "true" : "false"}>
      <XiaozeUserMessage message={turn.user} />

      {xiaozePromptDebugEnabled && promptDebugSnapshot ? (
        <div className="xiaoze-prompt-debug-anchor xiaoze-turn-block__prompt-debug">
          <XiaozePromptDebugPanel snapshot={promptDebugSnapshot} />
        </div>
      ) : null}

      {view.showReasoningPanel ? (
        <XiaozeTurnReasoningPanel
          content={view.reasoningText}
          isStreaming={view.isReasoningStreaming}
          reasoningMessageId={view.reasoningMessageId}
        />
      ) : null}

      {view.showThinkingFallback ? <XiaozeThinkingIndicator /> : null}

      {view.showPhaseStrip ? (
        <XiaozeTurnPhaseStrip steps={view.steps} phase={view.phase} isActive={view.isActiveTurn} />
      ) : null}

      {view.showAnswer ? (
        <div className="xiaoze-turn-block__answer">
          <div className="xiaoze-assistant-message__meta">
            <span className="xiaoze-assistant-message__name">小泽</span>
          </div>
          <div className="xiaoze-assistant-message copilotKitAssistantMessage">
            <XiaozeAssistantMarkdown content={view.answerText} isStreaming={view.answerStreaming} />
            <XiaozeCitationSources citations={view.citations} />
          </div>
        </div>
      ) : null}
    </article>
  );
}

export function renderXiaozeTurnBlocks(messages: Message[], isRunning: boolean) {
  const turns = groupMessagesIntoTurns(messages);
  return turns.map((turn, index) => (
    <XiaozeTurnBlock
      key={turn.id}
      turn={turn}
      messages={messages}
      isLatest={index === turns.length - 1}
      isRunning={isRunning}
    />
  ));
}
