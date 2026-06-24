const THINKING_TAG = "redacted_thinking";
const THINK_PREFIX_REGEX = /^\(think\)\s*\n?([\s\S]*?)(?=\n{2,}|$)/i;

function createThinkingBlockRegex(capture: boolean) {
  const pattern = capture
    ? `<(?:${THINKING_TAG}|think)>([\\s\\S]*?)<\\/(?:${THINKING_TAG}|think)>`
    : `<(?:${THINKING_TAG}|think)>[\\s\\S]*?<\\/(?:${THINKING_TAG}|think)>`;
  return new RegExp(pattern, "gi");
}

export type SplitAssistantContentResult = {
  reasoning: string;
  answer: string;
};

export function splitAssistantContent(raw: string): SplitAssistantContentResult {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { reasoning: "", answer: "" };
  }

  const reasoningParts: string[] = [];
  for (const match of trimmed.matchAll(createThinkingBlockRegex(true))) {
    const part = match[1]?.trim();
    if (part) {
      reasoningParts.push(part);
    }
  }

  let answer = trimmed.replace(createThinkingBlockRegex(false), "");

  const thinkPrefixMatch = answer.match(THINK_PREFIX_REGEX);
  if (thinkPrefixMatch?.[1]?.trim()) {
    reasoningParts.push(thinkPrefixMatch[1].trim());
    answer = answer.slice(thinkPrefixMatch[0].length);
  }

  return {
    reasoning: reasoningParts.join("\n\n").trim(),
    answer: answer.replace(/^\s+/, "").trim()
  };
}

export function mergeReasoningText(...parts: Array<string | undefined>) {
  return parts
    .map((part) => part?.trim())
    .filter(Boolean)
    .join("\n\n");
}
