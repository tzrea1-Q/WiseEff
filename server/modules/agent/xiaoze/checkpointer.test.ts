import { describe, expect, it } from "vitest";
import { createXiaozeCheckpointer } from "./checkpointer";

describe("xiaoze checkpointer", () => {
  it("round-trips state per thread", async () => {
    const cp = createXiaozeCheckpointer();
    await cp.put("thread-1", { plan: ["a"], step: 1 });
    expect(await cp.get("thread-1")).toMatchObject({ plan: ["a"], step: 1 });
    expect(await cp.get("thread-unknown")).toBeUndefined();
  });
});
