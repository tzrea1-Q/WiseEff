const THINKING_TAG = "redacted_thinking";
const THINKING_BLOCK_STRIP = new RegExp(`<(?:${THINKING_TAG}|think)>[\\s\\S]*?<\\/(?:${THINKING_TAG}|think)>`, "gi");

/** Strip complete thinking blocks only; keep whitespace stable while streaming. */
export function stripEmbeddedThinkingForStream(raw: string) {
  return raw.replace(THINKING_BLOCK_STRIP, "");
}

export function stripEmbeddedThinking(raw: string) {
  return stripEmbeddedThinkingForStream(raw).replace(/^\s+/, "").trim();
}
