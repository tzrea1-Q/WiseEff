const THINKING_TAG = "redacted_thinking";
const THINKING_BLOCK_STRIP = new RegExp(`<(?:${THINKING_TAG}|think)>[\\s\\S]*?<\\/(?:${THINKING_TAG}|think)>`, "gi");

/** Strip complete thinking blocks only; keep whitespace stable while streaming. */
export function stripEmbeddedThinkingForStream(raw: string) {
  return raw.replace(THINKING_BLOCK_STRIP, "");
}

export function stripEmbeddedThinking(raw: string) {
  return stripEmbeddedThinkingForStream(raw).replace(/^\s+/, "").trim();
}

export function looksLikeInternalReasoning(text: string) {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }
  if (/^<(?:redacted_thinking|think)>/i.test(trimmed)) {
    return true;
  }
  return /^(The user|I should|They're|Let me|According to|Thinking|Okay,|I need to|I'll |I am MiniMax|I found|I have)/i.test(
    trimmed
  );
}

/** Collapse accidental duplicate answer bodies (e.g. perceive preamble + observe reply). */
export function dedupeRepeatedAnswerText(raw: string) {
  const text = raw.trim();
  if (text.length < 120) {
    return text;
  }

  const anchors = [...text.matchAll(/([\u4e00-\u9fff][^\n#]{23,120})/g)]
    .map((match) => match[1]?.trim())
    .filter(Boolean);

  for (const anchor of anchors) {
    const first = text.indexOf(anchor);
    const second = text.indexOf(anchor, first + anchor.length);
    if (second > first + 60) {
      return text.slice(0, second).trim();
    }
  }

  return text;
}
