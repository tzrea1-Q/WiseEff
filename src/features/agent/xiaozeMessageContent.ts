const THINKING_TAG = "redacted_thinking";
const THINKING_BLOCK_STRIP = new RegExp(`<(?:${THINKING_TAG}|think)>[\\s\\S]*?<\\/(?:${THINKING_TAG}|think)>`, "gi");

export function stripEmbeddedThinking(raw: string) {
  return raw.replace(THINKING_BLOCK_STRIP, "").replace(/^\s+/, "").trim();
}
