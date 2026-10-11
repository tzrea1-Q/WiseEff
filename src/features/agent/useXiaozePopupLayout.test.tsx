import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useXiaozePopupLayout } from "./useXiaozePopupLayout";

function Launcher() {
  useXiaozePopupLayout();
  return <div data-xiaoze-launcher-anchor=""><button data-xiaoze-launcher-drag-handle="">打开小泽</button></div>;
}

afterEach(() => vi.unstubAllGlobals());

it("keeps keyboard movement in the bottom gutter and reachable after resizing", () => {
  vi.stubGlobal("innerWidth", 1440);
  vi.stubGlobal("innerHeight", 900);
  render(<Launcher />);
  const button = screen.getByRole("button", { name: "打开小泽" });
  const anchor = button.parentElement!;
  button.focus();
  fireEvent.keyDown(button, { key: "ArrowUp", shiftKey: true });
  expect(anchor.style.getPropertyValue("--xiaoze-launcher-top")).toBe("820px");
  fireEvent.keyDown(button, { key: "ArrowLeft" });
  expect(anchor.style.getPropertyValue("--xiaoze-launcher-left")).toBe("1352px");
  expect(button).toHaveFocus();
  vi.stubGlobal("innerWidth", 1280);
  vi.stubGlobal("innerHeight", 800);
  fireEvent(window, new Event("resize"));
  expect(anchor.style.getPropertyValue("--xiaoze-launcher-top")).toBe("720px");
  expect(anchor.style.getPropertyValue("--xiaoze-launcher-left")).toBe("1208px");
});
