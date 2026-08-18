import { describe, expect, it } from "vitest";
import {
  formatPrimaryShortcut,
  isApplePlatform,
  isPrimaryModifier,
  isTypingTarget,
  shouldIgnoreAppShortcut
} from "./keyboardShortcuts";

describe("keyboard shortcut convention", () => {
  it("treats Apple user agents as ⌘ platforms and others as Ctrl", () => {
    expect(isApplePlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)")).toBe(true);
    expect(isApplePlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe(false);
    expect(formatPrimaryShortcut("f", "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)")).toBe("⌘F");
    expect(formatPrimaryShortcut("f", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("Ctrl+F");
  });

  it("matches the platform primary modifier without treating the other key as primary", () => {
    expect(isPrimaryModifier({ metaKey: true, ctrlKey: false }, "Mozilla/5.0 (Macintosh)")).toBe(true);
    expect(isPrimaryModifier({ metaKey: false, ctrlKey: true }, "Mozilla/5.0 (Macintosh)")).toBe(false);
    expect(isPrimaryModifier({ metaKey: false, ctrlKey: true }, "Mozilla/5.0 (Windows NT 10.0)")).toBe(true);
    expect(isPrimaryModifier({ metaKey: true, ctrlKey: false }, "Mozilla/5.0 (Windows NT 10.0)")).toBe(false);
  });

  it("ignores shortcuts while typing or when ⌘/Ctrl is held", () => {
    const input = document.createElement("input");
    expect(isTypingTarget(input)).toBe(true);
    expect(isTypingTarget(document.createElement("div"))).toBe(false);

    const typingEvent = new KeyboardEvent("keydown", { key: "j" });
    Object.defineProperty(typingEvent, "target", { value: input });
    expect(shouldIgnoreAppShortcut(typingEvent)).toBe(true);

    const modified = new KeyboardEvent("keydown", { key: "j", metaKey: true });
    expect(shouldIgnoreAppShortcut(modified)).toBe(true);

    const bare = new KeyboardEvent("keydown", { key: "j" });
    expect(shouldIgnoreAppShortcut(bare)).toBe(false);
  });
});
