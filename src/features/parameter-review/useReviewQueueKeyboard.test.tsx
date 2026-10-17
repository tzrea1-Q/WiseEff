import { fireEvent, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import { describe, expect, it } from "vitest";
import { useReviewQueueKeyboard } from "./useReviewQueueKeyboard";

function Queue() {
  const [selected, setSelected] = useState("first");
  const queueRef = useRef<HTMLElement>(null);
  const detailRef = useRef<HTMLElement>(null);
  useReviewQueueKeyboard({ enabled: true, rowIds: ["first", "second"], selectedId: selected,
    onSelect: setSelected, onOpenSelected: () => detailRef.current?.focus(), queueRef, detailRef });
  return <>
    <section ref={queueRef} aria-label="队列" tabIndex={-1}>
      {["first", "second"].map((id) => <div key={id} data-review-row-id={id} tabIndex={selected === id ? 0 : -1}
        aria-current={selected === id}>{id}</div>)}
      <button type="button" onKeyDown={(event) => event.preventDefault()}>已处理按键的组件</button>
      <input aria-label="队列内输入" />
      <div role="tree" aria-label="队列内树"><div role="treeitem" aria-selected={false} tabIndex={0}>树节点</div></div>
    </section>
    <section ref={detailRef} aria-label="详情" tabIndex={-1}>
      <pre tabIndex={0 /* eslint-disable-line jsx-a11y/no-noninteractive-tabindex -- The test exercises keyboard scrolling in the actual focusable source pattern. */} aria-label="源码">source</pre>
      <details><summary>完整文件</summary>source</details>
    </section>
    <button type="button">外部操作</button>
  </>;
}

describe("review queue keyboard scope", () => {
  it("moves between real queue rows and keeps explicit shortcuts to the two panes", () => {
    render(<Queue />);
    const first = screen.getByText("first");
    const second = screen.getByText("second");
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(second).toHaveFocus();
    expect(second).toHaveAttribute("aria-current", "true");
    fireEvent.keyDown(second, { key: "k" });
    expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: "j", metaKey: true });
    fireEvent.keyDown(first, { key: "ArrowDown", ctrlKey: true });
    expect(first).toHaveAttribute("aria-current", "true");
    fireEvent.keyDown(first, { key: "Enter" });
    expect(screen.getByRole("region", { name: "详情" })).toHaveFocus();
    fireEvent.keyDown(window, { key: "1", altKey: true });
    expect(first).toHaveFocus();
    fireEvent.keyDown(window, { key: "2", altKey: true });
    expect(screen.getByRole("region", { name: "详情" })).toHaveFocus();
  });

  it("leaves source scrolling, disclosures, tree keys and outside controls untouched with multiple requests", () => {
    render(<Queue />);
    for (const target of [screen.getByLabelText("源码"), screen.getByText("完整文件"),
      screen.getByRole("treeitem"), screen.getByRole("button", { name: "外部操作" }),
      screen.getByRole("textbox", { name: "队列内输入" })]) {
      target.focus();
      for (const key of ["ArrowDown", "ArrowUp", "j", "k", "Enter"]) {
        const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
        fireEvent(target, event);
        expect(event.defaultPrevented).toBe(false);
        expect(target).toHaveFocus();
        expect(screen.getByText("first")).toHaveAttribute("aria-current", "true");
      }
    }
  });

  it("respects another component's prevented event inside the queue", () => {
    render(<Queue />);
    const control = screen.getByText("已处理按键的组件");
    control.focus();
    fireEvent.keyDown(control, { key: "ArrowDown" });
    expect(control).toHaveFocus();
    expect(screen.getByText("first")).toHaveAttribute("aria-current", "true");
  });
});
