import { beforeEach, expect, it, vi } from "vitest";
import type { Page } from "playwright/test";
import { dismissXiaozeToggleHintIfPresent } from "../e2e/quality/helpers";

const state = vi.hoisted(() => ({
  mounted: true,
  hintVisible: false,
  readiness: "suppressed",
  reveal: async () => undefined,
  waits: vi.fn(),
  dismiss: vi.fn(),
}));

vi.mock("playwright/test", () => ({
  test: { step: async (_name: string, callback: () => Promise<void>) => callback() },
  expect: (locator: { id: string }) => ({
    toHaveAttribute: async (_name: string, expected: string | RegExp, options?: { timeout: number }) => {
      state.waits(locator.id);
      expect(state.mounted).toBe(true);
      if (state.readiness === "pending") {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([state.reveal(), new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error("hint readiness timed out")), options?.timeout ?? 5_000);
          })]);
        } finally { clearTimeout(timer); }
      }
      if (expected instanceof RegExp) expect(state.readiness).toMatch(expected);
      else expect(state.readiness).toBe(expected);
    },
    toBeHidden: async () => { expect(state.hintVisible).toBe(false); },
  }),
}));

const page = {
  getByTestId: (id: string) => ({
    id,
    count: async () => state.mounted ? 1 : 0,
    isVisible: async () => state.hintVisible,
    getByRole: () => ({ click: async () => {
      state.dismiss();
      state.hintVisible = false;
      state.readiness = "suppressed";
    } }),
  }),
  locator: () => ({ count: async () => 0 }),
} as unknown as Page;

beforeEach(() => {
  state.mounted = true;
  state.hintVisible = false;
  state.readiness = "suppressed";
  state.reveal = vi.fn(async () => undefined);
  state.waits.mockClear();
  state.dismiss.mockClear();
});

it("returns immediately when the optional hint is not mounted", async () => {
  state.mounted = false;
  await dismissXiaozeToggleHintIfPresent(page);
  expect(state.waits).not.toHaveBeenCalled();
  expect(state.dismiss).not.toHaveBeenCalled();
});

it("does not wait for the reveal timer when the marker reports suppressed", async () => {
  await dismissXiaozeToggleHintIfPresent(page);
  expect(state.reveal).not.toHaveBeenCalled();
  expect(state.dismiss).not.toHaveBeenCalled();
});

it("waits for a mounted pending hint to reveal, then dismisses it and verifies suppression", async () => {
  state.readiness = "pending";
  state.reveal = vi.fn(async () => {
    state.readiness = "revealed";
    state.hintVisible = true;
  });
  await dismissXiaozeToggleHintIfPresent(page);
  expect(state.reveal).toHaveBeenCalledOnce();
  expect(state.dismiss).toHaveBeenCalledOnce();
  expect(state.waits).toHaveBeenCalledTimes(2);
  expect(state.readiness).toBe("suppressed");
});

it("does not silently accept a mounted hint that remains pending", async () => {
  state.readiness = "pending";
  await expect(dismissXiaozeToggleHintIfPresent(page)).rejects.toThrow();
});

it("waits for a scheduler-delayed reveal without a sleep or accepting pending readiness", async () => {
  vi.useFakeTimers();
  try {
    state.readiness = "pending";
    state.reveal = () => new Promise<void>((resolve) => setTimeout(() => {
      state.readiness = "revealed";
      state.hintVisible = true;
      resolve();
    }, 3_000));
    const settled = expect(dismissXiaozeToggleHintIfPresent(page)).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(3_000);
    await settled;
    expect(state.dismiss).toHaveBeenCalledOnce();
  } finally { vi.useRealTimers(); }
});
