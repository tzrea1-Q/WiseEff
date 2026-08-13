import type { PerceptionChatModel } from "./modelTypes";

/**
 * Scripted model used when XIAOZE_DETERMINISTIC=true (CI acceptance and local
 * demos): maps recognizable prompts to fixed tool calls and grounded replies
 * so runs are reproducible without a live LLM.
 */
export function createDeterministicPerceptionModel(): PerceptionChatModel {
  return {
    async invoke(messages) {
      const userMessage = messages.find(
        (message) => typeof message === "object" && message && "role" in message && (message as { role: string }).role === "user"
      ) as { content?: string } | undefined;
      const text = userMessage?.content ?? "";
      const hasToolResult = messages.some(
        (message) => typeof message === "object" && message && "role" in message && (message as { role: string }).role === "tool"
      );
      if (!hasToolResult) {
        const forbidden = /secret|forbidden|denied|越权|无权限/i.test(text);
        if (forbidden) {
          return {
            toolCalls: [{ id: "tc-forbidden", name: "perception.getProjectOverview", args: { projectId: "secret-project" } }]
          };
        }
        // Deterministic distillation: `创建知识草稿:<标题>`(可选 `来源日志:<logId>`)
        // pins the approval-gated draft tool so acceptance can drive the interrupt.
        // Match a single line only: the planner appends page context on new lines.
        const draftMatch = text.match(/(?:创建知识草稿|create knowledge draft)[:：]\s*([^\n]+)/i);
        if (draftMatch) {
          const draftLine = draftMatch[1].trim();
          const sourceMatch = draftLine.match(/\s+(?:来源日志|source-log)[:：]\s*(\S+)\s*$/i);
          const title = sourceMatch ? draftLine.slice(0, sourceMatch.index).trim() : draftLine;
          return {
            toolCalls: [
              {
                id: "tc-knowledge-draft",
                name: "action.createKnowledgeDraft",
                args: {
                  title,
                  contentMarkdown: `## 结论\n\n${title}\n\n(由小泽在对话中沉淀,待人工审阅发布。)`,
                  tags: ["小泽沉淀"],
                  ...(sourceMatch ? { sourceLogId: sourceMatch[1] } : {})
                }
              }
            ]
          };
        }
        // Deterministic knowledge grounding: `知识库检索:<keywords>` pins the
        // query; any knowledge-base mention falls back to the full message.
        const knowledgeQueryMatch = text.match(/(?:知识库检索|knowledge search)[:：]\s*(.+)/i);
        if (knowledgeQueryMatch || /知识库|knowledge base/i.test(text)) {
          return {
            toolCalls: [
              {
                id: "tc-knowledge",
                name: "knowledge.search",
                args: { query: (knowledgeQueryMatch?.[1] ?? text).trim() }
              }
            ]
          };
        }
        const changeMatch = text.match(/(?:set|change)\s+([a-z0-9-]+)\s+(?:to|=)\s+(\S+)/i);
        if (changeMatch) {
          return {
            toolCalls: [
              {
                id: "tc-action",
                name: "action.submitParameterChange",
                args: {
                  projectId: "aurora",
                  parameterId: changeMatch[1],
                  targetValue: changeMatch[2],
                  reason: "Xiaoze action request"
                }
              }
            ]
          };
        }
        const projectMatch = text.match(/project\s+([a-z0-9-]+)/i);
        const projectId = projectMatch?.[1] ?? "aurora";
        return {
          toolCalls: [{ id: "tc-overview", name: "perception.getProjectOverview", args: { projectId } }]
        };
      }
      const toolMessage = messages.find(
        (message) => typeof message === "object" && message && "role" in message && (message as { role: string }).role === "tool"
      ) as { content?: string } | undefined;
      const payload = toolMessage?.content ? JSON.parse(toolMessage.content) : {};
      if (payload.error === "FORBIDDEN") {
        return { content: "You are not permitted to access that project. I cannot share its data." };
      }
      const citationType =
        Array.isArray(payload.citations) && typeof payload.citations[0]?.type === "string"
          ? payload.citations[0].type
          : "parameter";
      return { content: `${payload.summary ?? "Grounded summary."} [citation:${citationType}]` };
    }
  };
}
