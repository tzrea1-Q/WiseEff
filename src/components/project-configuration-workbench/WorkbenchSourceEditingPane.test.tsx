import { webcrypto } from "node:crypto";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { WorkbenchSourceEditingPane } from "./WorkbenchSourceEditingPane";
import { createSourceEditSession } from "@/application/project-configuration/sourceEditSession";
import { sourceDraftKey, type SourceDraftStorage, type StoredSourceDraft } from "@/application/project-configuration/sourceDraftStorage";
import type { ParameterFileRepository } from "@/application/ports/ParameterFileRepository";

vi.mock("./WorkbenchDtsEditor", async () => {
  const React = await import("react");
  return { WorkbenchDtsEditor: React.forwardRef<import("./WorkbenchDtsEditor").WorkbenchDtsEditorHandle, import("./WorkbenchDtsEditor").WorkbenchDtsEditorProps>((props, ref) => {
    const [text, setText] = React.useState(props.text);
    const latest = React.useRef(text); latest.current = text;
    React.useEffect(() => { setText(props.text); }, [props.sessionKey, props.resetKey]);
    const snapshot = () => ({ sessionKey: props.sessionKey, generation: 1, dirty: latest.current !== props.baseText,
      text: latest.current, selection: { anchor: 0, head: 0 }, firstVisibleLine: 1, normalizedLineEndings: false });
    React.useImperativeHandle(ref, () => ({ getSnapshot: snapshot, flush() { const value = snapshot(); props.onChange?.(value); return value; },
      focus() {}, revealLine() {}, openSearch() {} }));
    return <textarea aria-label="test DTS" value={text} readOnly={props.readOnly} onChange={(event) => {
      setText(event.target.value); latest.current = event.target.value; props.onDirtyChange?.(snapshot());
    }} />;
  }) };
});

function setup() {
  const records = new Map<string, StoredSourceDraft>();
  const storage: SourceDraftStorage = {
    async load(scope) { return structuredClone(records.get(sourceDraftKey(scope)) ?? { generation: 0, draft: null }); },
    async compareAndSet(scope, draft, generation) {
      const previous = records.get(sourceDraftKey(scope));
      if ((previous?.generation ?? 0) !== generation) throw new Error("conflict");
      records.set(sourceDraftKey(scope), { generation: generation + 1, draft: structuredClone(draft) });
      return generation + 1;
    }, close() {}
  };
  const session = createSourceEditSession({ storage, persistDelayMs: 0 });
  const createCandidate = vi.fn().mockResolvedValue({ id: "candidate", fileName: "board.dts", status: "ready" });
  const getCandidateSourcePreview = vi.fn().mockResolvedValue({ kind: "source_revision", candidateId: "candidate", canSubmit: true,
    proofToken: "proof", before: "/ { old; };", after: "/ { next; };", impact: { parameterChanges: 0, nodeAdditions: 0, nodeRemovals: 0 },
    reviewers: [{ userId: "reviewer", name: "软件审核人" }] });
  const submitCandidateSourceReview = vi.fn().mockResolvedValue({ requestId: "request", status: "pending", replayed: false });
  const props: ComponentProps<typeof WorkbenchSourceEditingPane> = {
    scope: { userId: "u", organizationId: "o", projectId: "p", configSetId: "c", fileId: "f" },
    session, editorSessions: new Map(), fileName: "board.dts", baseVersionId: "v1", configRevisionId: "c1", source: "/ { old; };",
    repository: { createCandidate, getCandidateSourcePreview, submitCandidateSourceReview } as unknown as ParameterFileRepository,
    canEdit: true, visible: true, legacyDraftsDirty: false, onOpenLegacyDrafts: vi.fn(), onDirtyChange: vi.fn(), onRefresh: vi.fn(),
    focusSpan: null, focusLine: null, findQuery: "", findNextToken: 0, onVisibleLineChange: vi.fn()
  };
  const view = render(<WorkbenchSourceEditingPane {...props} />);
  return { ...view, props, session, createCandidate, getCandidateSourcePreview, submitCandidateSourceReview };
}

beforeEach(() => { vi.stubGlobal("crypto", webcrypto); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("DTS whole-source workbench integration", () => {
  it("locks dismissal during discard and keeps the editable text if recovery cleanup fails", async () => {
    const { session } = setup();
    await waitFor(() => expect(screen.getByRole("radio", { name: "编辑" })).toBeEnabled());
    fireEvent.click(screen.getByRole("radio", { name: "编辑" }));
    fireEvent.change(screen.getByRole("textbox", { name: "test DTS" }), { target: { value: "/ { keep; };" } });
    let resolve!: (ok: boolean) => void;
    vi.spyOn(session, "discard").mockImplementation(() => new Promise((done) => { resolve = done; }));
    fireEvent.click(screen.getByRole("button", { name: "放弃修改" }));
    const dialog = screen.getByRole("dialog", { name: "放弃本地 DTS 修改？" });
    fireEvent.click(within(dialog).getByRole("button", { name: "放弃修改" }));
    expect(within(dialog).getByRole("button", { name: "取消" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "处理中…" })).toBeDisabled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(dialog).toBeInTheDocument();
    await act(async () => { resolve(false); });
    expect(await screen.findByText("无法清除本地恢复副本，文本仍保留，请重试或下载草稿。")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "test DTS" })).toHaveValue("/ { keep; };");
    expect(screen.getByRole("textbox", { name: "test DTS" })).not.toHaveAttribute("readonly");
    await session.flush();
  });
  it("keeps a stale draft and offers its readonly difference against the latest source without submission", async () => {
    const { props, session, rerender, createCandidate } = setup();
    await waitFor(() => expect(screen.getByRole("radio", { name: "编辑" })).toBeEnabled());
    fireEvent.click(screen.getByRole("radio", { name: "编辑" }));
    fireEvent.change(screen.getByRole("textbox", { name: "test DTS" }), { target: { value: "/ { draft; };" } });
    act(() => { session.change(props.scope, "/ { draft; };"); });
    rerender(<WorkbenchSourceEditingPane {...props} source="/ { latest; };" baseVersionId="v2" configRevisionId="c2" />);
    fireEvent.click(await screen.findByRole("button", { name: "对照最新来源" }));
    const dialog = await screen.findByRole("dialog", { name: "DTS 草稿对照" });
    const diff = within(dialog).getByRole("textbox", { name: "test DTS" }) as HTMLTextAreaElement;
    expect(diff).toHaveAttribute("readonly");
    expect(diff.value).toContain("-/ { latest; };");
    expect(diff.value).toContain("+/ { draft; };");
    fireEvent.click(within(dialog).getByRole("button", { name: "返回草稿" }));
    expect(screen.getByRole("button", { name: "保存修改" })).toBeDisabled();
    expect(session.getFile(props.scope)?.sourceText).toBe("/ { draft; };");
    expect(createCandidate).not.toHaveBeenCalled();
    await session.flush();
  });
  it("opens read-only and preserves direct source input across preview switching", async () => {
    const { session, props } = setup();
    const input = await screen.findByRole("textbox", { name: "test DTS" });
    expect(input).toHaveAttribute("readonly");
    await waitFor(() => expect(screen.getByRole("radio", { name: "编辑" })).toBeEnabled());
    fireEvent.click(screen.getByRole("radio", { name: "编辑" }));
    fireEvent.change(input, { target: { value: '/ { strings = "a", "", "a"; };' } });
    fireEvent.click(screen.getByRole("radio", { name: "预览" }));
    expect(input).toHaveValue('/ { strings = "a", "", "a"; };');
    expect(input).toHaveAttribute("readonly");
    expect(props.onDirtyChange).toHaveBeenCalledWith(true);
    await session.flush();
  });

  it("directly applies an administrator's confirmed preview without choosing a reviewer and keeps later typing", async () => {
    const { props, rerender, getCandidateSourcePreview, submitCandidateSourceReview, session } = setup();
    getCandidateSourcePreview.mockResolvedValue({ kind: "source_revision", candidateId: "candidate", canSubmit: true,
      proofToken: "proof", before: "/ { old; };", after: "/ { next; };", impact: { parameterChanges: 1, nodeAdditions: 0, nodeRemovals: 0, restoredParameters: 1 }, reviewers: [] });
    let resolve!: (value: object) => void;
    const apply = vi.fn().mockImplementation(() => new Promise((done) => { resolve = done; }));
    rerender(<WorkbenchSourceEditingPane {...props} repository={{ ...props.repository, applyCandidateSourceRevision: apply }} />);
    await waitFor(() => expect(screen.getByRole("radio", { name: "编辑" })).toBeEnabled());
    fireEvent.click(screen.getByRole("radio", { name: "编辑" }));
    fireEvent.change(screen.getByRole("textbox", { name: "test DTS" }), { target: { value: "/ { next; };" } });
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
    fireEvent.change(await screen.findByRole("textbox", { name: "DTS 修改原因" }), { target: { value: "管理员已核对差异" } });
    expect(await screen.findByText("恢复 1 个已删除参数，保留原身份及历史。")).toBeInTheDocument();
    const direct = screen.getByRole("button", { name: "直接应用修改" });
    await waitFor(() => expect(direct).toBeEnabled());
    fireEvent.click(direct);
    await waitFor(() => expect(apply).toHaveBeenCalledWith("p", "candidate", {
      expectedCurrentVersionId: "v1", expectedProofToken: "proof", reason: "管理员已核对差异", clientMutationId: expect.any(String)
    }));
    fireEvent.change(screen.getAllByRole("textbox", { name: "test DTS", hidden: true })[0]!, { target: { value: "/ { later; };" } });
    await act(async () => { resolve({ id: "direct-request", status: "approved", applicationMode: "administrator_direct",
      appliedSourceResult: { fileVersionId: "v2", configRevisionId: "c2" } }); });
    await waitFor(() => expect(session.getFile(props.scope)?.base.fileVersionId).toBe("v2"));
    expect(session.getFile(props.scope)).toMatchObject({ sourceText: "/ { later; };", dirty: true });
    expect(submitCandidateSourceReview).not.toHaveBeenCalled();
    expect(props.onRefresh).toHaveBeenCalledOnce();
    await session.flush();
  });

  it("retains a failed direct application's text and retries the identical confirmation", async () => {
    const { props, rerender, session } = setup();
    const apply = vi.fn().mockRejectedValueOnce(new Error("response lost")).mockResolvedValue({
      id: "direct-request", status: "approved", applicationMode: "administrator_direct",
      appliedSourceResult: { fileVersionId: "v2", configRevisionId: "c2" }
    });
    rerender(<WorkbenchSourceEditingPane {...props} repository={{ ...props.repository, applyCandidateSourceRevision: apply }} />);
    await waitFor(() => expect(screen.getByRole("radio", { name: "编辑" })).toBeEnabled());
    fireEvent.click(screen.getByRole("radio", { name: "编辑" }));
    fireEvent.change(screen.getByRole("textbox", { name: "test DTS" }), { target: { value: "/ { next; };" } });
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
    fireEvent.change(await screen.findByRole("textbox", { name: "DTS 修改原因" }), { target: { value: "保留确认内容" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "直接应用修改" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "直接应用修改" }));
    expect(await screen.findByText("直接应用失败，可重试同一操作；文本仍保留。")).toBeInTheDocument();
    expect(session.getFile(props.scope)).toMatchObject({ sourceText: "/ { next; };", dirty: true });
    expect(screen.getByRole("textbox", { name: "DTS 修改原因" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "提交审核" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "重试同一应用" }));
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(2));
    expect(apply.mock.calls[1]).toEqual(apply.mock.calls[0]);
    await waitFor(() => expect(session.getFile(props.scope)).toMatchObject({ dirty: false, base: { fileVersionId: "v2" } }));
    await session.flush();
  });

  it("captures undebounced input with pinned bases and retries the exact submitted body", async () => {
    const { createCandidate, submitCandidateSourceReview, session, props } = setup();
    const input = await screen.findByRole("textbox", { name: "test DTS" });
    await waitFor(() => expect(screen.getByRole("radio", { name: "编辑" })).toBeEnabled());
    fireEvent.click(screen.getByRole("radio", { name: "编辑" }));
    fireEvent.change(input, { target: { value: "/ { next; };" } });
    // The test editor intentionally has not emitted its debounced onChange.
    await act(async () => { await props.session.change(props.scope, "/ { stale; };"); });
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
    await screen.findByRole("dialog", { name: "保存 DTS 修改" });
    await waitFor(() => expect(createCandidate).toHaveBeenCalledOnce());
    expect(createCandidate.mock.calls[0][1]).toMatchObject({ fileId: "f", intent: "source_revision", expectedCurrentVersionId: "v1", expectedConfigRevisionId: "c1" });
    expect(atob(createCandidate.mock.calls[0][1].contentBase64)).toBe("/ { next; };");
    fireEvent.change(screen.getByRole("textbox", { name: "DTS 修改原因" }), { target: { value: "保留注释" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "提交审核" })).toBeEnabled());
    submitCandidateSourceReview.mockRejectedValueOnce(new Error("response lost"));
    fireEvent.click(screen.getByRole("button", { name: "提交审核" }));
    await screen.findByText("提交失败，可重试同一请求；文本仍保留。");
    expect(screen.getByRole("textbox", { name: "DTS 修改原因" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "重试同一提交" }));
    await waitFor(() => expect(submitCandidateSourceReview).toHaveBeenCalledTimes(2));
    expect(submitCandidateSourceReview.mock.calls[1][2]).toEqual(submitCandidateSourceReview.mock.calls[0][2]);
    expect(await screen.findByText(/已提交审核/)).toBeInTheDocument();
    await session.flush();
  });

  it("retains an older submission receipt without refreshing a newly selected configuration", async () => {
    const { props, rerender, submitCandidateSourceReview, session } = setup();
    let resolve!: (value: object) => void;
    submitCandidateSourceReview.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    await waitFor(() => expect(screen.getByRole("radio", { name: "编辑" })).toBeEnabled());
    fireEvent.click(screen.getByRole("radio", { name: "编辑" }));
    fireEvent.change(screen.getByRole("textbox", { name: "test DTS" }), { target: { value: "/ { next; };" } });
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
    await screen.findByRole("textbox", { name: "DTS 修改原因" });
    fireEvent.change(screen.getByRole("textbox", { name: "DTS 修改原因" }), { target: { value: "保留修改" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "提交审核" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "提交审核" }));
    await waitFor(() => expect(submitCandidateSourceReview).toHaveBeenCalledOnce());
    const next = { ...props, scope: { ...props.scope, configSetId: "other-config", fileId: "other-file" },
      source: "/ { other; };", baseVersionId: "v2", configRevisionId: "c2", onRefresh: vi.fn() };
    rerender(<WorkbenchSourceEditingPane {...next} />);
    await waitFor(() => expect(session.getFile(next.scope)?.base.configRevisionId).toBe("c2"));
    await act(async () => { resolve({ requestId: "older-request", status: "pending", replayed: false }); });
    expect(session.getFile(props.scope)?.submission?.requestId).toBe("older-request");
    expect(props.onRefresh).not.toHaveBeenCalled();
    expect(next.onRefresh).not.toHaveBeenCalled();
    expect(session.getFile(next.scope)).toMatchObject({ sourceText: "/ { other; };", dirty: false, base: { configRevisionId: "c2" } });
    expect(screen.getByRole("radio", { name: "编辑" })).toBeEnabled();
    await session.flush();
  });

  it("does not leave a newly selected file busy after an older candidate request settles", async () => {
    const { props, rerender, createCandidate, session } = setup();
    let resolve!: (value: object) => void;
    createCandidate.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const input = await screen.findByRole("textbox", { name: "test DTS" });
    await waitFor(() => expect(screen.getByRole("radio", { name: "编辑" })).toBeEnabled());
    fireEvent.click(screen.getByRole("radio", { name: "编辑" }));
    fireEvent.change(input, { target: { value: "/ { next; };" } });
    act(() => { session.change(props.scope, "/ { next; };"); });
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
    await waitFor(() => expect(createCandidate).toHaveBeenCalledOnce());
    const next = { ...props, scope: { ...props.scope, fileId: "other" }, fileName: "other.dts", baseVersionId: "v2" };
    rerender(<WorkbenchSourceEditingPane {...next} />);
    await waitFor(() => expect(screen.getByRole("radio", { name: "编辑" })).toBeEnabled());
    await act(async () => { resolve({ id: "older", status: "ready" }); });
    fireEvent.click(screen.getByRole("radio", { name: "编辑" }));
    fireEvent.change(screen.getByRole("textbox", { name: "test DTS" }), { target: { value: "/ { other; };" } });
    act(() => { session.change(next.scope, "/ { other; };"); });
    expect(screen.getByRole("button", { name: "保存修改" })).toBeEnabled();
    await session.flush();
  });
});
