import { StrictMode, createRef } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, afterEach, describe, expect, it, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import { undo } from "@codemirror/commands";
import { foldCode, foldedRanges, foldable, ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { SearchQuery, replaceAll, setSearchQuery } from "@codemirror/search";
import { EditorState } from "@codemirror/state";
import { WorkbenchDtsEditor, type WorkbenchDtsEditorHandle, type WorkbenchDtsEditorProps, type WorkbenchDtsEditorSessions } from "./WorkbenchDtsEditor";
import { collectDtsEditorFolds } from "./dtsEditorFolds";
import { dtsEditorLanguage } from "./dtsEditorLanguage";

beforeAll(() => {
  // JSDOM has no layout engine. Native browser acceptance owns editor geometry.
  Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect ??= () => new DOMRect();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

function setup(overrides: Partial<WorkbenchDtsEditorProps> = {}) {
  const handle = createRef<WorkbenchDtsEditorHandle>();
  const props: WorkbenchDtsEditorProps = { sessionKey: "user/org/project/config/file-a", text: '/ {\n  labels = "one", "one", "";\n};\n', readOnly: false, onChange: vi.fn(), onDirtyChange: vi.fn(), onSave: vi.fn(), ...overrides };
  const result = render(<WorkbenchDtsEditor {...props} ref={handle} />);
  const getEditor = () => EditorView.findFromDOM(result.container.querySelector(".cm-editor") as HTMLElement)!;
  return { ...result, props, handle, getEditor, rerenderProps: (patch: Partial<WorkbenchDtsEditorProps>) => {
    Object.assign(props, patch);
    result.rerender(<WorkbenchDtsEditor {...props} ref={handle} />);
  } };
}

describe("WorkbenchDtsEditor", () => {
  it("accepts an explicit saved baseline without losing selection, scroll or undo",()=>{
    const input=setup({text:"original",baseText:"original",baselineRevision:1});
    const editor=input.getEditor();
    act(()=>editor.dispatch({changes:{from:8,insert:" changed"},selection:{anchor:4}}));
    editor.scrollDOM.scrollTop=37;editor.scrollDOM.scrollLeft=21;
    input.rerenderProps({baseText:"original changed",baselineRevision:2});
    expect(input.handle.current?.getSnapshot()).toMatchObject({text:"original changed",dirty:false,selection:{anchor:4,head:4}});
    expect(editor.scrollDOM.scrollTop).toBe(37);expect(editor.scrollDOM.scrollLeft).toBe(21);
    act(()=>undo(editor));
    expect(input.handle.current?.getSnapshot()).toMatchObject({text:"original",dirty:true});
  });
  it("reveals a repeated explicit result but ignores unrelated focus-line updates", () => {
    const span = { startLine: 2, endLine: 2 };
    const input = setup({ focusSpan: span, focusLine: 2 });
    const scroll = vi.spyOn(EditorView, "scrollIntoView");
    input.rerenderProps({ focusLine: null });
    expect(scroll).not.toHaveBeenCalled();
    input.rerenderProps({ focusSpan: { ...span } });
    expect(scroll).toHaveBeenCalledOnce();
    scroll.mockRestore();
  });

  it("highlights a navigation search without moving until a result or next command is chosen", () => {
    const input = setup({ findNextToken: 0 });
    const editor = input.getEditor();
    const selection = editor.state.selection.main;
    input.rerenderProps({ findQuery: "one", findNextToken: 0 });
    expect(editor.state.selection.main).toEqual(selection);
    input.rerenderProps({ findNextToken: 1 });
    const match = editor.state.selection.main;
    expect(editor.state.sliceDoc(match.from, match.to)).toBe("one");
  });

  it("marks edits immediately and captures Cmd/Ctrl+S before debounced persistence", () => {
    vi.useFakeTimers();
    const input = setup();
    const editor = input.getEditor();
    act(() => editor.dispatch({ changes: { from: editor.state.doc.length, insert: "// draft" } }));
    expect(input.props.onDirtyChange).toHaveBeenLastCalledWith({ sessionKey: input.props.sessionKey, generation: 1, dirty: true });
    expect(input.props.onChange).not.toHaveBeenCalled();
    expect(fireEvent.keyDown(editor.contentDOM, { key: "s", ctrlKey: true })).toBe(false);
    expect(input.props.onSave).toHaveBeenCalledWith(expect.objectContaining({ text: `${input.props.text}// draft`, generation: 1, sessionKey: input.props.sessionKey }));
    expect(input.props.onChange).toHaveBeenCalledOnce();
    act(() => vi.advanceTimersByTime(400));
    expect(input.props.onChange).toHaveBeenCalledOnce();
  });

  it("enforces read-only against direct changes, paste/drop and replace commands", () => {
    const input = setup({ readOnly: true });
    const editor = input.getEditor();
    act(() => editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: "overwritten" } }));
    expect(editor.state.doc.toString()).toBe(input.props.text);
    expect(fireEvent.paste(editor.contentDOM)).toBe(false);
    expect(fireEvent.drop(editor.contentDOM)).toBe(false);
    act(() => {
      editor.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: "one", replace: "two" })) });
      replaceAll(editor);
    });
    expect(editor.state.doc.toString()).toBe(input.props.text);
    expect(fireEvent.keyDown(editor.contentDOM, { key: "s", metaKey: true })).toBe(false);
    expect(input.props.onSave).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "DTS 源码" })).toHaveAttribute("aria-readonly", "true");
    expect(screen.getByRole("textbox", { name: "DTS 源码" })).toHaveAttribute("tabindex", "0");
  });

  it("retains buffer, selection, folds and undo when preview mode changes", () => {
    const input = setup();
    const editor = input.getEditor();
    act(() => {
      editor.dispatch({ changes: { from: editor.state.doc.length, insert: "// draft" }, selection: { anchor: 1 } });
    });
    act(() => input.handle.current?.flush());
    // Fresh analysis is delayed until the user pauses; the initial range is invalidated by edits touching it.
    act(() => input.handle.current?.revealLine(1));
    act(() => foldCode(editor));
    expect(foldedRanges(editor.state).size).toBe(1);
    input.rerenderProps({ readOnly: true });
    expect(editor.state.selection.main.anchor).toBe(1);
    expect(editor.state.doc.toString()).toContain("// draft");
    expect(foldedRanges(editor.state).size).toBe(1);
    input.rerenderProps({ readOnly: false });
    act(() => undo(editor));
    expect(editor.state.doc.toString()).toBe(input.props.text);
    expect(input.props.onDirtyChange).toHaveBeenLastCalledWith(expect.objectContaining({ dirty: false }));
  });

  it.each(["line", "span"] as const)("reveals a folded %s target without opening unrelated folds or moving the cursor", (target) => {
    const source = "/ {\n  node {\n    value = <1>;\n  };\n  other {\n    value = <2>;\n  };\n};\n";
    const input = setup({ text: source, readOnly: true });
    const editor = input.getEditor();
    act(() => {
      for (const line of [2, 5]) {
        editor.dispatch({ selection: { anchor: editor.state.doc.line(line).from } });
        foldCode(editor);
      }
    });
    expect(foldedRanges(editor.state).size).toBe(2);
    const selection = editor.state.selection.main;
    if (target === "line") act(() => input.handle.current?.revealLine(3));
    else input.rerenderProps({ focusSpan: { startLine: 3, endLine: 3, startColumn: 5, endColumn: 17 } });
    expect(foldedRanges(editor.state).size).toBe(1);
    expect(editor.contentDOM.textContent).toContain("value = <1>;");
    expect(editor.contentDOM.textContent).not.toContain("value = <2>;");
    expect(editor.state.selection.main).toEqual(selection);
    expect(input.handle.current?.getSnapshot()).toMatchObject({ text: source, dirty: false });
  });

  it("preserves separate file sessions and does not let prop refresh overwrite a dirty buffer", () => {
    const input = setup();
    const editor = input.getEditor();
    act(() => editor.dispatch({ changes: { from: editor.state.doc.length, insert: "// file A" }, selection: { anchor: 2 } }));
    input.rerenderProps({ sessionKey: "user/org/project/config/file-b", text: "/ { b; };" });
    expect(input.props.onChange).toHaveBeenCalledWith(expect.objectContaining({ sessionKey: "user/org/project/config/file-a", text: expect.stringContaining("// file A") }));
    act(() => editor.dispatch({ changes: { from: editor.state.doc.length, insert: "// file B" } }));
    input.rerenderProps({ sessionKey: "user/org/project/config/file-a", text: "server refresh" });
    expect(editor.state.doc.toString()).toContain("// file A");
    expect(editor.state.selection.main.anchor).toBe(2);
    act(() => undo(editor));
    expect(editor.state.doc.toString()).not.toContain("// file A");
    input.rerenderProps({ resetKey: "discard", text: "latest base" });
    expect(editor.state.doc.toString()).toBe("latest base");
    expect(input.handle.current?.getSnapshot()?.dirty).toBe(false);
  });

  it("preserves BOM, CRLF and exact numeric tokens", () => {
    const source = '\uFEFF/ {\r\n  values = /bits/ 64 <9007199254740993>;\r\n};\r\n';
    const input = setup({ text: source });
    expect(input.handle.current?.getSnapshot()).toMatchObject({ text: source, normalizedLineEndings: false });
    act(() => input.getEditor().dispatch({ changes: { from: 0, insert: "// edit\n" } }));
    expect(input.handle.current?.getSnapshot()).toMatchObject({ text: `// edit\r\n${source}`, normalizedLineEndings: false });
  });

  it("preserves untouched mixed line endings through preview flush and file switches, and restores them on undo", () => {
    const source = '\uFEFF/ {\r\n  enabled;\n};\r';
    const input = setup({ text: source, readOnly: true });
    act(() => input.handle.current?.flush());
    expect(input.props.onChange).toHaveBeenLastCalledWith(expect.objectContaining({ text: source, dirty: false, normalizedLineEndings: false }));
    input.rerenderProps({ sessionKey: "other-file", text: "/ { other; };" });
    expect(input.props.onChange).toHaveBeenLastCalledWith(expect.objectContaining({ sessionKey: "user/org/project/config/file-a", text: source, normalizedLineEndings: false }));
    input.rerenderProps({ sessionKey: "user/org/project/config/file-a", text: "ignored refresh", readOnly: false });
    const editor = input.getEditor();
    expect(input.handle.current?.getSnapshot()).toMatchObject({ text: source, dirty: false, normalizedLineEndings: false });
    act(() => editor.dispatch({ changes: { from: editor.state.doc.length, insert: "// edited" } }));
    expect(input.handle.current?.getSnapshot()).toMatchObject({ text: `${source.replace(/\r\n?|\n/g, "\n")}// edited`, dirty: true, normalizedLineEndings: true });
    act(() => input.handle.current?.flush());
    expect(input.props.onChange).toHaveBeenLastCalledWith(expect.objectContaining({ normalizedLineEndings: true }));
    input.rerenderProps({ readOnly: true });
    input.rerenderProps({ readOnly: false });
    act(() => undo(editor));
    expect(input.handle.current?.getSnapshot()).toMatchObject({ text: source, dirty: false, normalizedLineEndings: false });
    input.unmount();
    expect(input.props.onChange).toHaveBeenLastCalledWith(expect.objectContaining({ text: source, normalizedLineEndings: false }));
  });

  it("marks a recovered draft against its authoritative source", () => {
    const input = setup({ text: "/ { changed; };", baseText: "/ { enabled; };" });
    expect(input.handle.current?.getSnapshot()).toMatchObject({ text: "/ { changed; };", dirty: true });
  });

  it("does not flush the replaced buffer when recovery or discard explicitly resets the same file", () => {
    vi.useFakeTimers();
    const input = setup({ text: "/ { original; };", resetKey: "loading" });
    input.rerenderProps({ text: "/ { recovered; };", baseText: "/ { original; };", resetKey: "ready" });
    expect(input.props.onChange).not.toHaveBeenCalled();
    expect(input.handle.current?.getSnapshot()).toMatchObject({ text: "/ { recovered; };", dirty: true });
    const editor = input.getEditor();
    act(() => editor.dispatch({ changes: { from: editor.state.doc.length, insert: "// pending" } }));
    input.rerenderProps({ text: "/ { original; };", resetKey: "discarded" });
    act(() => vi.advanceTimersByTime(400));
    expect(input.props.onChange).not.toHaveBeenCalled();
    expect(input.handle.current?.getSnapshot()).toMatchObject({ text: "/ { original; };", dirty: false });
  });

  it("retains history across unmount with a scoped cache and rebinds callbacks to the new owner", () => {
    const sessions: WorkbenchDtsEditorSessions = new Map();
    const first = setup({ sessions });
    const editor = first.getEditor();
    act(() => editor.dispatch({ changes: { from: editor.state.doc.length, insert: "// first" } }));
    first.unmount();
    vi.mocked(first.props.onDirtyChange!).mockClear();
    const second = setup({ sessions, initialSelection: { anchor: 1, head: 1 } });
    expect(second.getEditor().state.doc.toString()).toContain("// first");
    act(() => undo(second.getEditor()));
    expect(second.getEditor().state.doc.toString()).toBe(second.props.text);
    expect(first.props.onDirtyChange).not.toHaveBeenCalled();
    expect(second.props.onDirtyChange).toHaveBeenLastCalledWith(expect.objectContaining({ dirty: false, generation: 2 }));
    second.rerenderProps({ readOnly: true });
    act(() => second.getEditor().dispatch({ changes: { from: 0, insert: "blocked" } }));
    expect(second.getEditor().state.doc.toString()).toBe(second.props.text);
  });

  it("survives StrictMode effect replay without flushing an empty intermediate document", () => {
    const onChange = vi.fn();
    const handle = createRef<WorkbenchDtsEditorHandle>();
    render(<StrictMode><WorkbenchDtsEditor ref={handle} sessionKey="strict" text="/ { enabled; };" readOnly={false} onChange={onChange} initialSelection={{ anchor: 4, head: 4 }} /></StrictMode>);
    expect(handle.current?.getSnapshot()).toMatchObject({ text: "/ { enabled; };", selection: { anchor: 4, head: 4 } });
    expect(onChange.mock.calls.every(([snapshot]) => snapshot.text === "/ { enabled; };")).toBe(true);
  });

  it("rejects a worker result from the previous document after reset even when generation is zero", () => {
    const instances: WorkerMock[] = [];
    type Request = { sessionKey: string; generation: number; analysisId: number; text: string };
    class WorkerMock {
      requests: Request[] = [];
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: (() => void) | null = null;
      constructor() { instances.push(this); }
      postMessage(request: Request) { this.requests.push(request); }
      terminate() {}
    }
    vi.stubGlobal("Worker", WorkerMock);
    const input = setup();
    const worker = instances[0];
    const previous = worker.requests[0];
    input.rerenderProps({ resetKey: "new-source", text: "/ {\n updated;\n};" });
    const current = worker.requests.at(-1)!;
    act(() => worker.onmessage?.({ data: { ...previous, folds: collectDtsEditorFolds(previous.text) } } as MessageEvent));
    const firstLine = input.getEditor().state.doc.line(1);
    expect(foldable(input.getEditor().state, firstLine.from, firstLine.to)).toBeNull();
    act(() => worker.onmessage?.({ data: { ...current, folds: collectDtsEditorFolds(current.text) } } as MessageEvent));
    expect(foldable(input.getEditor().state, firstLine.from, firstLine.to)).not.toBeNull();
  });

  it("keeps search usable in preview and replaces its write controls on mode changes", () => {
    const input = setup({ findQuery: "one" });
    act(() => input.handle.current?.openSearch());
    expect(screen.getByRole("textbox", { name: "替换" })).toBeInTheDocument();
    input.rerenderProps({ readOnly: true });
    expect(screen.getByRole("textbox", { name: "查找" })).toHaveValue("one");
    expect(screen.queryByRole("textbox", { name: "替换" })).not.toBeInTheDocument();
    input.rerenderProps({ readOnly: false });
    expect(screen.getByRole("textbox", { name: "替换" })).toBeInTheDocument();
    const editor = input.getEditor();
    act(() => { editor.dispatch({ selection: { anchor: 1 } }); foldCode(editor); });
    expect(foldedRanges(editor.state).size).toBe(1);
  });

  it("flushes the owning file on blur and unmount and uses viewport-sized line DOM", () => {
    const source = `/ {\n${'  item = <1>;\n'.repeat(10000)}};`;
    const input = setup({ text: source });
    const editor = input.getEditor();
    act(() => editor.dispatch({ changes: { from: editor.state.doc.length, insert: "// pending" } }));
    fireEvent.blur(editor.contentDOM);
    expect(input.props.onChange).toHaveBeenLastCalledWith(expect.objectContaining({ sessionKey: input.props.sessionKey, text: `${source}// pending` }));
    expect(input.container.querySelectorAll(".cm-line").length).toBeLessThan(100);
    input.unmount();
    expect(input.props.onChange).toHaveBeenLastCalledWith(expect.objectContaining({ text: `${source}// pending` }));
  });
});

describe("DTS editor presentation adapter", () => {
  it("folds actual node braces while ignoring comments, strings and escaped quotes", () => {
    const source = '/ {\n /* } { */\n node {\n text = "} \\\" {"; // }\n };\n};';
    const ranges = collectDtsEditorFolds(source);
    expect(ranges).toHaveLength(2);
    expect(source.slice(ranges[0].from, ranges[0].to)).toContain("node {");
    expect(source.slice(ranges[1].from, ranges[1].to)).toContain('text = "}');
    expect(collectDtsEditorFolds('/ { node { "unterminated }')).toEqual([]);
    expect(collectDtsEditorFolds("/ {\n letter = <'{'>;\n};")).toHaveLength(1);
  });

  it("highlights DTS syntax without importing server validation or consuming raw tokens", () => {
    const source = '/dts-v1/;\n/ { n: node { a = /bits/ 64 <9007199254740993>; s = "text"; r = <&n>; }; };';
    const state = EditorState.create({ doc: source, extensions: dtsEditorLanguage });
    ensureSyntaxTree(state, source.length, 100);
    const types: string[] = [];
    syntaxTree(state).iterate({ enter: (node) => { types.push(node.type.name); } });
    expect(types).toEqual(expect.arrayContaining(["keyword", "number", "string", "labelName", "variableName.special"]));
    expect(state.doc.toString()).toBe(source);
    expect(foldable(state, 0, source.indexOf("\n"))).toBeNull();
  });
});
