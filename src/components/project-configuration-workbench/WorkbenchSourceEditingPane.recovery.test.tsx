import { webcrypto } from "node:crypto";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { WorkbenchSourceEditingPane } from "./WorkbenchSourceEditingPane";
import { createSourceEditSession } from "@/application/project-configuration/sourceEditSession";
import type { SourceDraftStorage, StoredSourceDraft } from "@/application/project-configuration/sourceDraftStorage";
import type { ParameterFileRepository } from "@/application/ports/ParameterFileRepository";

beforeAll(() => {
  Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect ??= () => new DOMRect();
});
afterEach(() => vi.unstubAllGlobals());

it("retains recovered stale source when the initial readonly editor blurs before its recovery reset", async () => {
  vi.stubGlobal("crypto", webcrypto);
  const scope = { userId: "u", organizationId: "o", projectId: "p", configSetId: "c", fileId: "f" };
  const source = "/ { server_v3; };";
  const recovered = "/ { draft_v2; };";
  let resolve!: (value: StoredSourceDraft) => void;
  const storage: SourceDraftStorage = {
    load: () => new Promise((done) => { resolve = done; }),
    compareAndSet: vi.fn(async (_scope, _draft, generation) => generation + 1), close() {}
  };
  const session = createSourceEditSession({ storage });
  let initialEditor: HTMLElement | undefined;
  let blurred = false;
  const unsubscribe = session.subscribe(() => {
    if (blurred || !initialEditor || session.getFile(scope)?.loading !== false) return;
    // A native blur can arrive after storage recovery but before React resets CodeMirror.
    blurred = true;
    expect(initialEditor.textContent).toContain("server_v3");
    fireEvent.blur(initialEditor);
  });
  const view = render(<WorkbenchSourceEditingPane scope={scope} session={session} editorSessions={new Map()}
    fileName="board.dts" baseVersionId="v3" configRevisionId="c3" source={source}
    repository={{} as ParameterFileRepository} canEdit visible legacyDraftsDirty={false}
    onOpenLegacyDrafts={() => {}} onDirtyChange={() => {}} onRefresh={() => {}}
    focusSpan={null} focusLine={null} findQuery="" findNextToken={0} onVisibleLineChange={() => {}} />);
  initialEditor = await screen.findByRole("textbox", { name: "DTS 源码" });
  await waitFor(() => expect(resolve).toBeTypeOf("function"));
  await act(async () => resolve({ generation: 1, draft: {
    version: 1, scope, base: { fileVersionId: "v1", configRevisionId: "c1", sourceDigest: "old" },
    sourceText: recovered, baseSourceText: "/ { server_v1; };", generation: 1,
    position: { anchor: 0, head: 0, firstVisibleLine: 1, scrollTop: 0, scrollLeft: 0 }, updatedAt: "2026-10-25T00:00:00Z"
  } }));
  expect(blurred).toBe(true);
  expect(session.getFile(scope)?.sourceText).toBe(recovered);
  expect(session.getFile(scope)?.recoveryStatus).toBe("stale-base");
  expect(screen.getByRole("textbox", { name: "DTS 源码" })).toHaveTextContent("draft_v2");
  expect(screen.getByRole("button", { name: "保存修改" })).toBeDisabled();
  unsubscribe();
  view.unmount();
  await session.close();
});
