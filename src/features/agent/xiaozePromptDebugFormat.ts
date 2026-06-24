import type { XiaozePromptDebugSnapshot } from "./xiaozePromptDebugTypes";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object") {
    return value as Record<string, unknown>;
  }
  return undefined;
}

export function formatLlmMessageRole(message: unknown) {
  const record = asRecord(message);
  return typeof record?.role === "string" ? record.role : "unknown";
}

export function formatLlmMessageBody(message: unknown) {
  const record = asRecord(message);
  if (!record) {
    return "";
  }

  const parts: string[] = [];
  if (typeof record.content === "string" && record.content.length > 0) {
    parts.push(record.content);
  } else if (record.content !== undefined && record.content !== null && record.content !== "") {
    parts.push(JSON.stringify(record.content, null, 2));
  }

  if (record.tool_calls) {
    parts.push(`tool_calls:\n${JSON.stringify(record.tool_calls, null, 2)}`);
  }

  if (typeof record.tool_call_id === "string") {
    parts.unshift(`tool_call_id: ${record.tool_call_id}`);
  }

  if (typeof record.name === "string") {
    parts.unshift(`name: ${record.name}`);
  }

  return parts.join("\n\n").trim();
}

export function formatLlmMessagesTrace(messages: unknown[]) {
  if (messages.length === 0) {
    return "(empty)";
  }

  return messages
    .map((message, index) => {
      const role = formatLlmMessageRole(message);
      const body = formatLlmMessageBody(message);
      return `[${index + 1}] ${role}${body ? `\n${body}` : ""}`.trim();
    })
    .join("\n\n");
}

export function formatPromptDebugCopyText(snapshot: XiaozePromptDebugSnapshot) {
  const sections = [
    snapshot.model ? `=== Model ===\n${snapshot.model}` : undefined,
    `=== User message ===\n${snapshot.userMessage}`,
    `=== Page context ===\n${JSON.stringify(snapshot.context, null, 2)}`,
    `=== System policy ===\n${snapshot.system.policy}`,
    `=== Tool catalog ===\n${snapshot.system.toolCatalog}`,
    `=== Tool definitions ===\n${JSON.stringify(snapshot.tools, null, 2)}`,
    `=== LLM 交互 (${snapshot.llmMessages.length} 条) ===\n${formatLlmMessagesTrace(snapshot.llmMessages)}`
  ].filter(Boolean);

  return sections.join("\n\n");
}
