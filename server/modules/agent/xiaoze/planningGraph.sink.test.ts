import { describe, expect, it, vi } from "vitest";
import { createXiaozeCheckpointer } from "./checkpointer";
import { createPlanningAgent, fakeModelSequence, toolCall } from "./planningGraph";
import { createRunEventSink } from "./runEventSink";
import type { PerceptionChatModel } from "./perceptionAgent";
import { invokeModelTurnWithStreaming } from "./perceptionAgent";

describe("planningGraph run event sink", () => {
  it("emits tool step and result events while executing read tools", async () => {
    const sink = createRunEventSink();
    const runTool = vi.fn().mockResolvedValue({ summary: "12 parameters", data: {}, citations: [] });
    const agent = createPlanningAgent({
      model: fakeModelSequence([
        { toolCalls: [toolCall("perception.getProjectOverview", { projectId: "p1" })] },
        { content: "Project p1 has 12 parameters" }
      ]),
      runTool,
      listTools: () => [{ name: "perception.getProjectOverview", description: "x", schema: {} }],
      checkpointer: createXiaozeCheckpointer()
    });

    const resultPromise = agent.run({ message: "summarize p1", context: { projectId: "p1" }, threadId: "t-sink", sink });
    const collected: string[] = [];
    while (true) {
      const events = await sink.drain(50);
      collected.push(...events.map((event) => event.type));
      if (events.length === 0) {
        const done = await Promise.race([
          resultPromise.then(() => true),
          new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 100))
        ]);
        if (done) {
          sink.close();
          const tail = await sink.drain(0);
          collected.push(...tail.map((event) => event.type));
          break;
        }
      }
    }

    const result = await resultPromise;
    expect(result.text).toContain("12 parameters");
    expect(collected).toContain("step_started");
    expect(collected).toContain("tool_call");
    expect(collected).toContain("tool_result");
    expect(result.runSteps?.some((step) => step.kind === "tool")).toBe(true);
  });

  it("streams perceive deltas before the run completes for direct answers", async () => {
    const sink = createRunEventSink();
    const runTool = vi.fn();
    const model: PerceptionChatModel = {
      async invoke() {
        return { content: "Hello there", reasoning: "Greeting" };
      },
      async *stream() {
        yield { reasoningDelta: "Gre" };
        await new Promise((resolve) => setTimeout(resolve, 20));
        yield { reasoningDelta: "eting" };
        await new Promise((resolve) => setTimeout(resolve, 20));
        yield { answerDelta: "Hello" };
        yield { answerDelta: " there" };
      }
    };
    const agent = createPlanningAgent({
      model,
      runTool,
      listTools: () => [],
      checkpointer: createXiaozeCheckpointer()
    });

    let sawDeltaBeforeDone = false;
    const resultPromise = agent.run({ message: "你好", context: {}, threadId: "t-stream-perceive", sink });
    while (true) {
      const events = await sink.drain(10);
      if (events.some((event) => event.type === "reasoning_delta" || event.type === "answer_delta")) {
        const done = await Promise.race([
          resultPromise.then(() => true),
          new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 0))
        ]);
        if (!done) {
          sawDeltaBeforeDone = true;
        }
      }
      if (await Promise.race([
        resultPromise.then(() => true),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), events.length === 0 ? 50 : 0))
      ])) {
        sink.close();
        await sink.drain(0);
        break;
      }
    }

    const result = await resultPromise;
    expect(result.text).toBe("Hello there");
    expect(sawDeltaBeforeDone).toBe(true);
  });
});

describe("invokeModelTurnWithStreaming", () => {
  it("returns tool calls collected from the stream tail", async () => {
    const model: PerceptionChatModel = {
      async invoke() {
        return { toolCalls: [{ id: "tc-1", name: "perception.getProjectOverview", args: { projectId: "p1" } }] };
      },
      async *stream() {
        yield { reasoningDelta: "Checking" };
        yield { toolCalls: [{ id: "tc-1", name: "perception.getProjectOverview", args: { projectId: "p1" } }] };
      }
    };
    const deltas: string[] = [];
    const response = await invokeModelTurnWithStreaming(model, [], (chunk) => {
      if (chunk.reasoningDelta) {
        deltas.push(chunk.reasoningDelta);
      }
    });
    expect(deltas).toEqual(["Checking"]);
    expect(response.toolCalls?.[0]?.name).toBe("perception.getProjectOverview");
  });
});

describe("planningGraph perceive answer streaming", () => {
  it("does not stream perceive answer deltas when the model chooses tools", async () => {
    const sink = createRunEventSink();
    const runTool = vi.fn().mockResolvedValue({ summary: "4 parameters", data: {}, citations: [] });
    const model: PerceptionChatModel = {
      async invoke() {
        return {
          content: "我来帮您搜索参数。",
          toolCalls: [{ id: "tc-1", name: "perception.searchParameters", args: { projectId: "aurora", query: "charge" } }]
        };
      },
      async *stream() {
        yield { answerDelta: "我来帮您搜索参数。" };
        yield { toolCalls: [{ id: "tc-1", name: "perception.searchParameters", args: { projectId: "aurora", query: "charge" } }] };
      }
    };
    const agent = createPlanningAgent({
      model,
      runTool,
      listTools: () => [{ name: "perception.searchParameters", description: "x", schema: {} }],
      checkpointer: createXiaozeCheckpointer()
    });

    const answerDeltas: string[] = [];
    const resultPromise = agent.run({
      message: "charge 参数有哪些？",
      context: { projectId: "aurora" },
      threadId: "t-no-perceive-answer",
      sink
    });

    while (true) {
      const events = await sink.drain(20);
      for (const event of events) {
        if (event.type === "answer_delta") {
          answerDeltas.push(event.delta);
        }
      }
      if (
        await Promise.race([
          resultPromise.then(() => true),
          new Promise<boolean>((resolve) => setTimeout(() => resolve(false), events.length === 0 ? 80 : 0))
        ])
      ) {
        sink.close();
        await sink.drain(0);
        break;
      }
    }

    await resultPromise;
    expect(answerDeltas.join("")).not.toContain("我来帮您");
  });
});
