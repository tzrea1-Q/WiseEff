import { describe, expect, it } from "vitest";
import { createRunEventSink, startRunStep } from "./runEventSink";

describe("runEventSink", () => {
  it("drains queued events and tracks step records", async () => {
    const sink = createRunEventSink();
    const { step, finish } = startRunStep({ kind: "tool", label: "查询项目概览", toolName: "perception.getProjectOverview" });
    sink.push({ type: "step_started", step });
    sink.push(finish({ status: "succeeded", summary: "12 parameters" }));
    sink.close();

    const events = await sink.drain();
    expect(events).toHaveLength(2);
    expect(sink.getSteps()[0]?.status).toBe("succeeded");
    expect(sink.getSteps()[0]?.summary).toBe("12 parameters");
  });
});
