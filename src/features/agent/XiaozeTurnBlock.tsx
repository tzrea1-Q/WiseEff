import type { Message } from "@ag-ui/core";
import { xiaozePromptDebugEnabled } from "@/infrastructure/http/runtimeMode";
import { XiaozeUserMessage } from "./XiaozeUserMessage";
import { XiaozeThinkingIndicator } from "./XiaozeThinkingIndicator";
import { XiaozeTurnReasoningPanel } from "./XiaozeTurnReasoningPanel";
import { readRunStepsFromMetadata } from "./XiaozeTurnTimeline";
import { XiaozeAssistantMarkdown } from "./XiaozeAssistantMarkdown";
import { XiaozePromptDebugPanel } from "./XiaozePromptDebugPanel";
import { useXiaozePromptDebugSnapshotForTurn } from "./XiaozePromptDebugContext";
import { useXiaozeLiveRunSteps } from "./XiaozeRunStepsContext";
import { useXiaozeTurnReply } from "./XiaozeTurnReplyContext";
import { useXiaozeTurnState } from "./XiaozeTurnStateContext";
import { presentRunStep } from "./xiaozeStepPresentation";
import { isXiaozeReasoningStreaming } from "./xiaozeThinkingState";
import {
  groupMessagesIntoTurns,
  pickAssistantForTurn,
  readMessageText,
  resolveTurnAnswerText,
  shouldDeferTurnAnswer,
  shouldShowTurnThinking,
  type XiaozeConversationTurn
} from "./xiaozeTurnGrouping";
import { XiaozeTurnPhaseStrip } from "./XiaozeTurnPhaseStrip";

type XiaozeTurnBlockProps = {
  turn: XiaozeConversationTurn;
  messages: Message[];
  isLatest: boolean;
  isRunning: boolean;
};

function readUserMessageText(message: XiaozeConversationTurn["user"]) {
  return readMessageText(message.content);
}

export function XiaozeTurnBlock({ turn, messages, isLatest, isRunning }: XiaozeTurnBlockProps) {
  const assistant = pickAssistantForTurn(turn);
  const turnReply = useXiaozeTurnReply(assistant?.id);
  const turnState = useXiaozeTurnState(assistant?.id);
  const userMessageText = readUserMessageText(turn.user);
  const promptDebugSnapshot = useXiaozePromptDebugSnapshotForTurn(userMessageText, turnState?.runId ?? turnReply?.runId);
  const isActiveTurn = isLatest && isRunning;
  const liveRunSteps = useXiaozeLiveRunSteps();
  const metadata = (assistant as { metadata?: Record<string, unknown> } | undefined)?.metadata;
  const persistedSteps = turnReply?.runSteps?.length
    ? turnReply.runSteps
    : turnState?.steps?.length
      ? turnState.steps
      : readRunStepsFromMetadata(metadata);
  const rawSteps = isActiveTurn && liveRunSteps.length > 0 ? liveRunSteps : persistedSteps;
  const steps = rawSteps.map(presentRunStep);
  const deferPartial = shouldDeferTurnAnswer({
    isActiveTurn,
    isRunning,
    turnReply,
    steps
  });
  const answerText =
    turnState?.phase === "done" && turnState.text?.trim()
      ? turnState.text.trim()
      : resolveTurnAnswerText(assistant, turnReply, isActiveTurn, deferPartial);
  const reasoningText =
    readMessageText(turn.reasoning?.content) || turnReply?.reasoning?.trim() || turnState?.reasoning?.trim() || "";
  const reasoningMessageId = turn.reasoning?.id ?? turnReply?.reasoningMessageId ?? turnState?.reasoningMessageId;
  const isReasoningStreaming =
    turn.reasoning && isXiaozeReasoningStreaming(turn.reasoning, messages, isRunning)
      ? true
      : isActiveTurn && isRunning && !answerText && (turnState?.phase === "thinking" || (!turnState && steps.length === 0));
  const showReasoningPanel = isReasoningStreaming || reasoningText.length > 0;
  const showThinkingFallback = shouldShowTurnThinking(turn, isActiveTurn, answerText) && !showReasoningPanel;
  const showAnswer = answerText.length > 0;
  const showPhaseStrip = steps.length > 0 || (turnState && turnState.phase !== "done");
  const phase = turnState?.phase ?? (isActiveTurn && steps.some((step) => step.status === "running") ? "tool" : undefined);

  return (
    <article className="xiaoze-turn-block" data-turn-id={turn.id} data-active={isActiveTurn ? "true" : "false"}>
      <XiaozeUserMessage message={turn.user} />

      {xiaozePromptDebugEnabled && promptDebugSnapshot ? (
        <div className="xiaoze-prompt-debug-anchor xiaoze-turn-block__prompt-debug">
          <XiaozePromptDebugPanel snapshot={promptDebugSnapshot} />
        </div>
      ) : null}

      {showReasoningPanel ? (
        <XiaozeTurnReasoningPanel
          content={reasoningText}
          isStreaming={isReasoningStreaming}
          reasoningMessageId={reasoningMessageId}
        />
      ) : null}

      {showThinkingFallback ? <XiaozeThinkingIndicator /> : null}

      {showPhaseStrip ? (
        <XiaozeTurnPhaseStrip steps={steps} phase={phase} isActive={isActiveTurn} />
      ) : null}

      {showAnswer ? (
        <div className="xiaoze-turn-block__answer">
          <div className="xiaoze-assistant-message__meta">
            <span className="xiaoze-assistant-message__name">小泽</span>
          </div>
          <div className="xiaoze-assistant-message copilotKitAssistantMessage">
            <XiaozeAssistantMarkdown
              content={answerText}
              isStreaming={isActiveTurn && isRunning && turnState?.phase === "composing"}
            />
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
