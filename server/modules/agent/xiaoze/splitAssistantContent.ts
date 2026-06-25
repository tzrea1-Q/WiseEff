const THINKING_TAG = "redacted_thinking";
const THINK_PREFIX_REGEX = /^\(think\)\s*\n?([\s\S]*?)(?=\n{2,}|$)/i;

function createThinkingBlockRegex(capture: boolean) {
  const pattern = capture
    ? `<(?:${THINKING_TAG}|think)>([\\s\\S]*?)<\\/(?:${THINKING_TAG}|think)>`
    : `<(?:${THINKING_TAG}|think)>[\\s\\S]*?<\\/(?:${THINKING_TAG}|think)>`;
  return new RegExp(pattern, "gi");
}

const OPEN_THINKING_TAG_REGEX = /<(?:redacted_thinking|think)>([\s\S]*)$/i;

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

export function splitStreamingAssistantContent(raw: string): SplitAssistantContentResult {
  const closed = splitAssistantContent(raw);
  if (closed.reasoning) {
    return closed;
  }

  const openMatch = raw.match(OPEN_THINKING_TAG_REGEX);
  if (openMatch) {
    const beforeTag = raw.slice(0, openMatch.index ?? 0);
    return {
      reasoning: openMatch[1]?.trim() ?? "",
      answer: splitAssistantContent(beforeTag).answer
    };
  }

  return closed;
}

export function looksLikeInternalReasoning(text: string) {
  const trimmed = text.trim();
  if (/^<(?:redacted_thinking|think)>/i.test(trimmed)) {
    return true;
  }
  return /^(The user|I should|They're|Let me|According to|Thinking|Okay,|I need to|I'll |I am MiniMax)/i.test(trimmed);
}

export function classifyStreamingModelContent(raw: string): SplitAssistantContentResult {
  const tagged = splitStreamingAssistantContent(raw);
  if (tagged.reasoning) {
    return tagged;
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return { reasoning: "", answer: "" };
  }

  const chineseIndex = trimmed.search(/[\u4e00-\u9fff]/);
  if (chineseIndex > 0) {
    const before = trimmed.slice(0, chineseIndex).trim();
    const after = trimmed.slice(chineseIndex).trim();
    if (looksLikeInternalReasoning(before)) {
      return { reasoning: before, answer: after };
    }
  }

  if (looksLikeInternalReasoning(trimmed) && chineseIndex < 0) {
    return { reasoning: trimmed, answer: "" };
  }

  return tagged;
}

export function mergeReasoningText(...parts: Array<string | undefined>) {
  return parts
    .map((part) => part?.trim())
    .filter(Boolean)
    .join("\n\n");
}
