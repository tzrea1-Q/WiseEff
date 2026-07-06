import { MemorySaver } from "@langchain/langgraph";
import { describe, expect, it } from "vitest";
import { createXiaozeCheckpointer, resolveXiaozeCheckpointerFromEnv } from "./checkpointer";

describe("xiaoze checkpointer", () => {
  it("round-trips state per thread", async () => {
    const cp = createXiaozeCheckpointer();
    await cp.put("thread-1", { plan: ["a"], step: 1 });
    expect(await cp.get("thread-1")).toMatchObject({ plan: ["a"], step: 1 });
    expect(await cp.get("thread-unknown")).toBeUndefined();
  });

  it("defaults to memory mode", () => {
    const cp = createXiaozeCheckpointer();
    expect(cp.saver).toBeInstanceOf(MemorySaver);
  });

  it("uses an injected saver when provided", () => {
    const injected = new MemorySaver();
    const cp = createXiaozeCheckpointer({ saver: injected });
    expect(cp.saver).toBe(injected);
  });

  it("uses the injected saver for postgres mode without a live database", () => {
    const injected = new MemorySaver();
    const cp = createXiaozeCheckpointer({ mode: "postgres", saver: injected });
    expect(cp.saver).toBe(injected);
  });

  it("resolves memory checkpointer by default from env", () => {
    const cp = resolveXiaozeCheckpointerFromEnv({});
    expect(cp.saver).toBeInstanceOf(MemorySaver);
  });

  it("forces memory when deterministic mode is enabled", () => {
    process.env.XIAOZE_DETERMINISTIC = "true";
    try {
      const cp = resolveXiaozeCheckpointerFromEnv({
        XIAOZE_CHECKPOINTER: "postgres",
        DATABASE_URL: "postgres://localhost/wiseeff"
      });
      expect(cp.saver).toBeInstanceOf(MemorySaver);
    } finally {
      delete process.env.XIAOZE_DETERMINISTIC;
    }
  });
});
