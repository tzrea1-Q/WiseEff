import { selectControlOption } from "@/test/selectControlOption";
import { webcrypto } from "node:crypto";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DtsStructuredRepository, DtsStructureResult } from "@/application/ports/DtsStructuredRepository";
import type { ParameterFileRepository } from "@/application/ports/ParameterFileRepository";
import type { ParameterTopologyRepository } from "@/application/ports/ParameterTopologyRepository";
import { ToastProvider } from "@/components/common/toast/ToastProvider";
import { WiseEffApiError,createApiClient } from "@/infrastructure/http/apiClient";
import * as memberAdditionClient from "@/infrastructure/http/canonicalMemberAdditionClient";
import * as sharedDtsiClient from "@/infrastructure/http/sharedDtsiClient";
import * as canonicalConflictClient from "@/infrastructure/http/canonicalConflictClient";
import * as userGovernanceClient from "@/infrastructure/http/userGovernanceClient";
import {
  ProjectConfigurationWorkbench,
  type ProjectConfigurationWorkbenchProps
} from "./ProjectConfigurationWorkbench";
import {
  readSessionDraftStore,
  SESSION_DRAFT_STORAGE_KEY,
  upsertSessionDraftBucket
} from "@/application/project-configuration/sessionDraftStorage";
import { declarationsFor, hasAtRule, hasRule, readStylesheet } from "../../test/cssAssertions";
import {
  createTestDtsStructuredRepository,
  createTestParameterFileRepository,
  createTestParameterTopologyRepository
} from "@/test/harness";

const sourceDrafts = vi.hoisted(() => ({ records: new Map<string, { generation: number; draft: unknown }>() }));

vi.mock("@/application/project-configuration/sourceDraftStorage", async (original) => {
  const module = await original<typeof import("@/application/project-configuration/sourceDraftStorage")>();
  return { ...module, createSourceDraftStorage() {
    const records = sourceDrafts.records;
    return {
      async load(scope: import("@/application/project-configuration/sourceDraftStorage").SourceDraftScope) {
        return structuredClone(records.get(module.sourceDraftKey(scope)) ?? { generation: 0, draft: null });
      },
      async compareAndSet(scope: import("@/application/project-configuration/sourceDraftStorage").SourceDraftScope, draft: unknown, generation: number) {
        const key = module.sourceDraftKey(scope);
        if ((records.get(key)?.generation ?? 0) !== generation) throw new module.SourceDraftConflictError();
        records.set(key, { generation: generation + 1, draft: structuredClone(draft) });
        return generation + 1;
      }, close() {}
    };
  } };
});

// These tests own workbench orchestration. Native CM editing/history/readonly
// behavior is exercised separately by WorkbenchDtsEditor.test.tsx.
vi.mock("./WorkbenchDtsEditor", async () => {
  const React = await import("react");
  return { WorkbenchDtsEditor: React.forwardRef<import("./WorkbenchDtsEditor").WorkbenchDtsEditorHandle, import("./WorkbenchDtsEditor").WorkbenchDtsEditorProps>((props, ref) => {
    const [text, setText] = React.useState(props.text);
    const latest = React.useRef(props.text);
    const generation = React.useRef(0);
    const pending = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const currentIdentity = React.useRef({ key: props.sessionKey, resetKey: props.resetKey });
    React.useLayoutEffect(() => { currentIdentity.current = { key: props.sessionKey, resetKey: props.resetKey }; });
    const snapshot = () => ({ sessionKey: props.sessionKey, generation: generation.current, dirty: latest.current !== (props.baseText ?? props.text),
      text: latest.current, selection: { anchor: 0, head: 0 }, firstVisibleLine: 1, normalizedLineEndings: false });
    const flush = () => { if (pending.current) clearTimeout(pending.current); pending.current = null; const value = snapshot(); props.onChange?.(value); return value; };
    React.useEffect(() => { latest.current = props.text; setText(props.text); generation.current = 0; }, [props.sessionKey, props.resetKey]);
    React.useEffect(() => () => {
      if (currentIdentity.current.key !== props.sessionKey || currentIdentity.current.resetKey === props.resetKey) flush();
      else if (pending.current) { clearTimeout(pending.current); pending.current = null; }
    }, [props.sessionKey, props.resetKey]);
    React.useImperativeHandle(ref, () => ({ getSnapshot: snapshot, flush, focus() {}, revealLine() {}, openSearch() {} }));
    return <div data-focused={Boolean(props.focusSpan || props.focusLine)} data-focus-start={props.focusSpan?.startLine}>
      <textarea aria-label={props.ariaLabel ?? "DTS 源码"} value={text} readOnly={props.readOnly}
        onBlur={flush} onScroll={() => props.onVisibleLineChange?.(1)} onChange={(event) => {
          latest.current = event.target.value; setText(event.target.value); generation.current += 1;
          props.onDirtyChange?.(snapshot());
          if (pending.current) clearTimeout(pending.current);
          const value = snapshot(); pending.current = setTimeout(() => { pending.current = null; props.onChange?.(value); }, 350);
        }} />
    </div>;
  }) };
});

beforeEach(() => { vi.stubGlobal("crypto", webcrypto); });

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.removeItem(SESSION_DRAFT_STORAGE_KEY);
  localStorage.removeItem(`wiseeff.navigator-workbench.collapsed:project-configuration:${PROJECT.id}`);
  sourceDrafts.records = new Map();
});

function createMemoryStorage(seed: Record<string, string> = {}): Storage {
  const map = new Map<string, string>(Object.entries(seed));
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null;
    },
    key(index: number) {
      return Array.from(map.keys())[index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, value);
    }
  };
}

const PROJECT = {
  id: "project-1",
  name: "Aurora Production",
  code: "AURORA",
  statusLabel: "进行中"
};

const ACTIVE_BOARD_VERSION = {
  id: "version-board-12", fileId: "file-board", versionNumber: 12,
  checksum: "abc", sizeBytes: 32, parsedIndex: {}, origin: "upload" as const,
  createdAt: "2026-08-06T08:00:00.000Z"
};

function createDtsRepository(
  overrides: Partial<DtsStructuredRepository> = {}
): DtsStructuredRepository {
  return createTestDtsStructuredRepository({
    getStructure: vi.fn(async () => ({ nodes: [] })),
    search: vi.fn(async () => ({ hits: [] })),
    listConfigSets: vi.fn(async () => [
      {
        id: "cs-alpha",
        organizationId: "org-1",
        projectId: PROJECT.id,
        name: "alpha",
        createdAt: "2026-08-06T08:00:00.000Z",
        updatedAt: "2026-08-06T08:00:00.000Z"
      },
      {
        id: "cs-default",
        organizationId: "org-1",
        projectId: PROJECT.id,
        name: "default",
        createdAt: "2026-08-06T08:00:00.000Z",
        updatedAt: "2026-08-06T08:00:00.000Z"
      }
    ]),
    listConfigSetFiles: vi.fn<DtsStructuredRepository["listConfigSetFiles"]>(async (_projectId, configSetId) =>
      configSetId === "cs-alpha"
        ? [
            {
              configSetId,
              fileId: "file-alpha",
              fileName: "alpha.dts",
              format: "dts",
              role: "base",
              sortOrder: 0,
              currentVersionId: "version-alpha-2",
              currentVersionNumber: 2
            }
          ]
        : [
            {
              configSetId,
              fileId: "file-board",
              fileName: "aurora-board.dts",
              format: "dts",
              role: "base",
              sortOrder: 0,
              currentVersionId: "version-board-12",
              currentVersionNumber: 12
            },
            {
              configSetId,
              fileId: "file-overlay",
              fileName: "charging-overlay.dtsi",
              format: "dts",
              role: "overlay",
              sortOrder: 1,
              currentVersionId: "version-overlay-4",
              currentVersionNumber: 4
            }
          ]
    ),
    listBaselines: vi.fn<DtsStructuredRepository["listBaselines"]>(async (_projectId, configSetId) =>
      configSetId === "cs-default"
        ? [
            {
              id: "baseline-seed-v1",
              organizationId: "org-1",
              configSetId,
              name: "seed-v1",
              status: "released",
              createdAt: "2026-08-06T08:00:00.000Z"
            }
          ]
        : []
    ),
    getReleaseReadiness: vi.fn(async () => ({
      available: true,
      level: "ready" as const,
      blockers: [],
      warnings: [],
      gateToken: "gate-token-test",
      evaluatedAt: "2026-08-07T00:00:00.000Z",
      configSetId: "cs-default",
      projectId: PROJECT.id,
      canCreateBaseline: true,
      canRelease: true
    })),
    ...overrides
  });
}

function createFileRepository(
  overrides: Partial<ParameterFileRepository> = {}
): ParameterFileRepository {
  return createTestParameterFileRepository({
    listFiles: vi.fn<ParameterFileRepository["listFiles"]>(async () => [
      {
        id: "file-board",
        projectId: PROJECT.id,
        fileName: "aurora-board.dts",
        format: "dts",
        enabled: true,
        currentVersionId: "version-board-12",
        currentVersionNumber: 12,
        updatedAt: "2026-08-06T08:00:00.000Z"
      },
      {
        id: "file-overlay",
        projectId: PROJECT.id,
        fileName: "charging-overlay.dtsi",
        format: "dts",
        enabled: true,
        currentVersionId: "version-overlay-4",
        currentVersionNumber: 4,
        updatedAt: "2026-08-06T08:00:00.000Z"
      },
      {
        id: "file-loose",
        projectId: PROJECT.id,
        fileName: "notes.json",
        format: "json",
        enabled: true,
        currentVersionId: "version-loose-1",
        currentVersionNumber: 1,
        updatedAt: "2026-08-06T08:00:00.000Z"
      },
      {
        id: "file-alpha",
        projectId: PROJECT.id,
        fileName: "alpha.dts",
        format: "dts",
        enabled: true,
        currentVersionId: "version-alpha-2",
        currentVersionNumber: 2,
        updatedAt: "2026-08-06T08:00:00.000Z"
      }
    ]),
    downloadVersion: vi.fn(async (_projectId, fileId, versionId) => ({
      contentType: "text/plain",
      fileName: fileId === "file-alpha" ? "alpha.dts" : "aurora-board.dts",
      bytes: new TextEncoder().encode(
        fileId === "file-alpha"
          ? "/dts-v1/;\n/ { model = \"Alpha\"; };\n"
          : `/dts-v1/;\n/ { model = \"Aurora\"; /* ${versionId} */ };\n`
      )
    })),
    listVersions: vi.fn(async () => []),
    listConflicts: vi.fn<ParameterFileRepository["listConflicts"]>(async () => []),
    listCandidates: vi.fn(async () => []),
    ...overrides
  });
}

function createTopologyRepository(
  overrides: Partial<Pick<ParameterTopologyRepository, "listConfigRevisions" | "validateRevision" | "getTopology">> = {}
): ParameterTopologyRepository {
  return createTestParameterTopologyRepository({
    listConfigRevisions: vi.fn(async () => [
      {
        id: "rev-cs-listed",
        configSetId: "cs-default",
        revisionNumber: 2,
        status: "resolved" as const,
        createdAt: "2026-08-17T10:00:00.000Z"
      },
      {
        id: "rev-cs-older",
        configSetId: "cs-default",
        revisionNumber: 1,
        status: "validated" as const,
        createdAt: "2026-08-16T10:00:00.000Z"
      }
    ]),
    validateRevision: vi.fn(async () => ({
      id: "run-listed",
      status: "passed" as const,
      stage: "toolchain",
      requiresConfirmation: true
    })),
    ...overrides
  });
}

async function openWorkbenchMoreMenu() {
  await userEvent.click(screen.getByRole("button", { name: "更多" }));
  return screen.findByRole("menu");
}

async function openWorkbenchReleaseDetails() {
  fireEvent.click(screen.getByRole("button", { name: /^配置版本/ }));
  return screen.findByRole("dialog", { name: "配置版本" });
}

async function openSourceUpdates() {
  const fileName = document.querySelector('.configuration-workbench__member-row[aria-selected="true"] strong')?.textContent;
  const files = await openSchemeFiles();
  const scope = fileName ? within(files).getByRole("button", { name: fileName }).closest("tr")! : files;
  await userEvent.click(await within(scope).findByRole("button", { name: /^(更新文件|更新记录|上传来源文件)$/ }));
  return screen.findByRole("complementary", { name: "配置检查器" });
}

async function openSchemeMenu() {
  await userEvent.click(screen.getByRole("button", { name: "配置" }));
  return screen.findByRole("menu");
}

async function selectScheme(id: string) {
  const menu = await openSchemeMenu();
  const option = within(menu).getAllByRole("menuitemradio").find((item) => item.getAttribute("data-value") === id);
  expect(option).toBeDefined();
  await userEvent.click(option!);
}

async function openSchemeFiles() {
  const menu = await openSchemeMenu();
  await userEvent.click(within(menu).getByRole("menuitem", { name: /^(配置组成|查看文件)$/ }));
  return screen.findByRole("dialog", { name: "配置组成" });
}

async function openWorkbenchVersionDetails() {
  const fileName = document.querySelector('.configuration-workbench__member-row[aria-selected="true"] strong')?.textContent;
  expect(fileName).toBeTruthy();
  const files = await openSchemeFiles();
  await userEvent.click(within(files).getByRole("button", { name: `${fileName} 更多` }));
  await userEvent.click(await screen.findByRole("menuitem", { name: "版本历史与下载" }));
  return screen.findByRole("region", { name: "版本历史" });
}

async function openVersionMenu(versionNumber: number) {
  await userEvent.click(screen.getByRole("button", { name: `版本 ${versionNumber} 操作：更多` }));
  return screen.findByRole("menu");
}

async function openCreateConfigSetDialog() {
  const menu = await openSchemeMenu();
  await userEvent.click(within(menu).getByRole("menuitem", { name: "新建配置…" }));
  return screen.findByRole("heading", { name: "新建配置" });
}

async function ensureInspectorOpen() {
  if (screen.queryByRole("complementary", { name: "配置检查器" })) return;
  const selected = screen.queryAllByRole("treeitem", { selected: true })
    .find((item) => /^(属性|节点) /.test(item.getAttribute("aria-label") ?? ""));
  if (selected) fireEvent.click(selected);
  else {
    await openWorkbenchVersionDetails();
  }
}

async function openLocalChanges() {
  const toggle = await screen.findByRole("button", { name: "任务" });
  if (toggle.getAttribute("aria-expanded") !== "true") fireEvent.click(toggle);
  return screen.findByRole("region", { name: "配置任务" });
}

function renderWorkbench(options: {
  search?: string;
  onNavigate?: (path: string) => void;
  dtsRepository?: DtsStructuredRepository;
  fileRepository?: ParameterFileRepository;
  listAuditEvents?: ProjectConfigurationWorkbenchProps["listAuditEvents"];
  syncSearch?: boolean;
  canEdit?: boolean;
  canEditCritical?: boolean;
  canAdmin?: boolean;
  currentUserId?: string;
  organizationId?: string;
  draftStorage?: ProjectConfigurationWorkbenchProps["draftStorage"];
  topologyRepository?: ProjectConfigurationWorkbenchProps["topologyRepository"];
  memberRemovalRepository?: ProjectConfigurationWorkbenchProps["memberRemovalRepository"];
  apiMode?: boolean;
} = {}) {
  const onNavigate = vi.fn(options.onNavigate ?? (() => undefined));
  const sharedProps = {
    project: PROJECT,
    dtsRepository: options.dtsRepository ?? createDtsRepository(),
    fileRepository: options.fileRepository ?? createFileRepository(),
    listAuditEvents:
      options.listAuditEvents ??
      (vi.fn(async () => ({ items: [], nextCursor: null })) as ProjectConfigurationWorkbenchProps["listAuditEvents"]),
    ...(options.canEdit === undefined ? {} : { canEdit: options.canEdit }),
    ...(options.canEditCritical === undefined ? {} : { canEditCritical: options.canEditCritical }),
    ...(options.canAdmin === undefined ? {} : { canAdmin: options.canAdmin }),
    ...(options.currentUserId === undefined ? {} : { currentUserId: options.currentUserId }),
    ...(options.organizationId === undefined ? {} : { organizationId: options.organizationId }),
    ...(options.draftStorage ? { draftStorage: options.draftStorage } : {}),
    ...(options.topologyRepository ? { topologyRepository: options.topologyRepository } : {}),
    ...(options.memberRemovalRepository ? { memberRemovalRepository: options.memberRemovalRepository } : {}),
    ...(options.apiMode === undefined ? {} : { apiMode: options.apiMode })
  };
  if (options.syncSearch) {
    function Harness() {
      const [search, setSearch] = useState(options.search ?? "");
      return (
        <ProjectConfigurationWorkbench
          {...sharedProps}
          search={search}
          onNavigate={(path) => {
            onNavigate(path);
            const queryIndex = path.indexOf("?");
            setSearch(queryIndex >= 0 ? path.slice(queryIndex) : "");
          }}
        />
      );
    }
    render(
      <ToastProvider>
        <Harness />
      </ToastProvider>
    );
    return { onNavigate };
  }
  render(
    <ToastProvider>
      <ProjectConfigurationWorkbench
        {...sharedProps}
        search={options.search ?? ""}
        onNavigate={onNavigate}
      />
    </ToastProvider>
  );
  return { onNavigate };
}

const BOARD_STRUCTURE: DtsStructureResult = {
  nodes: [
    {
      nodePath: "board",
      name: "board",
      labels: ["board_label"],
      compatible: "wiseeff,aurora",
      status: "okay",
      properties: [
        {
          name: "model",
          valueType: "string-list" as const,
          rawText: '"Aurora"',
          normalizedValue: "Aurora",
          source: {
            startOffset: 20,
            endOffset: 28,
            startLine: 2,
            startColumn: 3,
            endLine: 2,
            endColumn: 11
          }
        },
        {
          name: "compatible",
          valueType: "string-list" as const,
          rawText: '"wiseeff,aurora"',
          normalizedValue: "wiseeff,aurora",
          source: {
            startOffset: 40,
            endOffset: 58,
            startLine: 3,
            startColumn: 3,
            endLine: 3,
            endColumn: 21
          }
        }
      ],
      phandleRefs: [],
      source: {
        startOffset: 10,
        endOffset: 70,
        startLine: 1,
        startColumn: 1,
        endLine: 4,
        endColumn: 2
      }
    },
    {
      nodePath: "regulator",
      name: "regulator",
      labels: [],
      properties: [
        {
          name: "regulator-min-microvolt",
          valueType: "u32-array" as const,
          rawText: "<0x1000>",
          normalizedValue: "4096",
          source: {
            startOffset: 80,
            endOffset: 90,
            startLine: 5,
            startColumn: 3,
            endLine: 5,
            endColumn: 13
          }
        }
      ],
      phandleRefs: [],
      source: {
        startOffset: 70,
        endOffset: 100,
        startLine: 4,
        startColumn: 1,
        endLine: 6,
        endColumn: 2
      }
    }
  ]
};

function renderSourceWorkbench(options: Parameters<typeof renderWorkbench>[0] = {}) {
  const createCandidate = vi.fn().mockResolvedValue({ id: "source-candidate", projectId: PROJECT.id, fileId: "file-board", fileName: "aurora-board.dts", format: "dts", status: "ready", diagnostics: [], blockers: [], impact: {}, createdAt: "now", updatedAt: "now" });
  const getCandidateSourcePreview = vi.fn().mockResolvedValue({ kind: "source_revision", format: "dts", candidateId: "source-candidate", canSubmit: true, proofToken: "source-proof", before: '/ { model = "Aurora"; };', after: '/ { model = "Changed"; };', impact: { parameterChanges: 1, nodeAdditions: 0, nodeRemovals: 0 }, reviewers: [{ userId: "reviewer", name: "Source reviewer" }] });
  const submitCandidateSourceReview = vi.fn().mockResolvedValue({ requestId: "source-request", status: "pending", replayed: false });
  const fileRepository = options.fileRepository ?? createFileRepository({ createCandidate, getCandidateSourcePreview, submitCandidateSourceReview,
    getSourceRevisionRequest: vi.fn().mockResolvedValue({ id: "source-request", status: "pending" }) });
  return { ...renderWorkbench({ search: "?tab=source", currentUserId: "user-a", organizationId: "org-1", canEdit: true, canAdmin: true, apiMode: true,
    topologyRepository: createTopologyRepository(), dtsRepository: createDtsRepository({ getStructure: vi.fn(async () => ({ ...BOARD_STRUCTURE,
      navigation: { status: "ready" as const, catalogReleaseId: "release", managedNodePaths: ["board", "regulator"] } })) }),
    ...options, fileRepository }), createCandidate, getCandidateSourcePreview, submitCandidateSourceReview };
}

async function enterSourceEdit(text?: string) {
  const edit = await screen.findByRole("radio", { name: "编辑" });
  await waitFor(() => expect(edit).toBeEnabled()); fireEvent.click(edit);
  const input = screen.getByRole("textbox", { name: "DTS 源码" });
  expect(input).not.toHaveAttribute("readonly");
  if (text !== undefined) fireEvent.change(input, { target: { value: text } });
  return input;
}

function legacyDraftStorage(baseVersionId = "version-board-12") {
  const storage = createMemoryStorage();
  upsertSessionDraftBucket({ scope: { userId: "user-a", organizationId: "org-1", projectId: PROJECT.id, configSetId: "cs-default", fileId: "file-board", baseVersionId }, drafts: { "board::model": { rawText: '\"Legacy recovered\"', normalizedValue: "Legacy recovered", valid: true } }, selectedKeys: ["file-board::board::model"], reason: "Retained parameter draft", updatedAt: "2026-10-19T00:00:00Z" }, storage);
  return storage;
}

describe("ProjectConfigurationWorkbench", () => {
  it.each(["cancel","apply"])("continues switch %s when browser recovery storage cannot be cleared",async(action)=>{
    const resourceId="11111111-1111-4111-8111-111111111111",old="22222222-2222-4222-8222-222222222222",target="33333333-3333-4333-8333-333333333333";
    const scope="wiseeff.shared-switch:local-user:org-1:project-1:cs-default";
    const storage=createMemoryStorage({[scope]:JSON.stringify({scope,reference:{resourceId,versionId:old,version:1},draft:{versionId:target,reason:"Retained switch reason"}})});
    storage.removeItem=vi.fn(()=>{throw new Error("Browser storage unavailable");});vi.stubGlobal("sessionStorage",storage);
    const shared=sharedDtsiClient.createSharedDtsiClient(createApiClient({baseUrl:""}));
    vi.spyOn(sharedDtsiClient,"createSharedDtsiClient").mockReturnValue({...shared,versions:vi.fn(async()=>({items:[{id:target,resourceId,version:2,name:"Limits",changeDescription:"Next",digest:"fixed",createdAt:"today",createdByUserId:"author"}],total:1}))});
    vi.spyOn(memberAdditionClient,"createCanonicalMemberAdditionClient").mockReturnValue({upload:vi.fn(),preview:vi.fn(async()=>({proofToken:"a".repeat(64),configSetId:"cs-default",fileName:"limits.dtsi",format:"dts",members:[],entryFile:"aurora-board.dts",includeSearchPaths:["."],overlayOrder:[],diagnostics:[],impact:{parameterChanges:0,nodeAdditions:0,nodeRemovals:0,retainedBindings:0,sourceReplacements:0}})),apply:vi.fn(async()=>({requestId:"request",fileId:"applied-file",fileVersionId:"applied-version",configRevisionId:"new-revision"}))});
    const dts=createDtsRepository(),{onNavigate}=renderWorkbench({apiMode:true,search:"?configSet=cs-default&file=file-board&sharedSwitch=resume",dtsRepository:dts});
    const dialog=await screen.findByRole("dialog",{name:"切换共享版本"}),reads=vi.mocked(dts.listConfigSetFiles).mock.calls.length;
    if(action==="cancel")await userEvent.click(within(dialog).getByRole("button",{name:"关闭",exact:true}));
    else{
      await userEvent.click(within(dialog).getByRole("button",{name:"预览版本切换",exact:true}));
      await userEvent.click(await within(dialog).findByRole("button",{name:"确认切换版本",exact:true}));
      await waitFor(()=>expect(onNavigate).toHaveBeenLastCalledWith(expect.stringContaining("file=applied-file")));
      await waitFor(()=>expect(vi.mocked(dts.listConfigSetFiles).mock.calls.length).toBeGreaterThan(reads));
    }
    expect(storage.removeItem).toHaveBeenCalledWith(scope);expect(screen.queryByRole("dialog",{name:"切换共享版本"})).not.toBeInTheDocument();
  });
  it("defaults to the complete effective tree, keeps compatible instances separate, and retries a failed read", async () => {
    const getTopology = vi.fn<ParameterTopologyRepository["getTopology"]>()
      .mockRejectedValueOnce(new Error("读取失败"))
      .mockResolvedValue({ view: "effective", projectId: PROJECT.id, configSetId: "cs-default", revisionId: "fixed-revision", nodes: [
        { id: "one", logicalNodeId: "one", locator: "/first@1", name: "first", unitAddress: "1", compatible: "same,device", parentLogicalNodeId: null,
          effects: [{ id: "e1", propertyName: "limit", effectKind: "set", nodeOccurrenceId: "o1", propertyOccurrenceId: "p1", sourceOrder: 0, rawText: "<1>" }] },
        { id: "two", logicalNodeId: "two", locator: "/second@2", name: "second", unitAddress: "2", compatible: "same,device", parentLogicalNodeId: null,
          effects: [{ id: "e2", propertyName: "limit", effectKind: "set", nodeOccurrenceId: "o2", propertyOccurrenceId: "p2", sourceOrder: 0, rawText: "<2>" }] }
      ] });
    renderWorkbench({ apiMode: true, topologyRepository: createTopologyRepository({ getTopology }), syncSearch: true });
    await screen.findByRole("button", { name: "重试" });
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await screen.findByRole("treeitem", { name: "节点 /first@1" });
    expect(screen.getByLabelText("limit 最终值")).toHaveTextContent("<1>");
    fireEvent.click(screen.getByRole("treeitem", { name: "节点 /second@2" }));
    expect(screen.getByLabelText("limit 最终值")).toHaveTextContent("<2>");
    expect(screen.getByRole("tab", { name: "生效配置" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("complementary", { name: "检查器" })).not.toBeInTheDocument();
  });
  it("follows source scrolling in the tree without replacing the explicit source focus", async () => {
    renderSourceWorkbench({ search: "?configSet=cs-default&file=file-board&node=regulator", syncSearch: true });
    const source = await screen.findByRole("textbox", { name: "DTS 源码" });
    await waitFor(() => expect(source.parentElement).toHaveAttribute("data-focus-start", "4"));
    const board = await screen.findByRole("treeitem", { name: "节点 board" });
    await waitFor(() => expect(screen.getByRole("treeitem", { name: "节点 regulator" })).toHaveAttribute("aria-selected", "true"));
    fireEvent.scroll(source);
    await waitFor(() => expect(board).toHaveAttribute("aria-selected", "true"));
    expect(source.parentElement).toHaveAttribute("data-focus-start", "4");
    fireEvent.click(board);
    await waitFor(() => expect(source.parentElement).toHaveAttribute("data-focus-start", "1"));
  });

  it("keeps complete multiline property values keyboard-readable in the inspector", async () => {
    const rawText = `"first ${"x".repeat(300)}",\n"last"`;
    const board = BOARD_STRUCTURE.nodes[0]!;
    const structure = { nodes: [{ ...board, properties: [{ ...board.properties[0]!, rawText }] }] };
    renderWorkbench({ search: "?configSet=cs-default&file=file-board&node=board&property=model&inspector=selection",
      dtsRepository: createDtsRepository({ getStructure: vi.fn(async () => structure) }) });
    const value = await screen.findByLabelText("当前属性完整值");
    expect(value).toBeVisible();
    expect(value.textContent).toBe(rawText);
    expect(value).toHaveAttribute("tabindex", "0");
  });

  it("scopes API navigation and search while keeping hidden deep links and complete source available", async () => {
    const getStructure = vi.fn(async () => ({ ...BOARD_STRUCTURE,
      navigation: { status: "ready" as const, catalogReleaseId: "release-1", managedNodePaths: ["regulator"] }
    }));
    const search = vi.fn().mockResolvedValue({ hits: [] });
    renderWorkbench({ apiMode: true,
      search: "?configSet=cs-default&file=file-board&node=board&property=model&inspector=selection",
      dtsRepository: createDtsRepository({ getStructure, search }) });
    expect(await screen.findByText("目标不在当前导航范围，已定位到源码。")).toBeInTheDocument();
    expect(screen.getByRole("treeitem", { name: "节点 regulator" })).toBeInTheDocument();
    expect(screen.queryByRole("treeitem", { name: "节点 board" })).not.toBeInTheDocument();
    expect(screen.queryByRole("treeitem", { name: "属性 board/model" })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("main", { name: /DTS 源码/ })).toHaveTextContent("Aurora"));
    expect(getStructure).toHaveBeenCalledWith(PROJECT.id, "file-board", "version-board-12", { navigationScope: "organization" });
    fireEvent.change(screen.getByRole("searchbox", { name: "统一搜索查询" }), { target: { value: "board" } });
    fireEvent.submit(screen.getByRole("form", { name: "统一结构搜索" }));
    await waitFor(() => expect(search).toHaveBeenCalledWith(PROJECT.id, { q: "board", navigationScope: "organization" }));
    const inspector = screen.getByRole("complementary", { name: "配置检查器" });
    expect(inspector).toHaveTextContent("model");
    expect(inspector).toHaveTextContent("字符串列表");
  });

  it.each([undefined, { status: "unavailable", reason: "catalog-unavailable" }])(
    "offers navigation retry when scoped metadata is unavailable instead of exposing full nodes (%j)", async (navigation) => {
      const getStructure = vi.fn().mockResolvedValueOnce({ ...BOARD_STRUCTURE, navigation })
        .mockResolvedValueOnce({ ...BOARD_STRUCTURE,
          navigation: { status: "ready", catalogReleaseId: "release-1", managedNodePaths: ["regulator"] }
        });
      const downloadVersion = vi.fn(async () => ({ contentType: "text/plain", fileName: "aurora-board.dts",
        bytes: new TextEncoder().encode('/dts-v1/;\n/ { model = "Aurora"; };\n') }));
      renderWorkbench({ apiMode: true, dtsRepository: createDtsRepository({ getStructure }),
        fileRepository: createFileRepository({ downloadVersion }) });
      expect(await screen.findByText("组织配置导航暂时不可用，请重试。")).toBeInTheDocument();
      expect(screen.queryByText("当前文件没有匹配组织已登记模块的节点。")).not.toBeInTheDocument();
      expect(screen.queryByRole("treeitem", { name: "节点 board" })).not.toBeInTheDocument();
      await waitFor(() => expect(screen.getByRole("main", { name: /DTS 源码/ })).toHaveTextContent("Aurora"));
      const sourceLoads = downloadVersion.mock.calls.length;
      fireEvent.click(screen.getByRole("button", { name: "重试配置导航" }));
      expect(await screen.findByRole("treeitem", { name: "节点 regulator" })).toBeInTheDocument();
      expect(getStructure).toHaveBeenCalledTimes(2);
      expect(downloadVersion).toHaveBeenCalledTimes(sourceLoads);
    }
  );

  it("keeps the file entry and source for a successful organization scope with no matches", async () => {
    renderWorkbench({ apiMode: true, dtsRepository: createDtsRepository({
      getStructure: vi.fn(async () => ({ ...BOARD_STRUCTURE,
        navigation: { status: "ready" as const, catalogReleaseId: "release-1", managedNodePaths: [] }
      }))
    }) });
    const empty = await screen.findByRole("treeitem", { name: "当前文件没有匹配组织已登记模块的节点。" });
    expect(empty).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("treeitem", { name: "aurora-board.dts 基础 v12" })).toBeInTheDocument();
    expect(screen.queryByRole("treeitem", { name: "节点 board" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "重试配置导航" })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("main", { name: /DTS 源码/ })).toHaveTextContent("Aurora"));
  });

  it.each([true, false])("restores source updates through file management and preserves them across close/reopen (admin=%s)", async (canAdmin) => {
    const base = { projectId: PROJECT.id, format: "dts" as const, status: "ready" as const,
      diagnostics: [], blockers: [], impact: { textDiff: '--- previous\n+++ incoming\n-model = "Old";\n+model = "Updated";' }, createdAt: "2026-08-07T00:00:00.000Z", updatedAt: "2026-08-07T00:00:00.000Z" };
    const current = { ...base, id: "update-current", fileId: "file-board", fileName: "aurora-board.dts" };
    const records = [{ ...base, id: "update-other", fileId: "file-overlay", fileName: "charging-overlay.dtsi", createdAt: "2026-08-08T00:00:00.000Z" },
      current, { ...current, id: "completed", status: "active" as const }, { ...current, id: "discarded", status: "abandoned" as const }];
    const createCandidate = vi.fn();
    const activateCandidate = vi.fn();
    const abandonCandidate = vi.fn();
    const recomputeCandidate = vi.fn();
    const getCandidate = vi.fn(async () => current);
    const listCandidates = vi.fn(async () => records);
    renderWorkbench({ canAdmin, canEdit: canAdmin, syncSearch: true,
      search: "?configSet=cs-default&file=file-board&sourceMode=candidate&candidate=update-current&inspector=candidates",
      fileRepository: createFileRepository({ createCandidate, getCandidate, listCandidates, activateCandidate, abandonCandidate, recomputeCandidate,
        getCandidateSourcePreview: vi.fn(async () => ({ kind: "legacy" as const, canSubmit: false, candidateId: current.id, fileId: current.fileId, format: "dts" })),
        downloadCandidate: vi.fn(async () => ({ contentType: "text/plain", fileName: current.fileName, bytes: new TextEncoder().encode('model = "Updated";') })) }) });
    expect(screen.queryByRole("button", { name: /^更新来源/ })).not.toBeInTheDocument();
    const panel = await screen.findByRole("complementary", { name: "配置检查器" });
    expect(panel.querySelector(".configuration-workbench__region-head")).toHaveTextContent("来源更新");
    expect(panel).toHaveTextContent("更新「aurora-board.dts」，上传后先核对差异。");
    if (canAdmin) expect(within(panel).getByRole("button", { name: "上传新文件" })).toBeEnabled();
    else {
      expect(within(panel).queryByRole("button", { name: /上传新文件|添加来源文件/ })).not.toBeInTheDocument();
      expect(within(panel).getByText("仅项目管理员可上传文件，已有更新记录可查看。")).toBeVisible();
      for (const name of ["确认应用", "放弃更新", "重新核对"]) expect(within(panel).queryByRole("button", { name })).not.toBeInTheDocument();
    }
    const list = within(panel).getByRole("region", { name: "候选记录" });
    const pendingList = list.querySelector<HTMLUListElement>(":scope > ul")!;
    expect(within(pendingList).getAllByRole("listitem")[0]).toHaveTextContent(current.fileName);
    expect(within(pendingList).getAllByRole("listitem")).toHaveLength(2);
    expect(within(list).getByText("已完成与已放弃（2）").closest("details")).not.toHaveAttribute("open");
    expect(await screen.findByLabelText("来源更新差异")).toHaveTextContent('+model = "Updated";');
    expect(screen.getByLabelText("来源更新差异")).toHaveTextContent('-model = "Old";');
    const recordLoads = listCandidates.mock.calls.length;
    fireEvent.click(within(panel).getByRole("button", { name: "关闭检查器" }));
    await waitFor(() => expect(screen.queryByRole("complementary", { name: "配置检查器" })).not.toBeInTheDocument());
    await openSourceUpdates();
    expect(screen.queryByRole("button", { name: /^更新来源/ })).not.toBeInTheDocument();
    expect(getCandidate).toHaveBeenCalledExactlyOnceWith(PROJECT.id, current.id);
    expect(listCandidates).toHaveBeenCalledTimes(recordLoads);
    expect(listCandidates).toHaveBeenCalledWith(PROJECT.id, { fileId: undefined, includeAbandoned: true });
    for (const mutate of [createCandidate, activateCandidate, abandonCandidate, recomputeCandidate]) expect(mutate).not.toHaveBeenCalled();
    await openWorkbenchMoreMenu();
    expect(screen.queryByRole("menuitem", { name: "候选记录" })).not.toBeInTheDocument();
  });

  it("keeps source updates behind one entry and conflict records behind their own task", async () => {
    const listCandidates = vi.fn<ParameterFileRepository["listCandidates"]>(async () => []);
    renderWorkbench({ syncSearch: true, fileRepository: createFileRepository({ listCandidates }) });
    await screen.findByRole("heading", { name: "aurora-board.dts" });
    await waitFor(() => expect(screen.queryByRole("button", { name: /候选加载/ })).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "候选" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "版本" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /^冲突/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "任务" })).not.toBeInTheDocument();
    const menu = await openWorkbenchMoreMenu();
    expect(within(menu).queryByRole("menuitem", { name: "版本历史与下载" })).not.toBeInTheDocument();
    expect(within(menu).queryByRole("menuitem", { name: "冲突处理" })).not.toBeInTheDocument();
    expect(within(menu).queryByRole("menuitem", { name: "保存版本快照" })).not.toBeInTheDocument();
    expect(within(menu).queryByRole("menuitem", { name: "候选记录" })).not.toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    await openSourceUpdates();
    expect(screen.getByRole("button", { name: "上传新文件" })).toBeEnabled();
    expect(await screen.findByText("暂无来源更新记录。上传来源文件后，可在这里继续核对或查看处理结果。")).toBeInTheDocument();
    expect(listCandidates).toHaveBeenCalledExactlyOnceWith(PROJECT.id, { fileId: undefined, includeAbandoned: true });
    fireEvent.click(screen.getByRole("button", { name: "关闭检查器" }));
    expect(screen.queryByRole("button", { name: "候选" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /^冲突/ })).not.toBeInTheDocument();
    await openWorkbenchReleaseDetails();
    fireEvent.click(screen.getByText("定版检查"));
    expect(screen.getByRole("region", { name: "版本检查问题" })).toBeVisible();
    expect(within(screen.getByRole("dialog", { name: "配置版本" })).getByRole("button", { name: "保存版本快照" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "任务" })).not.toBeInTheDocument();
  });

  it("shows loading and request errors inside source updates and retries its project records", async () => {
    let rejectCandidates!: (reason: Error) => void;
    const listCandidates = vi.fn<ParameterFileRepository["listCandidates"]>()
      .mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectCandidates = reject; }))
      .mockResolvedValueOnce([]);
    renderWorkbench({ syncSearch: true, fileRepository: createFileRepository({ listCandidates }) });
    await screen.findByRole("heading", { name: "aurora-board.dts" });
    await openSourceUpdates();
    expect(screen.getByRole("status", { name: "正在加载候选记录…" })).toBeInTheDocument();
    await act(async () => { rejectCandidates(new Error("candidate service offline")); });
    const records = await screen.findByRole("region", { name: "候选记录" });
    expect(within(records).getByRole("alert")).toBeVisible();
    fireEvent.click(within(records).getByRole("button", { name: "重试" }));
    expect(await within(records).findByText("暂无来源更新记录。上传来源文件后，可在这里继续核对或查看处理结果。")).toBeVisible();
    expect(listCandidates).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "关闭检查器" }));
    expect(screen.queryByRole("button", { name: /候选/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^更新来源/ })).not.toBeInTheDocument();
  });

  it.each(["source", "conflicts"])("keeps file versions only in file management in the %s view", async (tab) => {
    const user = userEvent.setup();
    renderWorkbench({ syncSearch: true, canAdmin: false,
      search: `?configSet=cs-default&file=file-board&tab=${tab}` });
    const navigator = screen.getByRole("region", { name: "配置导航" });
    const fileItem = await screen.findByRole("treeitem", { name: /aurora-board\.dts.*基础.*v12/ });
    expect(within(navigator).queryByRole("button", { name: "详情" })).not.toBeInTheDocument();
    expect(within(navigator).queryByRole("group", { name: "aurora-board.dts 操作" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /更多/ })).toHaveLength(1);
    if (tab === "source") {
      fileItem.focus();
      await user.keyboard("{Enter}");
    }
    await openWorkbenchMoreMenu();
    expect(screen.queryByRole("menuitem", { name: "文件详情" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "版本历史与下载" })).not.toBeInTheDocument();
    await user.keyboard("{Escape}");
    await openWorkbenchVersionDetails();
    expect(screen.getByRole("complementary", { name: "配置检查器" })).toBeVisible();
    expect(screen.getByRole("region", { name: "版本历史" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "关闭检查器" }));
    await user.click(screen.getByRole("button", { name: "收起配置导航" }));
    expect(fileItem).not.toBeVisible();
    expect(screen.queryByRole("tab", { name: "结构" })).not.toBeInTheDocument();
    await openWorkbenchVersionDetails();
    expect(screen.getByRole("complementary", { name: "配置检查器" })).toHaveTextContent("aurora-board.dts");
    expect(screen.getByRole("region", { name: "版本历史" })).toBeVisible();
    const files = await openSchemeFiles();
    expect(within(files).getByRole("table", { name: "配置文件" })).toBeVisible();
    await user.click(within(files).getByRole("button", { name: "关闭配置组成" }));
    expect(within(screen.getByLabelText("配置命令栏")).queryByRole("button", { name: /^更新来源/ })).not.toBeInTheDocument();
  });

  it("keeps the single config-set selector available when the file navigator is collapsed", async () => {
    renderWorkbench({ syncSearch: true });
    await screen.findByRole("main", { name: /DTS 源码/ });
    const navigator = screen.getByRole("region", { name: "配置导航" });
    expect(screen.getAllByRole("button", { name: "配置" })).toHaveLength(1);
    fireEvent.click(within(navigator).getByRole("button", { name: "收起配置导航" }));
    await selectScheme("cs-alpha");
    await waitFor(() => expect(screen.getByRole("button", { name: "配置" })).toHaveAttribute("data-value", "cs-alpha"));
    fireEvent.click(within(navigator).getByRole("button", { name: "展开配置导航" }));
    expect(await within(navigator).findByRole("button", { name: /alpha.dts 基础/ })).toBeVisible();
  });

  it.each(["closed", "release"] as const)("switches schemes without opening or replacing the %s inspector", async (panel) => {
    const { onNavigate } = renderWorkbench({ syncSearch: true,
      search: `?configSet=cs-default&file=file-board${panel === "closed" ? "" : `&inspector=${panel}`}` });
    await screen.findByRole("main", { name: /DTS 源码/ });
    if (panel === "release") await userEvent.click(screen.getByRole("button", { name: "关闭配置版本" }));
    expect(screen.getByRole("button", { name: "配置" })).toHaveTextContent("默认配置");
    if (panel === "closed") expect(screen.queryByRole("complementary", { name: "配置检查器" })).not.toBeInTheDocument();
    const menu = await openSchemeMenu();
    expect(within(menu).getByRole("menuitemradio", { name: "默认配置" })).toHaveAttribute("aria-checked", "true");
    expect(within(menu).getByRole("menuitem", { name: "配置组成" })).toBeEnabled();
    await userEvent.click(within(menu).getByRole("menuitemradio", { name: "alpha" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "配置" })).toHaveAttribute("data-value", "cs-alpha"));
    expect(screen.getByRole("button", { name: "配置" })).toHaveTextContent("alpha");
    await screen.findByRole("heading", { name: "alpha.dts" });
    if (panel === "closed") expect(screen.queryByRole("complementary", { name: "配置检查器" })).not.toBeInTheDocument();
    else expect(screen.queryByRole("dialog", { name: "配置版本" })).not.toBeInTheDocument();
    const latest = new URLSearchParams(String(onNavigate.mock.calls.at(-1)?.[0]).split("?")[1]);
    expect(latest.get("configSet")).toBe("cs-alpha");
    expect(latest.get("inspector")).toBeNull();
  });

  it.each([true, false])("opens configuration versions with the official snapshot selected and restores focus on close (admin=%s)", async (canAdmin) => {
    const user = userEvent.setup();
    renderWorkbench({ canAdmin, syncSearch: true });
    const entry = await screen.findByRole("button", { name: /^配置版本/ });
    await user.click(entry);
    const versions = await screen.findByRole("dialog", { name: "配置版本" });
    expect(await within(versions).findByRole("heading", { name: "seed-v1" })).toBeVisible();
    expect(within(versions).getByRole("button", { name: /^seed-v1.*正式版本/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("complementary", { name: "配置检查器" })).not.toBeInTheDocument();
    if (canAdmin) expect(within(versions).getByRole("button", { name: "保存版本快照" })).toBeEnabled();
    else {
      expect(within(versions).queryByRole("button", { name: "保存版本快照" })).not.toBeInTheDocument();
      expect(within(versions).queryByText("定版检查")).not.toBeInTheDocument();
      expect(within(versions).queryByRole("button", { name: "设为正式版本" })).not.toBeInTheDocument();
    }
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "配置版本" })).not.toBeInTheDocument();
    await waitFor(() => expect(entry).toHaveFocus());
  });

  it("omits standalone source validation and legacy sync actions for canonical files", async () => {
    const syncFile = vi.fn();
    renderWorkbench({ fileRepository: createFileRepository({ syncFile,
      getSourceWorkflow: vi.fn(async () => ({ canonical: true, bindingCount: 1, configSetId: "cs-default", proofToken: "proof" })) }) });
    await screen.findByRole("heading", { name: "aurora-board.dts" });
    const menu = await openWorkbenchMoreMenu();
    expect(within(menu).queryByRole("menuitem", { name: "来源一致性校验" })).not.toBeInTheDocument();
    expect(within(menu).queryByRole("menuitem", { name: "手动同步" })).not.toBeInTheDocument();
    expect(within(menu).queryByRole("menuitem", { name: "冲突处理" })).not.toBeInTheDocument();
    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["项目活动"]);
    expect(syncFile).not.toHaveBeenCalled();
  });

  it("opens canonical file management in a modal and targets the chosen file for versions and source updates", async () => {
    const getSourceWorkflow = vi.fn<ParameterFileRepository["getSourceWorkflow"]>(async (_projectId, fileId) => ({
      canonical: fileId === "file-board" || fileId === "file-overlay", bindingCount: 1,
      ...(fileId === "file-board" || fileId === "file-overlay" ? { configSetId: "cs-default", proofToken: `proof-${fileId}` } : {})
    }));
    const { onNavigate } = renderWorkbench({ syncSearch: true, search: "?configSet=cs-default&file=file-board&inspector=config-set",
      fileRepository: createFileRepository({ getSourceWorkflow }) });
    const files = await screen.findByRole("dialog", { name: "配置组成" });
    await waitFor(() => expect(getSourceWorkflow).toHaveBeenCalledWith(PROJECT.id, "file-overlay"));
    expect(within(files).getByRole("table", { name: "配置文件" })).toBeVisible();
    expect(within(files).queryByRole("button", { name: "添加文件" })).not.toBeInTheDocument();
    expect(await within(files).findByText("此配置已登记来源。添加或移除文件均需预览并确认，项目文件及历史会保留。")).toBeVisible();
    const overlayRow = within(files).getByRole("button", { name: "charging-overlay.dtsi" }).closest("tr")!;
    expect(within(overlayRow).getByRole("button", { name: "更新文件" })).toBeEnabled();
    await userEvent.click(within(overlayRow).getByRole("button", { name: "charging-overlay.dtsi 更多" }));
    expect(screen.queryByRole("menuitem", { name: /从配置移除/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("menuitem", { name: "版本历史与下载" }));
    expect(screen.queryByRole("dialog", { name: "配置组成" })).not.toBeInTheDocument();
    expect(await screen.findByRole("region", { name: "版本历史" })).toBeVisible();
    await waitFor(() => expect(onNavigate).toHaveBeenLastCalledWith(expect.stringMatching(/file=file-overlay.*inspector=versions/)));
    const reopened = await openSchemeFiles();
    const reopenedRow = within(reopened).getByRole("button", { name: "charging-overlay.dtsi" }).closest("tr")!;
    await userEvent.click(within(reopenedRow).getByRole("button", { name: "更新文件" }));
    expect(screen.queryByRole("dialog", { name: "配置组成" })).not.toBeInTheDocument();
    expect(await screen.findByRole("region", { name: "候选记录" })).toBeVisible();
    const target = new URLSearchParams(String(onNavigate.mock.calls.at(-1)?.[0]).split("?")[1]);
    expect(target.get("file")).toBe("file-overlay");
    expect(target.get("inspector")).toBe("candidates");
    expect(target.get("candidate")).toBeNull();
  });

  it("keeps file management read-only while allowing file and version navigation", async () => {
    const addConfigSetFile = vi.fn();
    const removeConfigSetFile = vi.fn();
    const syncFile = vi.fn();
    const { onNavigate } = renderWorkbench({ syncSearch: true, canAdmin: false,
      dtsRepository: createDtsRepository({ addConfigSetFile, removeConfigSetFile }),
      fileRepository: createFileRepository({ syncFile }) });
    await screen.findByRole("heading", { name: "aurora-board.dts" });
    const menu = await openSchemeMenu();
    expect(within(menu).queryByRole("menuitem", { name: "导出当前配置" })).not.toBeInTheDocument();
    expect(within(menu).queryByRole("menuitem", { name: "新建配置…" })).not.toBeInTheDocument();
    await userEvent.click(within(menu).getByRole("menuitem", { name: "查看文件" }));
    const files = await screen.findByRole("dialog", { name: "配置组成" });
    expect(files).toHaveTextContent("只读");
    expect(within(files).queryByRole("button", { name: "更新文件" })).not.toBeInTheDocument();
    expect(within(files).queryByRole("button", { name: "添加文件" })).not.toBeInTheDocument();
    await userEvent.click(within(files).getByRole("button", { name: "charging-overlay.dtsi" }));
    expect(screen.queryByRole("dialog", { name: "配置组成" })).not.toBeInTheDocument();
    await waitFor(() => expect(onNavigate).toHaveBeenLastCalledWith(expect.stringContaining("file=file-overlay")));
    const reopened = await openSchemeFiles();
    await userEvent.click(within(reopened).getByRole("button", { name: "charging-overlay.dtsi 更多" }));
    expect(screen.queryByRole("menuitem", { name: /从配置移除/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("menuitem", { name: "版本历史与下载" }));
    expect(await screen.findByRole("region", { name: "版本历史" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "手动同步" })).not.toBeInTheDocument();
    expect(addConfigSetFile).not.toHaveBeenCalled();
    expect(removeConfigSetFile).not.toHaveBeenCalled();
    expect(syncFile).not.toHaveBeenCalled();
  });

  it("opens the selected file in source when file management was opened from conflicts", async () => {
    const { onNavigate } = renderWorkbench({ syncSearch: true,
      search: "?configSet=cs-default&file=file-board&tab=conflicts" });
    await screen.findByRole("tabpanel", { name: "冲突" });
    const files = await openSchemeFiles();
    await userEvent.click(await within(files).findByRole("button", { name: "charging-overlay.dtsi" }));
    expect(await screen.findByRole("heading", { name: "charging-overlay.dtsi" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "冲突处理" })).not.toBeInTheDocument();
    const target = new URLSearchParams(String(onNavigate.mock.calls.at(-1)?.[0]).split("?")[1]);
    expect(target.get("tab")).toBe("source");
    expect(target.get("file")).toBe("file-overlay");
    expect(target.get("inspector")).toBeNull();
  });

  it("does not offer a project file already assigned to another configuration", async () => {
    const addConfigSetFile = vi.fn();
    const getSourceWorkflow = vi.fn<ParameterFileRepository["getSourceWorkflow"]>(async (_projectId, fileId) => ({
      canonical: false, bindingCount: 0,
      ...(fileId === "file-loose" || fileId === "file-alpha" ? { configSetId: "cs-alpha" } : {})
    }));
    renderWorkbench({ dtsRepository: createDtsRepository({ addConfigSetFile }),
      fileRepository: createFileRepository({ getSourceWorkflow }) });
    await waitFor(() => expect(getSourceWorkflow).toHaveBeenCalledWith(PROJECT.id, "file-alpha"));
    await waitFor(() => expect(screen.queryByRole("group", { name: "待分配项目文件" })).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "加入 notes.json" })).not.toBeInTheDocument();
    const files = await openSchemeFiles();
    expect(within(files).queryByRole("combobox", { name: "待加入文件" })).not.toBeInTheDocument();
    expect(within(files).queryByRole("button", { name: "添加文件" })).not.toBeInTheDocument();
    expect(files).not.toHaveTextContent("notes.json");
    expect(addConfigSetFile).not.toHaveBeenCalled();
  });

  it("rechecks ownership before adding an available project file and reports a concurrent assignment inside file management", async () => {
    let assignedElsewhere = false;
    const addConfigSetFile = vi.fn();
    const getSourceWorkflow = vi.fn<ParameterFileRepository["getSourceWorkflow"]>(async (_projectId, fileId) => ({
      canonical: false, bindingCount: 0,
      ...(assignedElsewhere && fileId === "file-loose" ? { configSetId: "cs-other" } : {})
    }));
    renderWorkbench({ dtsRepository: createDtsRepository({ addConfigSetFile }),
      fileRepository: createFileRepository({ getSourceWorkflow }) });
    await screen.findByRole("heading", { name: "aurora-board.dts" });
    const files = await openSchemeFiles();
    const available = await within(files).findByRole("combobox", { name: "待加入文件" });
    await selectControlOption(available, "file-loose");
    const add = within(files).getByRole("button", { name: "添加文件" });
    await waitFor(() => expect(add).toBeEnabled());
    const readsBeforeAdd = getSourceWorkflow.mock.calls.filter(([, fileId]) => fileId === "file-loose").length;
    assignedElsewhere = true;
    await userEvent.click(add);
    expect(await within(files).findByRole("alert")).toHaveTextContent("此文件已属于其他配置");
    expect(getSourceWorkflow.mock.calls.filter(([, fileId]) => fileId === "file-loose")).toHaveLength(readsBeforeAdd + 1);
    expect(addConfigSetFile).not.toHaveBeenCalled();
    expect(files).toBeVisible();
  });

  it("renders a legacy structure tab as source while preserving left-tree editing", async () => {
    const user = userEvent.setup();
    const { onNavigate } = renderWorkbench({ syncSearch: true,
      search: "?configSet=cs-default&file=file-board&node=board&property=model&tab=structure",
      dtsRepository: createDtsRepository({ getStructure: vi.fn(async () => BOARD_STRUCTURE) }) });
    await screen.findByRole("main", { name: /DTS 源码/ });
    await waitFor(() => expect(screen.queryByRole("tablist", { name: "项目配置内容" })).not.toBeInTheDocument());
    expect(screen.queryByRole("tab", { name: "源码" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tabpanel")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "配置内容" })).toBeVisible();
    expect(screen.queryByRole("tabpanel", { name: "结构" })).not.toBeInTheDocument();
    const navigator = screen.getByRole("region", { name: "配置导航" });
    const property = await within(navigator).findByRole("treeitem", { name: "属性 board/model" });
    expect(onNavigate).not.toHaveBeenCalled();
    await user.click(property);
    expect(screen.getByRole("complementary", { name: "配置检查器" })).toHaveTextContent("model");
    expect(screen.getByRole("main", { name: /DTS 源码/ })).toBeVisible();
    expect(within(screen.getByRole("complementary", { name: "配置检查器" })).getByRole("region", { name: "当前属性说明" })).toHaveTextContent('"Aurora"');
    expect(screen.queryByRole("tab", { name: "冲突" })).not.toBeInTheDocument();
    await openWorkbenchMoreMenu();
    expect(screen.queryByRole("menuitem", { name: "冲突处理" })).not.toBeInTheDocument();
  });

  it("returns from an empty legacy conflicts link to source with keyboard focus", async () => {
    const user = userEvent.setup();
    const { onNavigate } = renderWorkbench({ syncSearch: true,
      search: "?configSet=cs-default&file=file-board&node=board&property=model&tab=conflicts" });
    const conflicts = await screen.findByRole("tabpanel", { name: "冲突" });
    expect(within(conflicts).getByText("当前没有待处理同步冲突。来源冲突请在候选记录中查看。")).toBeTruthy();
    expect(within(conflicts).queryByText("会话变更")).not.toBeInTheDocument();
    screen.getByRole("tab", { name: "冲突" }).focus();
    await user.keyboard("{ArrowLeft}{Enter}");
    expect(await screen.findByRole("main", { name: /DTS 源码/ })).toBeVisible();
    expect(screen.queryByRole("tablist", { name: "项目配置内容" })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("main", { name: /DTS 源码/ })).toHaveFocus());
    expect(onNavigate.mock.calls.at(-1)?.[0]).toContain("node=board&property=model");
  });

  it.each([
    ["unified-diff", "选择要对比的版本"],
    ["side-by-side", "选择要对比的版本"],
    ["candidate", "尚未选择来源更新"],
    ["history", "暂无历史版本"]
  ])("respects the requested empty %s mode without navigating away", async (canvasMode, title) => {
    const { onNavigate } = renderWorkbench({
      search: `?configSet=cs-default&file=file-board&sourceMode=${canvasMode}`,
      canAdmin: false
    });
    expect(await screen.findByText(title)).toBeInTheDocument();
    expect(onNavigate).not.toHaveBeenCalled();
    expect(within(screen.getByRole("main", { name: /DTS 源码/ })).queryByRole("button", { name: /更新来源|添加来源文件/ })).not.toBeInTheDocument();
  });

  it("opens version history from the canvas without changing the requested mode", async () => {
    const { onNavigate } = renderWorkbench({
      search: "?configSet=cs-default&file=file-board&sourceMode=unified-diff",
      fileRepository: createFileRepository({ listVersions: vi.fn(async () => [{
        id: "version-board-11", fileId: "file-board", versionNumber: 11,
        checksum: "checksum", sizeBytes: 0, parsedIndex: {}, origin: "upload" as const,
        createdAt: "2026-08-06T08:00:00.000Z", createdByUserId: "user-admin"
      }]) })
    });
    fireEvent.click(await screen.findByRole("button", { name: "选择版本" }));
    expect(await screen.findByRole("region", { name: "版本历史" })).toBeInTheDocument();
    expect(onNavigate).toHaveBeenCalledWith("/parameter-admin/projects/project-1/configuration?configSet=cs-default&file=file-board&sourceMode=unified-diff&inspector=versions");
  });

  it.each(["unified-diff", "side-by-side"])("returns explicitly from an unavailable %s version to working source", async (canvasMode) => {
    const { onNavigate } = renderWorkbench({
      search: `?configSet=cs-default&file=file-board&sourceMode=${canvasMode}&version=removed`,
      syncSearch: true,
      fileRepository: createFileRepository({ downloadVersion: vi.fn(async (_projectId, _fileId, versionId) => {
        if (versionId === "removed") throw new WiseEffApiError("NOT_FOUND", "missing", {}, "request");
        return { contentType: "text/plain", fileName: "board.dts", bytes: new TextEncoder().encode("working") };
      }) })
    });
    expect(await screen.findByText("对比版本不可用")).toBeInTheDocument();
    expect(onNavigate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "返回工作源" }));
    await waitFor(() => expect(screen.queryByText("对比版本不可用")).not.toBeInTheDocument());
    expect(onNavigate.mock.calls.some(([path]) => String(path).includes("sourceMode="))).toBe(false);
  });

  it.each(["unified-diff", "side-by-side"])("renders an identical valid empty %s without a failure", async (canvasMode) => {
    renderWorkbench({
      search: `?configSet=cs-default&file=file-board&sourceMode=${canvasMode}&version=empty`,
      fileRepository: createFileRepository({ downloadVersion: vi.fn(async () => ({
        contentType: "text/plain", fileName: "board.dts", bytes: new Uint8Array()
      })) })
    });
    expect(await screen.findByText("两个版本没有差异")).toBeInTheDocument();
    expect(screen.queryByText("源码读取失败")).not.toBeInTheDocument();
  });

  it.each(["approve", "reject", "withdraw"])("refreshes mounted readiness after canonical %s and on focus or visibility", async () => {
    const ready = await createDtsRepository().getReleaseReadiness(PROJECT.id, "cs-default");
    let pending = true;
    const getReleaseReadiness = vi.fn(async () => ({ ...ready, level: pending ? "blocked" as const : "ready" as const,
      canRelease: !pending, canCreateBaseline: !pending,
      blockers: pending ? [{ id: "pending", severity: "blocker" as const, code: "pending-change",
        message: "1 canonical request awaits review",
        remediation: { kind: "complete-pending-change" as const, label: "Review pending requests" } }] : [] }));
    renderWorkbench({ dtsRepository: createDtsRepository({ getReleaseReadiness }) });
    const summary = await screen.findByRole("status", { name: "配置版本状态" });
    await waitFor(() => expect(summary).toHaveAttribute("data-can-release", "false"));
    const evaluations = getReleaseReadiness.mock.calls.length;
    act(() => window.dispatchEvent(new CustomEvent("wiseeff:canonical-requests-changed", { detail: { projectId: "other-project" } })));
    expect(getReleaseReadiness).toHaveBeenCalledTimes(evaluations);
    pending = false;
    act(() => window.dispatchEvent(new CustomEvent("wiseeff:canonical-requests-changed", { detail: { projectId: PROJECT.id } })));
    await waitFor(() => expect(summary).toHaveAttribute("data-can-release", "true"));
    pending = true;
    act(() => window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(summary).toHaveAttribute("data-can-release", "false"));
    const afterFocus = getReleaseReadiness.mock.calls.length;
    const visibility = vi.spyOn(document, "visibilityState", "get");
    try {
      visibility.mockReturnValue("hidden");
      act(() => document.dispatchEvent(new Event("visibilitychange")));
      expect(getReleaseReadiness).toHaveBeenCalledTimes(afterFocus);
      pending = false;
      visibility.mockReturnValue("visible");
      act(() => document.dispatchEvent(new Event("visibilitychange")));
      await waitFor(() => expect(summary).toHaveAttribute("data-can-release", "true"));
    } finally {
      visibility.mockRestore();
    }
  });

  it("navigates pending readiness remediation to the canonical request review surface", async () => {
    const ready = await createDtsRepository().getReleaseReadiness(PROJECT.id, "cs-default");
    const href = "/parameter-review?project=project-1&request=request-pending";
    const { onNavigate } = renderWorkbench({ dtsRepository: createDtsRepository({
      getReleaseReadiness: vi.fn<DtsStructuredRepository["getReleaseReadiness"]>(async () => ({ ...ready, level: "blocked", canRelease: false,
        canCreateBaseline: false, blockers: [{ id: "pending", severity: "blocker", code: "pending-change",
          message: "1 canonical request awaits review", target: { changeRequestId: "request-pending" },
          remediation: { kind: "complete-pending-change", label: "Review pending requests", href } }] }))
    }) });
    const summary = await screen.findByRole("status", { name: "配置版本状态" });
    fireEvent.click(within(summary).getByRole("button"));
    const issues = await screen.findByRole("region", { name: "版本检查问题" });
    fireEvent.click(within(issues).getByRole("button", { name: /前往变更审核/ }));
    expect(onNavigate).toHaveBeenLastCalledWith(href);
  });

  it("selects the deterministic default Config set and renders working source identities", async () => {
    const { onNavigate } = renderWorkbench();

    expect(await screen.findByRole("heading", { name: "aurora-board.dts" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "配置" })).toHaveAttribute("data-value", "cs-default");
    expect(screen.getByText(/工作配置.*v12/)).toBeInTheDocument();
    await openWorkbenchReleaseDetails();
    expect(within(screen.getByRole("region", { name: "配置版本列表与详情" })).getByRole("heading", { name: "seed-v1" })).toBeInTheDocument();
    expect(screen.getByRole("treeitem", { name: /aurora-board\.dts.*基础.*v12/ })).toBeInTheDocument();
    // Raw version ids stay discoverable via tooltip but never render as text (FA-23).
    expect(screen.getAllByTitle("version-board-12").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("version-board-12")).not.toBeInTheDocument();
    expect(screen.getByText(/工作配置.*v12/)).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "待分配项目文件" })).toHaveTextContent("notes.json");
    expect(await screen.findByText(/model = "Aurora"/)).toBeInTheDocument();
    await waitFor(() =>
      expect(onNavigate).toHaveBeenCalledWith(
        "/parameter-admin/projects/project-1/configuration?configSet=cs-default&file=file-board"
      )
    );
    expect(screen.queryByRole("button", { name: /更新来源|添加来源文件/ })).not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: "工作台操作" })).toContainElement(screen.getByLabelText("配置命令栏"));
    expect(within(screen.getByRole("dialog", { name: "配置版本" })).getByRole("button", { name: "保存版本快照" })).toBeEnabled();
    expect(await screen.findByLabelText("配置版本状态")).toHaveAttribute("data-level", "ready");
  });

  it("lets a valid URL-selected Config set win and keeps source selection shareable", async () => {
    const { onNavigate } = renderWorkbench({ search: "?configSet=cs-alpha" });

    expect(await screen.findByRole("heading", { name: "alpha.dts" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "配置" })).toHaveAttribute("data-value", "cs-alpha");
    expect(await screen.findByText(/model = "Alpha"/)).toBeInTheDocument();

    await selectScheme("cs-default");
    expect(onNavigate).toHaveBeenCalledWith(
      "/parameter-admin/projects/project-1/configuration?configSet=cs-default"
    );
  });

  it("falls back deterministically and chooses a source-bearing DTS member", async () => {
    const listConfigSets = vi.fn(async () => [
      {
        id: "cs-later",
        organizationId: "org-1",
        projectId: PROJECT.id,
        name: "later",
        createdAt: "2026-08-06T09:00:00.000Z",
        updatedAt: "2026-08-06T09:00:00.000Z"
      },
      {
        id: "cs-first",
        organizationId: "org-1",
        projectId: PROJECT.id,
        name: "first",
        createdAt: "2026-08-06T08:00:00.000Z",
        updatedAt: "2026-08-06T08:00:00.000Z"
      }
    ]);
    const listConfigSetFiles = vi.fn<DtsStructuredRepository["listConfigSetFiles"]>(async (projectId: string, configSetId: string) => [
      {
        configSetId,
        fileId: "file-metadata",
        fileName: "metadata.json",
        format: "json" as const,
        role: "misc" as const,
        sortOrder: 0,
        currentVersionId: "version-metadata-1",
        currentVersionNumber: 1
      },
      {
        configSetId,
        fileId: "file-board",
        fileName: "aurora-board.dts",
        format: "dts" as const,
        role: "base" as const,
        sortOrder: 1,
        currentVersionId: "version-board-12",
        currentVersionNumber: 12
      }
    ]);
    const downloadVersion = vi.fn(async () => ({
      contentType: "text/plain",
      fileName: "aurora-board.dts",
      bytes: new TextEncoder().encode("/dts-v1/;\n/ { primary-source; };\n")
    }));

    renderWorkbench({
      search: "?configSet=unknown&file=unknown",
      dtsRepository: createDtsRepository({ listConfigSets, listConfigSetFiles }),
      fileRepository: createFileRepository({ downloadVersion })
    });

    expect(await screen.findByRole("heading", { name: "aurora-board.dts" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "配置" })).toHaveAttribute("data-value", "cs-first");
    await waitFor(() =>
      expect(downloadVersion).toHaveBeenCalledWith(PROJECT.id, "file-board", "version-board-12")
    );
    expect(await screen.findByText(/primary-source/)).toBeInTheDocument();
  });

  it("preserves the tree and retries only a failed source request", async () => {
    const downloadVersion = vi
      .fn()
      .mockRejectedValueOnce(new Error("source unavailable"))
      .mockResolvedValueOnce({
        contentType: "text/plain",
        fileName: "aurora-board.dts",
        bytes: new TextEncoder().encode("/dts-v1/;\n/ { recovered; };\n")
      });
    renderWorkbench({ fileRepository: createFileRepository({ downloadVersion }) });

    expect(await screen.findByText("源码加载失败。")).toBeInTheDocument();
    expect(screen.getByRole("treeitem", { name: /aurora-board\.dts/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重试源码" }));

    await waitFor(() => expect(screen.getByText(/recovered/)).toBeInTheDocument());
    expect(downloadVersion).toHaveBeenCalledTimes(2);
  });

  it.each(["history", "unified-diff", "side-by-side"])("retries a failed %s source download instead of only clearing the error", async (mode) => {
    let failHistory = true;
    const downloadVersion = vi.fn<ParameterFileRepository["downloadVersion"]>(async (_projectId, _fileId, versionId) => {
      if (versionId === "version-board-11" && failHistory) throw new Error("historical source unavailable");
      return { contentType: "text/plain", fileName: "aurora-board.dts", bytes: new TextEncoder().encode(
        versionId === "version-board-11" ? '/dts-v1/;\n/ { model = "recovered-history"; };\n' : '/dts-v1/;\n/ { model = "Aurora"; };\n'
      ) };
    });
    const getStructure = vi.fn(async () => BOARD_STRUCTURE);
    const { onNavigate } = renderWorkbench({ search: `?configSet=cs-default&file=file-board&sourceMode=${mode}&version=version-board-11`,
      dtsRepository: createDtsRepository({ getStructure }), fileRepository: createFileRepository({ downloadVersion }) });
    expect(await screen.findByText("历史源码加载失败。")).toBeInTheDocument();
    const historyDownloads = downloadVersion.mock.calls.filter(([, , version]) => version === "version-board-11").length;
    const workingDownloads = downloadVersion.mock.calls.filter(([, , version]) => version === "version-board-12").length;
    const structureLoads = getStructure.mock.calls.length;
    failHistory = false;
    fireEvent.click(screen.getByRole("button", { name: "重试源码" }));
    await waitFor(() => expect(screen.getByRole("main", { name: /DTS 源码/ })).toHaveTextContent("recovered-history"));
    expect(downloadVersion.mock.calls.filter(([, , version]) => version === "version-board-11")).toHaveLength(historyDownloads + 1);
    expect(downloadVersion.mock.calls.filter(([, , version]) => version === "version-board-12")).toHaveLength(workingDownloads + (mode === "history" ? 0 : 1));
    expect(getStructure).toHaveBeenCalledTimes(structureLoads);
    expect(screen.queryByText("历史源码加载失败。")).not.toBeInTheDocument();
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("joins membership ids with file metadata so mock-added members load active source", async () => {
    const listConfigSetFiles = vi.fn<DtsStructuredRepository["listConfigSetFiles"]>(async () => [
      {
        configSetId: "cs-default",
        fileId: "file-uploaded",
        fileName: "file-uploaded",
        format: "dts" as const,
        role: "overlay" as const,
        sortOrder: 0
      }
    ]);
    const downloadVersion = vi.fn(async () => ({
      contentType: "text/plain",
      fileName: "uploaded.dts",
      bytes: new TextEncoder().encode('/dts-v1/;\n/ { model = "Uploaded"; };\n')
    }));

    renderWorkbench({
      dtsRepository: createDtsRepository({ listConfigSetFiles }),
      fileRepository: createFileRepository({
        listFiles: vi.fn<ParameterFileRepository["listFiles"]>(async () => [
          {
            id: "file-uploaded",
            projectId: PROJECT.id,
            fileName: "uploaded.dts",
            format: "dts",
            enabled: true,
            currentVersionId: "version-uploaded-1",
            currentVersionNumber: 1,
            updatedAt: "2026-08-06T08:00:00.000Z"
          }
        ]),
        downloadVersion
      })
    });

    expect(await screen.findByRole("heading", { name: "uploaded.dts" })).toBeInTheDocument();
    expect(await screen.findByText(/model = "Uploaded"/)).toBeInTheDocument();
    expect(downloadVersion).toHaveBeenCalledWith(PROJECT.id, "file-uploaded", "version-uploaded-1");
    expect(screen.getByRole("treeitem", { name: /uploaded\.dts.*覆盖层.*v1/ })).toBeInTheDocument();
  });

  it("shows a recoverable empty-source state after a successful zero-byte download", async () => {
    const downloadVersion = vi.fn(async () => ({
      contentType: "text/plain",
      fileName: "aurora-board.dts",
      bytes: new Uint8Array()
    }));

    renderWorkbench({ fileRepository: createFileRepository({ downloadVersion }) });

    await waitFor(() => expect(downloadVersion).toHaveBeenCalled());
    expect(await screen.findByText("源码内容为空")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试源码" })).toBeInTheDocument();
  });

  it("keeps the working source visible while a release baseline failure is retried", async () => {
    const listBaselines = vi
      .fn()
      .mockRejectedValueOnce(new Error("baseline unavailable"))
      .mockResolvedValueOnce([]);
    renderWorkbench({ dtsRepository: createDtsRepository({ listBaselines }) });

    expect(await screen.findByRole("heading", { name: "aurora-board.dts" })).toBeInTheDocument();
    await openWorkbenchReleaseDetails();
    expect(screen.getByRole("alert")).toHaveTextContent("配置版本加载失败");
    fireEvent.click(within(screen.getByRole("region", { name: "配置版本列表与详情" })).getByRole("button", { name: "重新加载" }));

    await waitFor(() => expect(screen.getByText("尚未保存版本快照。")).toBeInTheDocument());
    expect(listBaselines).toHaveBeenCalledTimes(2);
  });

  it("keeps navigation and object details controlled while hiding empty task chrome", async () => {
    renderWorkbench();
    await screen.findByRole("heading", { name: "aurora-board.dts" });
    expect(screen.getByRole("complementary", { name: "源结构" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "任务" })).not.toBeInTheDocument();
    expect(screen.queryByText("任务证据")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "收起配置导航" }));
    expect(screen.queryByRole("complementary", { name: "源结构" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "展开配置导航" }));
    expect(screen.getByRole("complementary", { name: "源结构" })).toBeInTheDocument();
    await ensureInspectorOpen();
    expect(screen.getByRole("complementary", { name: "配置检查器" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "关闭检查器" }));
    expect(screen.queryByRole("complementary", { name: "配置检查器" })).not.toBeInTheDocument();
  });

  it("opens precise object details when navigating DTS nodes, properties, or search hits", async () => {
    const search = vi.fn(async () => ({
      hits: [
        {
          fileId: "file-board",
          fileName: "aurora-board.dts",
          versionId: "version-board-12",
          nodePath: "board",
          propertyName: "model",
          snippet: "model",
          source: {
            startOffset: 20,
            endOffset: 28,
            startLine: 2,
            startColumn: 3,
            endLine: 2,
            endColumn: 11
          }
        }
      ]
    }));
    renderWorkbench({
      dtsRepository: createDtsRepository({
        getStructure: vi.fn(async () => BOARD_STRUCTURE),
        search
      })
    });
    await screen.findByRole("heading", { name: "aurora-board.dts" });
    expect(screen.queryByRole("complementary", { name: "配置检查器" })).not.toBeInTheDocument();

    fireEvent.click(await screen.findByRole("treeitem", { name: "节点 board" }));
    fireEvent.click(await screen.findByRole("treeitem", { name: "属性 board/model" }));
    await waitFor(() => expect(screen.getByRole("complementary", { name: "配置检查器" })).toHaveTextContent("model"));

    fireEvent.change(screen.getByLabelText("统一搜索查询"), { target: { value: "model" } });
    fireEvent.submit(screen.getByRole("form", { name: "统一结构搜索" }));
    const results = await screen.findByLabelText("搜索结果");
    fireEvent.click(within(results).getByRole("button", { name: /board/ }));
    await waitFor(() => expect(screen.getByRole("complementary", { name: "配置检查器" })).toHaveTextContent("model"));
  });

  it("reopens details when clicking the same selected property after closing the panel", async () => {
    const target = "?configSet=cs-default&file=file-board&node=board&property=model";
    const { onNavigate } = renderWorkbench({ search: target, syncSearch: true,
      dtsRepository: createDtsRepository({ getStructure: vi.fn(async () => BOARD_STRUCTURE) }) });
    const property = await screen.findByRole("treeitem", { name: "属性 board/model" });
    await waitFor(() => expect(property).toHaveAttribute("aria-selected", "true"));
    fireEvent.click(property);
    expect(await screen.findByRole("region", { name: "当前属性说明" })).toBeInTheDocument();
    expect(new URLSearchParams(String(onNavigate.mock.calls.at(-1)?.[0]).split("?")[1]).get("inspector")).toBe("selection");
    fireEvent.click(screen.getByRole("button", { name: "关闭检查器" }));
    expect(screen.queryByRole("complementary", { name: "配置检查器" })).not.toBeInTheDocument();
    expect(new URLSearchParams(String(onNavigate.mock.calls.at(-1)?.[0]).split("?")[1]).has("inspector")).toBe(false);
    fireEvent.click(property);
    expect(await screen.findByRole("region", { name: "当前属性说明" })).toBeInTheDocument();
    const reopened = new URLSearchParams(String(onNavigate.mock.calls.at(-1)?.[0]).split("?")[1]);
    expect(reopened.get("inspector")).toBe("selection");
    expect(reopened.get("file")).toBe("file-board");
    expect(reopened.get("node")).toBe("board");
    expect(reopened.get("property")).toBe("model");
    expect(property).toHaveAttribute("aria-selected", "true");
  });

  it("hydrates an inspector=selection URL into the requested property after structure loading", async () => {
    let finishStructure!: (result: DtsStructureResult) => void;
    const pendingStructure = new Promise<DtsStructureResult>((resolve) => { finishStructure = resolve; });
    const getStructure = vi.fn(async () => pendingStructure);
    renderWorkbench({ search: "?configSet=cs-default&file=file-board&node=board&property=model&inspector=selection",
      syncSearch: true, canEdit: true, canEditCritical: true,
      dtsRepository: createDtsRepository({ getStructure }) });
    await waitFor(() => expect(getStructure).toHaveBeenCalledWith(PROJECT.id, "file-board", "version-board-12"));
    await act(async () => { finishStructure(BOARD_STRUCTURE); await pendingStructure; });
    const inspector = await screen.findByRole("complementary", { name: "配置检查器" });
    expect(await within(inspector).findByRole("region", { name: "当前属性说明" })).toBeInTheDocument();
    expect(within(inspector).getByRole("region", { name: "当前属性说明" })).toHaveTextContent('"Aurora"');
    expect(within(inspector).queryByLabelText("规范化预览")).not.toBeInTheDocument();
    expect(inspector).toHaveTextContent("model");
    expect(inspector).not.toHaveTextContent("文件格式");
    expect(screen.getByRole("treeitem", { name: "属性 board/model" })).toHaveAttribute("aria-selected", "true");
  });

  it("keeps parameter details read-only beside one full-file editor", async () => {
    renderSourceWorkbench();
    fireEvent.click(await screen.findByRole("treeitem", { name: "属性 board/model" }));
    const inspector = await screen.findByRole("complementary", { name: "配置检查器" });
    expect(within(inspector).getByRole("region", { name: "当前属性说明" })).toHaveTextContent('"Aurora"');
    expect(inspector).toHaveTextContent("在源码区切换到编辑模式可修改完整 DTS");
    expect(within(inspector).queryByRole("group", { name: "属性值编辑" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "展开参数编辑" })).not.toBeInTheDocument();
    expect(await screen.findByRole("textbox", { name: "DTS 源码" })).toHaveAttribute("readonly");
  });

  it.each([{ canEdit: false, canAdmin: true }, { canEdit: true, canAdmin: false }])("requires project file edit authority for source mode: %o", async (permissions) => {
    renderSourceWorkbench(permissions);
    expect(await screen.findByRole("textbox", { name: "DTS 源码" })).toHaveAttribute("readonly");
    expect(screen.getByRole("radio", { name: "编辑" })).toBeDisabled();
    expect(screen.getByText("当前为只读预览，需要项目文件修改权限才能编辑。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存修改" })).toBeDisabled();
    expect(screen.getByRole("main", { name: /DTS 源码/ })).toHaveTextContent('model = "Aurora"');
  });

  it("keeps critical-node context without reviving the removed numeric form", async () => {
    renderSourceWorkbench({ canEditCritical: false });
    fireEvent.click(await screen.findByRole("treeitem", { name: "属性 regulator/regulator-min-microvolt" }));
    const inspector = await screen.findByRole("complementary", { name: "配置检查器" });
    expect(inspector).toHaveTextContent("<0x1000>");
    expect(within(inspector).queryByLabelText("数值 1")).not.toBeInTheDocument();
    expect(within(inspector).getByRole("region", { name: "当前属性说明" })).toBeInTheDocument();
  });

  it("marks source dirty without opening property tasks and preserves the buffer across modes", async () => {
    renderSourceWorkbench();
    const text = '/ { names = "", "same", "same"; wide = /bits/ 64 <9007199254740993>; };';
    const input = await enterSourceEdit(text);
    expect(screen.getByText("未保存修改")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存修改" })).toBeEnabled();
    expect(screen.queryByRole("region", { name: "配置任务" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "预览" }));
    expect(input).toHaveValue(text); expect(input).toHaveAttribute("readonly");
    fireEvent.click(screen.getByRole("radio", { name: "编辑" }));
    expect(input).toHaveValue(text); expect(input).not.toHaveAttribute("readonly");
  });

  it("stages exact source bytes with pinned file/config bases instead of property edits", async () => {
    const submitStructuredEdits = vi.fn();
    const f = renderSourceWorkbench({ dtsRepository: createDtsRepository({ submitStructuredEdits }) });
    const text = '/dts-v1/;\n/ { /* preserve */ names = "", "same", "same"; };\n';
    await enterSourceEdit(text); fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
    await screen.findByRole("dialog", { name: "保存 DTS 修改" });
    await waitFor(() => expect(f.createCandidate).toHaveBeenCalledOnce());
    expect(f.createCandidate).toHaveBeenCalledWith(PROJECT.id, expect.objectContaining({ intent: "source_revision", fileId: "file-board", expectedCurrentVersionId: "version-board-12", expectedConfigRevisionId: "rev-cs-listed", clientMutationId: expect.any(String) }));
    expect(atob(f.createCandidate.mock.calls[0][1].contentBase64)).toBe(text);
    expect(f.getCandidateSourcePreview).toHaveBeenCalledWith(PROJECT.id, "source-candidate");
    expect(submitStructuredEdits).not.toHaveBeenCalled();
  });

  it.each(["candidate", "validation"])("retains complete source when %s fails", async (stage) => {
    const createCandidate = stage === "candidate" ? vi.fn().mockRejectedValue(new Error("unavailable")) : vi.fn().mockResolvedValue({ id: "invalid" });
    renderSourceWorkbench({ fileRepository: createFileRepository({ createCandidate, getCandidateSourcePreview: vi.fn().mockRejectedValue(new WiseEffApiError("VALIDATION_FAILED", "Invalid DTS", {}, "test-request")) }) });
    const text = '/dts-v1/;\n/ { values = <1 2;';
    const input = await enterSourceEdit(text); fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
    const dialog = await screen.findByRole("dialog", { name: "保存 DTS 修改" });
    expect(await within(dialog).findByRole("alert")).toBeInTheDocument();
    expect(input).toHaveValue(text); expect(within(dialog).getByRole("button", { name: "提交审核" })).toBeDisabled();
    fireEvent.click(within(dialog).getByRole("button", { name: "返回编辑" }));
    expect(input).not.toHaveAttribute("readonly");
  });

  it("does not let a queued source scroll clear a newly selected edit occurrence", async () => {
    renderWorkbench({ syncSearch: true,
      dtsRepository: createDtsRepository({ getStructure: vi.fn(async () => BOARD_STRUCTURE) }) });
    await screen.findByRole("heading", { name: "aurora-board.dts" });
    const property = await screen.findByRole("treeitem", { name: "属性 board/model" });
    await ensureInspectorOpen();
    vi.useFakeTimers();
    try {
      fireEvent.scroll(screen.getByLabelText("DTS 源码"));
      fireEvent.click(property);
      await act(async () => { await vi.advanceTimersByTimeAsync(100); });
      expect(screen.getByRole("region", { name: "当前属性说明" })).toBeVisible();
    } finally {
      vi.useRealTimers();
    }
  });

  it("preserves a cold deep-link property when programmatic source scrolling reaches the root after the suppression window", async () => {
    const board = BOARD_STRUCTURE.nodes[0]!;
    const { onNavigate } = renderWorkbench({ syncSearch: true, canEdit: true, canEditCritical: true,
      search: "?configSet=cs-default&file=file-board&node=board&property=model&inspector=selection",
      dtsRepository: createDtsRepository({ getStructure: vi.fn(async () => ({ nodes: [
        { nodePath: "", name: "/", labels: [], properties: [], phandleRefs: [],
          source: { ...board.source!, startLine: 1, endLine: 7 } },
        { ...board, source: { ...board.source!, startLine: 4, endLine: 6 },
          properties: [{ ...board.properties[0]!, source: { ...board.properties[0]!.source!, startLine: 5, endLine: 5 } }] }
      ] })) }),
      fileRepository: createFileRepository({ downloadVersion: vi.fn(async () => ({ contentType: "text/plain", fileName: "aurora-board.dts",
        bytes: new TextEncoder().encode('/dts-v1/;\n/ {\n\n  board {\n    model = "Aurora";\n  };\n};\n') })) }) });
    const property = await screen.findByRole("treeitem", { name: "属性 board/model" });
    expect(await screen.findByRole("region", { name: "当前属性说明" })).toHaveTextContent('"Aurora"');
    const source = await screen.findByLabelText("DTS 源码");
    vi.useFakeTimers();
    try {
      await act(async () => { await vi.advanceTimersByTimeAsync(300); });
      fireEvent.scroll(source);
      await act(async () => { await vi.advanceTimersByTimeAsync(100); });
      expect(screen.getByRole("region", { name: "当前属性说明" })).toHaveTextContent('"Aurora"');
      expect(property).toHaveAttribute("aria-selected", "true");
      expect(screen.queryByRole("region", { name: "版本历史" })).not.toBeInTheDocument();
      expect(onNavigate).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows a pending source request without claiming the working file changed", async () => {
    const f = renderSourceWorkbench();
    await enterSourceEdit('/ { model = "Pending"; };'); fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
    const dialog = await screen.findByRole("dialog", { name: "保存 DTS 修改" });
    await waitFor(() => expect(f.getCandidateSourcePreview).toHaveBeenCalledOnce());
    fireEvent.change(within(dialog).getByRole("textbox", { name: "DTS 修改原因" }), { target: { value: "Update source" } });
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "提交审核" })).toBeEnabled());
    fireEvent.click(within(dialog).getByRole("button", { name: "提交审核" }));
    expect(await screen.findByText("已提交审核 · 工作配置尚未更新")).toBeInTheDocument();
    expect(f.submitCandidateSourceReview).toHaveBeenCalledWith(PROJECT.id, "source-candidate", expect.objectContaining({ reason: "Update source", assignedToUserId: "reviewer", expectedCurrentVersionId: "version-board-12", expectedProofToken: "source-proof" }));
    expect(screen.getByRole("link", { name: "查看提交记录" })).toHaveAttribute("href", "/parameter-submissions?project=project-1&request=source-request");
  });

  it("recovers full-source text after remount under the same user/file scope", async () => {
    renderSourceWorkbench(); const text = '/ { model = "Recovered"; };';
    fireEvent.blur(await enterSourceEdit(text));
    await waitFor(() => expect([...sourceDrafts.records.values()].some((record) => (record.draft as { sourceText?: string } | null)?.sourceText === text)).toBe(true));
    cleanup(); renderSourceWorkbench();
    await waitFor(() => expect(screen.getByRole("textbox", { name: "DTS 源码" })).toHaveValue(text));
    expect(screen.getByRole("textbox", { name: "DTS 源码" })).toHaveAttribute("readonly");
    expect(screen.getByText("未保存修改")).toBeInTheDocument();
  });

  it("retains a stale whole-file draft and blocks saving against a newer source version", async () => {
    renderSourceWorkbench(); fireEvent.blur(await enterSourceEdit('/ { model = "Old draft"; };'));
    await waitFor(() => expect([...sourceDrafts.records.values()].some((record) => record.draft !== null)).toBe(true)); cleanup();
    const dtsRepository = createDtsRepository();
    vi.mocked(dtsRepository.listConfigSetFiles).mockResolvedValue([{ configSetId: "cs-default", fileId: "file-board", fileName: "aurora-board.dts", format: "dts", role: "base", sortOrder: 0, currentVersionId: "version-board-13", currentVersionNumber: 13 }]);
    renderSourceWorkbench({ dtsRepository });
    expect(await screen.findByText(/文件或配置版本已更新，旧草稿仍保留/)).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "DTS 源码" })).toHaveValue('/ { model = "Old draft"; };');
    expect(screen.getByRole("button", { name: "保存修改" })).toBeDisabled(); expect(screen.getByRole("button", { name: "下载草稿" })).toBeEnabled();
  });

  it("keeps an undebounced source draft when leaving and restores it on return", async () => {
    const { onNavigate } = renderSourceWorkbench();
    const input = await enterSourceEdit();
    fireEvent.change(input, { target: { value: '/ { keep = "return later"; };' } });
    fireEvent.click(screen.getByRole("button", { name: "项目清单" }));
    fireEvent.click(within(await screen.findByRole("dialog", { name: "离开配置工作台" })).getByRole("button", { name: "保留草稿并离开" }));
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith("/parameter-admin/projects"));
    cleanup();
    renderSourceWorkbench();
    await waitFor(() => expect(screen.getByRole("textbox", { name: "DTS 源码" })).toHaveValue('/ { keep = "return later"; };'));
    expect(screen.getByText("未保存修改")).toBeInTheDocument();
  });

  it("asks before leaving dirty source and resets recovery only on confirmed discard", async () => {
    const { onNavigate } = renderSourceWorkbench();
    const input = await enterSourceEdit(); const original = (input as HTMLTextAreaElement).value;
    fireEvent.change(input, { target: { value: '/ { model = "Leaving"; };' } }); fireEvent.blur(input);
    await waitFor(() => expect([...sourceDrafts.records.values()].some((record) => record.draft !== null)).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "项目清单" }));
    fireEvent.click(within(await screen.findByRole("dialog", { name: "离开配置工作台" })).getByRole("button", { name: "留在本页" }));
    expect(onNavigate).not.toHaveBeenCalledWith("/parameter-admin/projects");
    fireEvent.click(screen.getByRole("button", { name: "项目清单" }));
    fireEvent.click(within(await screen.findByRole("dialog", { name: "离开配置工作台" })).getByRole("button", { name: "丢弃并离开" }));
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith("/parameter-admin/projects"));
    cleanup();
    await act(async () => { await Promise.resolve(); });
    expect([...sourceDrafts.records.values()].map((record) => (record.draft as { sourceText: string }).sourceText)).toEqual([original]);
    renderSourceWorkbench();
    await waitFor(() => expect(screen.getByRole("textbox", { name: "DTS 源码" })).toHaveValue(original));
    expect(screen.queryByText("未保存修改")).not.toBeInTheDocument();
  });

  it("does not recreate a discarded source draft when the editor flushes an undebounced buffer during navigation unmount", async () => {
    const { onNavigate } = renderSourceWorkbench();
    const input = await enterSourceEdit(); const original = (input as HTMLTextAreaElement).value;
    fireEvent.change(input, { target: { value: '/ { undebounced = "discard me"; };' } });
    fireEvent.click(screen.getByRole("button", { name: "项目清单" }));
    fireEvent.click(within(await screen.findByRole("dialog", { name: "离开配置工作台" })).getByRole("button", { name: "丢弃并离开" }));
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith("/parameter-admin/projects"));
    cleanup();
    await act(async () => { await Promise.resolve(); });
    expect([...sourceDrafts.records.values()].map((record) => (record.draft as { sourceText: string }).sourceText)).toEqual([original]);
  });

  it("leaves without a confirmation after reverting source to the authoritative content", async () => {
    const { onNavigate } = renderSourceWorkbench(); const input = await enterSourceEdit(); const original = (input as HTMLTextAreaElement).value;
    fireEvent.change(input, { target: { value: original + "// temporary" } }); fireEvent.blur(input);
    fireEvent.change(input, { target: { value: original } }); fireEvent.blur(input);
    await waitFor(() => expect(screen.queryByText("未保存修改")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "项目清单" }));
    expect(onNavigate).toHaveBeenLastCalledWith("/parameter-admin/projects"); expect(screen.queryByRole("dialog", { name: "离开配置工作台" })).not.toBeInTheDocument();
  });

  it("restores the loaded whole file only after confirming discard", async () => {
    renderSourceWorkbench(); const input = await enterSourceEdit(); const original = (input as HTMLTextAreaElement).value;
    fireEvent.change(input, { target: { value: '/ { changed; };' } }); fireEvent.blur(input);
    fireEvent.click(screen.getByRole("button", { name: "放弃修改" }));
    const dialog = await screen.findByRole("dialog", { name: "放弃本地 DTS 修改？" }); expect(input).not.toHaveValue(original);
    fireEvent.click(within(dialog).getByRole("button", { name: "放弃修改" }));
    await waitFor(() => expect(input).toHaveValue(original)); expect(screen.getByRole("button", { name: "保存修改" })).toBeDisabled();
  });

  it.each(["version-board-12", "old-version"])("retains legacy parameter recovery without restoring typed forms (%s)", async (baseVersionId) => {
    const draftStorage = legacyDraftStorage(baseVersionId); renderSourceWorkbench({ draftStorage });
    fireEvent.click(await screen.findByRole("button", { name: "查看已有草稿" }));
    const tasks = await screen.findByRole("region", { name: "配置任务" });
    expect(within(tasks).getByRole("checkbox", { name: "board/model" })).toBeChecked();
    expect(within(tasks).getByLabelText("变更原因")).toHaveValue("Retained parameter draft");
    expect(readSessionDraftStore(draftStorage).buckets[0]?.drafts["board::model"]?.rawText).toBe('"Legacy recovered"');
    if (baseVersionId === "old-version") expect(tasks).toHaveTextContent("基线版本已变更");
    await enterSourceEdit('/ { source; };'); expect(screen.getByRole("button", { name: "保存修改" })).toBeDisabled();
    expect(screen.queryByLabelText("字符串 1")).not.toBeInTheDocument();
  });

  it("announces an empty search result and clears the search without changing the source target", async () => {
    const search = vi.fn(async () => ({ hits: [] }));
    const { onNavigate } = renderWorkbench({ search: "?configSet=cs-default&file=file-board", syncSearch: true,
      dtsRepository: createDtsRepository({ search }) });
    const input = await screen.findByRole("searchbox", { name: "统一搜索查询" });
    fireEvent.change(input, { target: { value: "missing-property" } });
    fireEvent.submit(screen.getByRole("form", { name: "统一结构搜索" }));
    expect(await screen.findByText("未找到“missing-property”")).toBeInTheDocument();
    expect(search).toHaveBeenCalledWith(PROJECT.id, { q: "missing-property" });
    expect(screen.getByRole("main", { name: /DTS 源码/ })).toHaveTextContent("aurora-board.dts");
    fireEvent.click(screen.getByRole("button", { name: "清除搜索" }));
    await waitFor(() => expect(input).toHaveValue(""));
    expect(screen.queryByText("未找到“missing-property”")).not.toBeInTheDocument();
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("allows comparing the same snapshot again after an unchanged result", async () => {
    const compareBaseline = vi.fn(async () => ({ baselineId: "baseline-seed-v1", against: "working" as const,
      members: [{ fileId: "file-board", status: "unchanged" as const,
        baselineVersionId: "version-board-12", currentVersionId: "version-board-12" }] }));
    renderWorkbench({ search: "?configSet=cs-default&file=file-board&baseline=baseline-seed-v1",
      syncSearch: true, dtsRepository: createDtsRepository({ compareBaseline }) });
    await screen.findByRole("heading", { name: "aurora-board.dts" });
    await openWorkbenchReleaseDetails();
    const compare = screen.getByRole("button", { name: "对比当前配置" });
    await waitFor(() => expect(compare).toBeEnabled());
    fireEvent.click(compare);
    await screen.findByText("文件版本一致，无需查看差异。");
    await waitFor(() => expect(compare).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "关闭配置版本" }));
    await openWorkbenchReleaseDetails();
    fireEvent.click(screen.getByRole("button", { name: "对比当前配置" }));
    await waitFor(() => expect(compareBaseline).toHaveBeenCalledTimes(2));
  });

  it("keeps baseline results in release details and clears the comparison from its single source exit before comparing again", async () => {
    const compareBaseline = vi.fn(async () => ({ baselineId: "baseline-seed-v1", against: "working" as const,
      members: [{ fileId: "file-board", status: "version_changed" as const,
        baselineVersionId: "version-board-11", currentVersionId: "version-board-12" }] }));
    const { onNavigate } = renderWorkbench({ search: "?configSet=cs-default&file=file-board&node=board&property=model&baseline=baseline-seed-v1",
      syncSearch: true, dtsRepository: createDtsRepository({ compareBaseline, getStructure: vi.fn(async () => BOARD_STRUCTURE) }) });
    const selectedProperty = await screen.findByRole("treeitem", { name: "属性 board/model" });
    await waitFor(() => expect(selectedProperty).toHaveAttribute("aria-selected", "true"));
    fireEvent.click(screen.getByRole("button", { name: /^配置版本/ }));
    const compare = await screen.findByRole("button", { name: "对比当前配置" });
    expect(screen.queryByRole("button", { name: /对比已发布/ })).not.toBeInTheDocument();
    await waitFor(() => expect(compare).toBeEnabled());
    fireEvent.click(compare);
    await screen.findByLabelText("统一差异对比");
    expect(screen.queryByRole("dialog", { name: "配置版本" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^配置版本/ })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("button", { name: /^配置版本/ }));
    const releasePanel = await screen.findByRole("dialog", { name: "配置版本" });
    expect(releasePanel).toHaveTextContent("配置版本");
    expect(within(releasePanel).getByLabelText("配置版本对比结果")).toBeVisible();
    expect(within(releasePanel).queryByRole("button", { name: "退出对比" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^配置版本/ })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(releasePanel).getByRole("button", { name: "关闭配置版本" }));
    const region = screen.getByRole("main", { name: /DTS 源码/ });
    expect(screen.getAllByRole("button", { name: "退出对比" })).toHaveLength(1);
    fireEvent.click(within(region).getByRole("button", { name: "退出对比" }));
    await waitFor(() => expect(screen.queryByLabelText("配置版本对比结果")).not.toBeInTheDocument());
    expect(screen.queryByLabelText("统一差异对比")).not.toBeInTheDocument();
    await waitFor(() => {
      const returned = new URLSearchParams(String(onNavigate.mock.calls.at(-1)?.[0]).split("?")[1]);
      expect(returned.get("file")).toBe("file-board");
      expect(returned.get("node")).toBe("board");
      expect(returned.get("property")).toBe("model");
      expect(returned.get("sourceMode")).toBeNull();
      expect(returned.get("inspector")).toBe("release");
      expect(selectedProperty).toHaveAttribute("aria-selected", "true");
    });
    fireEvent.click(screen.getByRole("button", { name: /^配置版本/ }));
    const restart = await screen.findByRole("button", { name: "对比当前配置" });
    await waitFor(() => expect(restart).toBeEnabled());
    fireEvent.click(restart);
    await waitFor(() => expect(compareBaseline).toHaveBeenCalledTimes(2));
  });

  it("loads nested structure under the selected member and focuses source spans from tree selection", async () => {
    const getStructure = vi.fn(async () => ({
      nodes: [
        {
          nodePath: "board",
          name: "board",
          labels: ["board"],
          properties: [
            {
              name: "model",
              valueType: "string-list" as const,
              rawText: '"Aurora"',
              normalizedValue: "Aurora",
              source: {
                startOffset: 20,
                endOffset: 28,
                startLine: 2,
                startColumn: 3,
                endLine: 2,
                endColumn: 11
              }
            }
          ],
          phandleRefs: [],
          source: {
            startOffset: 10,
            endOffset: 40,
            startLine: 1,
            startColumn: 1,
            endLine: 3,
            endColumn: 2
          }
        }
      ]
    }));
    const onNavigate = vi.fn();
    renderWorkbench({
      onNavigate,
      dtsRepository: createDtsRepository({ getStructure })
    });

    expect(await screen.findByRole("heading", { name: "aurora-board.dts" })).toBeInTheDocument();
    await waitFor(() => expect(getStructure).toHaveBeenCalledWith(PROJECT.id, "file-board", "version-board-12"));
    fireEvent.click(await screen.findByRole("treeitem", { name: "节点 board" }));
    await waitFor(() =>
      expect(onNavigate.mock.calls.some((call) => String(call[0]).includes("node=board"))).toBe(true)
    );
    fireEvent.click(await screen.findByRole("treeitem", { name: "属性 board/model" }));
    await waitFor(() =>
      expect(onNavigate.mock.calls.some((call) => String(call[0]).includes("property=model"))).toBe(true)
    );
    await waitFor(() =>
      expect(document.querySelector('[data-focused="true"]')).not.toBeNull()
    );
  });

  it("groups unified search hits by file and navigates across members while preserving config set", async () => {
    const search = vi.fn(async () => ({
      hits: [
        {
          fileId: "file-overlay",
          fileName: "charging-overlay.dtsi",
          versionId: "version-overlay-4",
          nodePath: "charger",
          snippet: "charger",
          source: {
            startOffset: 1,
            endOffset: 8,
            startLine: 1,
            startColumn: 1,
            endLine: 1,
            endColumn: 8
          }
        },
        {
          fileId: "file-board",
          fileName: "aurora-board.dts",
          versionId: "version-board-12",
          nodePath: "board",
          propertyName: "model",
          snippet: "model=Aurora",
          source: {
            startOffset: 20,
            endOffset: 28,
            startLine: 2,
            startColumn: 3,
            endLine: 2,
            endColumn: 11
          }
        }
      ]
    }));
    const onNavigate = vi.fn();
    renderWorkbench({
      onNavigate,
      dtsRepository: createDtsRepository({ search })
    });
    await screen.findByRole("heading", { name: "aurora-board.dts" });

    fireEvent.change(screen.getByRole("searchbox", { name: "统一搜索查询" }), {
      target: { value: "board" }
    });
    fireEvent.submit(screen.getByRole("form", { name: "统一结构搜索" }));

    const results = await screen.findByLabelText("搜索结果");
    expect(results).toHaveTextContent("charging-overlay.dtsi");
    expect(results).toHaveTextContent("aurora-board.dts");
    await waitFor(() => expect(search).toHaveBeenCalledWith(PROJECT.id, { q: "board" }));

    fireEvent.click(screen.getByRole("button", { name: /charger/ }));
    await waitFor(() => {
      const urls = onNavigate.mock.calls.map((call) => String(call[0]));
      expect(urls.some((url) => url.includes("configSet=cs-default") && url.includes("file=file-overlay") && url.includes("node=charger"))).toBe(true);
    });
  });

  it.each(["history", "candidate"])("opens a cross-file search hit in working mode without reusing the previous %s version or candidate", async (mode) => {
    const downloadVersion = vi.fn<ParameterFileRepository["downloadVersion"]>(async (_projectId, fileId, versionId) => {
      if (fileId === "file-overlay" && versionId !== "version-overlay-4") throw new Error("Version belongs to the previous file");
      const value = fileId === "file-overlay" ? "B-working-source" : versionId === "version-board-11" ? "A-history-source" : "A-working-source";
      return { contentType: "text/plain", fileName: fileId === "file-overlay" ? "charging-overlay.dtsi" : "aurora-board.dts",
        bytes: new TextEncoder().encode(`/dts-v1/;\n/ { model = "${value}"; };\n`) };
    });
    const search = vi.fn<DtsStructuredRepository["search"]>(async () => ({ hits: [{
      fileId: "file-overlay", fileName: "charging-overlay.dtsi", versionId: "version-overlay-4", nodePath: "charger", propertyName: "status",
      snippet: "charger/status", source: { startOffset: 0, endOffset: 7, startLine: 2, startColumn: 1, endLine: 2, endColumn: 8 }
    }] }));
    const getStructure = vi.fn<DtsStructuredRepository["getStructure"]>(async (_projectId, fileId) => fileId === "file-overlay"
      ? { nodes: [{ nodePath: "charger", name: "charger", labels: [], phandleRefs: [],
          properties: [{ name: "status", valueType: "string-list", rawText: '"okay"', normalizedValue: "okay" }] }] }
      : BOARD_STRUCTURE);
    const { onNavigate } = renderWorkbench({ syncSearch: true,
      search: `?configSet=cs-default&file=file-board&sourceMode=${mode}&version=version-board-11&candidate=cand-board`,
      dtsRepository: createDtsRepository({ search, getStructure }), fileRepository: createFileRepository({ downloadVersion,
        getCandidate: vi.fn(async () => ({ id: "cand-board", projectId: PROJECT.id, fileId: "file-board", fileName: "aurora-board.dts",
          format: "dts" as const, status: "ready" as const, baseVersionId: "version-board-12", diagnostics: [], blockers: [],
          impact: { textDiff: "", structuralDiff: [], diagnostics: [], blockers: [], conflicts: [] },
          createdAt: "2026-10-17T00:00:00.000Z", updatedAt: "2026-10-17T00:00:00.000Z" })),
        getCandidateSourcePreview: vi.fn(async () => ({ kind: "legacy" as const, candidateId: "cand-board", fileId: "file-board", format: "dts", canSubmit: false })),
        downloadCandidate: vi.fn(async () => ({ contentType: "text/plain", fileName: "aurora-board.dts",
          bytes: new TextEncoder().encode('/dts-v1/;\n/ { model = "A-candidate-source"; };\n') }))
      }) });
    await waitFor(() => expect(screen.getByRole("main", { name: /DTS 源码/ }))
      .toHaveTextContent(mode === "history" ? "A-history-source" : "A-candidate-source"));
    fireEvent.change(screen.getByRole("searchbox", { name: "统一搜索查询" }), { target: { value: "charger" } });
    fireEvent.submit(screen.getByRole("form", { name: "统一结构搜索" }));
    const results = await screen.findByLabelText("搜索结果");
    fireEvent.click(within(results).getByRole("button", { name: /charger/ }));
    await waitFor(() => expect(screen.getByRole("main", { name: /DTS 源码/ })).toHaveTextContent("B-working-source"));
    const selected = new URLSearchParams(String(onNavigate.mock.calls.at(-1)?.[0]).split("?")[1]);
    expect(selected.get("configSet")).toBe("cs-default");
    expect(selected.get("file")).toBe("file-overlay");
    expect(selected.get("node")).toBe("charger");
    expect(selected.get("property")).toBe("status");
    for (const key of ["sourceMode", "version", "candidate"]) expect(selected.has(key)).toBe(false);
    expect(screen.getByRole("main", { name: /DTS 源码/ })).toHaveTextContent(/工作配置.*v4/);
    expect(downloadVersion).toHaveBeenCalledWith(PROJECT.id, "file-overlay", "version-overlay-4");
    expect(downloadVersion).not.toHaveBeenCalledWith(PROJECT.id, "file-overlay", "version-board-11");
  });

  it("restores node and property deep links from the URL", async () => {
    const getStructure = vi.fn(async () => ({
      nodes: [
        {
          nodePath: "board",
          name: "board",
          labels: [],
          properties: [
            {
              name: "model",
              valueType: "string-list" as const,
              rawText: '"Aurora"',
              normalizedValue: "Aurora",
              source: {
                startOffset: 20,
                endOffset: 28,
                startLine: 2,
                startColumn: 3,
                endLine: 2,
                endColumn: 11
              }
            }
          ],
          phandleRefs: [],
          source: {
            startOffset: 10,
            endOffset: 40,
            startLine: 1,
            startColumn: 1,
            endLine: 3,
            endColumn: 2
          }
        }
      ]
    }));
    renderWorkbench({
      search: "?configSet=cs-default&file=file-board&node=board&property=model&sourceMode=structured",
      dtsRepository: createDtsRepository({ getStructure })
    });
    const propertyItem = await screen.findByRole("treeitem", { name: "属性 board/model" });
    await waitFor(() => expect(propertyItem).toHaveAttribute("aria-selected", "true"));
    expect(screen.queryByRole("complementary", { name: "配置检查器" })).not.toBeInTheDocument();
    await ensureInspectorOpen();
    expect(await screen.findByText("属性与来源详情")).toBeInTheDocument();
    const inspector = screen.getByRole("complementary", { name: "配置检查器" });
    expect(inspector).toHaveTextContent("model");
    expect(inspector).toHaveTextContent("字符串列表");
  });

  it("retries only the structure tree when structure loading fails", async () => {
    const getStructure = vi
      .fn()
      .mockRejectedValueOnce(new Error("structure unavailable"))
      .mockResolvedValueOnce({
        nodes: [
          {
            nodePath: "board",
            name: "board",
            labels: [],
            properties: [],
            phandleRefs: [],
            source: {
              startOffset: 1,
              endOffset: 5,
              startLine: 1,
              startColumn: 1,
              endLine: 1,
              endColumn: 5
            }
          }
        ]
      });
    renderWorkbench({ dtsRepository: createDtsRepository({ getStructure }) });
    expect(await screen.findByText("结构树加载失败。")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "aurora-board.dts" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重试结构树" }));
    expect(await screen.findByRole("treeitem", { name: "节点 board" })).toBeInTheDocument();
    expect(getStructure).toHaveBeenCalledTimes(2);
  });

  it("uses Alt keyboard helpers for search focus and next match without requiring meta/ctrl", async () => {
    renderWorkbench();
    await screen.findByRole("heading", { name: "aurora-board.dts" });
    const search = screen.getByRole("searchbox", { name: "统一搜索查询" });
    fireEvent.keyDown(window, { key: "f", altKey: true });
    expect(search).toHaveFocus();
    fireEvent.change(search, { target: { value: "Aurora" } });
    fireEvent.submit(screen.getByRole("form", { name: "统一结构搜索" }));
    fireEvent.keyDown(window, { key: "n", altKey: true });
    // Next-match token is accepted without throwing; browser shortcuts remain untouched for ctrl/meta.
    fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    expect(search).toHaveFocus();
  });

  it("keeps version evidence in one disclosure and omits empty node context without changing legacy file identity", async () => {
    const { onNavigate } = renderWorkbench({ syncSearch: true, search: "?configSet=cs-default&file=file-board&inspector=file",
      dtsRepository: createDtsRepository({ getStructure: vi.fn(async () => BOARD_STRUCTURE) }),
      fileRepository: createFileRepository({ listVersions: vi.fn(async () => [ACTIVE_BOARD_VERSION]) }) });
    const inspector = await screen.findByRole("complementary", { name: "配置检查器" });
    const versions = await within(inspector).findByRole("region", { name: "版本历史" });
    expect(within(versions).getByLabelText("文件信息")).toBeVisible();
    expect(within(versions).getByText("DTS", { exact: true })).toBeVisible();
    expect(within(versions).getByText("来源一致性", { exact: true })).toBeVisible();
    expect(within(inspector).queryByText("文件用途", { exact: true })).not.toBeInTheDocument();
    expect(inspector.querySelector(".configuration-workbench__region-head")).not.toHaveTextContent("默认配置");
    expect(within(inspector).queryByText("版本身份", { exact: true })).not.toBeInTheDocument();
    expect(within(inspector).queryByText("版本标识", { exact: true })).not.toBeInTheDocument();
    expect(within(inspector).getAllByText("溯源信息", { exact: true })).toHaveLength(1);
    expect(within(inspector).queryByLabelText("完整溯源数据")).not.toBeInTheDocument();
    fireEvent.click(within(versions).getByText("溯源信息", { exact: true }));
    const evidence = await within(versions).findByLabelText("完整溯源数据");
    expect(evidence).toHaveTextContent("version-board-12");
    expect(evidence).toHaveTextContent('"checksum": "abc"');
    expect(within(versions).getAllByRole("button", { name: "复制完整技术数据" })).toHaveLength(1);
    expect(onNavigate).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("treeitem", { name: "节点 regulator" }));
    await waitFor(() => expect(within(inspector).getByText("节点路径", { exact: true })).toBeVisible());
    expect(within(inspector).queryByText("节点标签", { exact: true })).not.toBeInTheDocument();
    expect(within(inspector).queryByText("compatible", { exact: true })).not.toBeInTheDocument();
    expect(within(inspector).queryByText("读权限", { exact: true })).not.toBeInTheDocument();
    expect(within(inspector).queryByText("只读", { exact: true })).not.toBeInTheDocument();
  });

  it("keeps candidate diagnostics visible and complete raw evidence in one disclosure when source preview is unavailable", async () => {
    const candidate = { id: "cand-diagnostics", projectId: PROJECT.id, fileId: "file-board", fileName: "aurora-board.dts",
      format: "dts" as const, status: "blocked" as const, baseVersionId: "version-board-12",
      diagnostics: [{ code: "parse-context", severity: "warning" as const, message: "核对第 7 行的参数类型", line: 7 }],
      blockers: [{ code: "open-conflict", message: "请先处理来源冲突" }],
      impact: { conflicts: [{ id: "conflict-source-raw", parameterName: "model", status: "open", fileValue: "File", uiDraftValue: "UI" }] },
      createdAt: "2026-08-07T00:00:00.000Z", updatedAt: "2026-08-07T00:00:00.000Z" };
    renderWorkbench({ search: "?configSet=cs-default&file=file-board&sourceMode=candidate&candidate=cand-diagnostics&inspector=candidates",
      fileRepository: createFileRepository({ getCandidate: vi.fn(async () => candidate),
        getCandidateSourcePreview: vi.fn(async () => { throw new Error("preview unavailable"); }),
        downloadCandidate: vi.fn(async () => ({ contentType: "text/plain", fileName: candidate.fileName, bytes: new TextEncoder().encode("/dts-v1/;\n/ {};\n") })) }) });
    const inspector = await screen.findByRole("complementary", { name: "配置检查器" });
    expect(await within(inspector).findByText("来源状态未知，激活与来源审核均已禁用。")).toBeVisible();
    expect(within(inspector).getByText("核对第 7 行的参数类型", { exact: true })).toBeVisible();
    expect(within(inspector).getByText("请先处理来源冲突", { exact: true })).toBeVisible();
    expect(within(inspector).queryByText("诊断详情", { exact: true })).not.toBeInTheDocument();
    expect(within(inspector).queryByText("冲突标识", { exact: true })).not.toBeInTheDocument();
    expect(within(inspector).getAllByText("溯源信息", { exact: true })).toHaveLength(1);
    expect(within(inspector).queryByLabelText("完整溯源数据")).not.toBeInTheDocument();
    fireEvent.click(within(inspector).getByText("溯源信息", { exact: true }));
    const evidence = await within(inspector).findByLabelText("完整溯源数据");
    for (const raw of ["parse-context", "conflict-source-raw", '"line": 7', '"fileValue": "File"']) expect(evidence).toHaveTextContent(raw);
    expect(within(inspector).getAllByRole("button", { name: "复制完整技术数据" })).toHaveLength(1);
    expect(within(inspector).queryByTestId("activate-candidate")).not.toBeInTheDocument();
  });

  it("opens inspector content for config set, file, node, and property without changing source identity unexpectedly", async () => {
    const getStructure = vi.fn(async () => ({
      nodes: [
        {
          nodePath: "board",
          name: "board",
          labels: ["board_label"],
          compatible: "wiseeff,aurora",
          status: "okay",
          properties: [
            {
              name: "model",
              valueType: "string-list" as const,
              rawText: '"Aurora"',
              normalizedValue: "Aurora",
              source: {
                startOffset: 20,
                endOffset: 28,
                startLine: 2,
                startColumn: 3,
                endLine: 2,
                endColumn: 11
              }
            }
          ],
          phandleRefs: [],
          source: {
            startOffset: 10,
            endOffset: 40,
            startLine: 1,
            startColumn: 1,
            endLine: 3,
            endColumn: 2
          }
        }
      ]
    }));
    const listVersions = vi.fn(async () => [
      {
        id: "version-board-12",
        fileId: "file-board",
        versionNumber: 12,
        checksum: "abc",
        sizeBytes: 32,
        parsedIndex: {},
        origin: "upload" as const,
        createdAt: "2026-08-06T08:00:00.000Z",
        createdByUserId: "user-admin"
      },
      {
        id: "version-board-11",
        fileId: "file-board",
        versionNumber: 11,
        checksum: "def",
        sizeBytes: 30,
        parsedIndex: {},
        origin: "writeback" as const,
        createdAt: "2026-08-05T08:00:00.000Z",
        createdByUserId: "user-ops"
      }
    ]);
    const { onNavigate } = renderWorkbench({
      dtsRepository: createDtsRepository({ getStructure }),
      fileRepository: createFileRepository({ listVersions }),
      syncSearch: true
    });
    await screen.findByRole("heading", { name: "aurora-board.dts" });

    await ensureInspectorOpen();
    const inspector = screen.getByRole("complementary", { name: "配置检查器" });
    expect(inspector).toHaveTextContent("aurora-board.dts");
    expect(inspector).not.toHaveTextContent("候选文件版本");
    expect(inspector).not.toHaveTextContent("配置版本");
    expect(within(inspector).getByRole("button", { name: "关闭检查器" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("treeitem", { name: /aurora-board\.dts/ }));
    expect(await screen.findByText("文件格式")).toBeInTheDocument();
    expect(screen.getByText("DTS", { exact: true })).toBeInTheDocument();
    expect(within(inspector).getByRole("region", { name: "版本历史" })).toBeInTheDocument();
    expect(screen.getByText(/版本 11/)).toBeInTheDocument();
    expect(listVersions).toHaveBeenCalledWith(PROJECT.id, "file-board");

    fireEvent.click(await screen.findByRole("treeitem", { name: "节点 board" }));
    expect(await screen.findByText("节点路径")).toBeInTheDocument();
    expect(screen.getByText("board_label")).toBeInTheDocument();
    expect(screen.getByText("wiseeff,aurora")).toBeInTheDocument();
    expect(inspector).not.toHaveTextContent("偏高");
    expect(within(inspector).queryByText("只读", { exact: true })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("treeitem", { name: "属性 board/model" }));
    expect(await screen.findByText("属性与来源详情")).toBeInTheDocument();
    expect(within(inspector).getByText("字符串列表")).toBeInTheDocument();
    expect(within(inspector).getAllByText('"Aurora"').length).toBeGreaterThanOrEqual(1);
    expect(within(inspector).getByRole("region", { name: "当前属性说明" })).toHaveTextContent('"Aurora"');
    expect(within(inspector).getByRole("region", { name: "当前属性说明" })).toBeVisible();
    expect(within(inspector).getByText("属性与来源详情").closest("details")).not.toHaveAttribute("open");
    expect(within(inspector).getByText(/L2:3/)).toBeInTheDocument();

    const sourceHeading = screen.getByRole("heading", { name: "aurora-board.dts" });
    expect(sourceHeading).toBeInTheDocument();
    expect(onNavigate.mock.calls.at(-1)?.[0]).toContain("file=file-board");
  });

  it("shows operator display names and restores a historical version after confirmation", async () => {
    const listVersions = vi.fn(async () => [
      {
        id: "version-board-12",
        fileId: "file-board",
        versionNumber: 12,
        checksum: "abc",
        sizeBytes: 32,
        parsedIndex: {},
        origin: "upload" as const,
        createdAt: "2026-08-06T08:00:00.000Z",
        createdByUserId: "user-admin",
        createdByDisplayName: "Xu Yun"
      },
      {
        id: "version-board-11",
        fileId: "file-board",
        versionNumber: 11,
        checksum: "def",
        sizeBytes: 30,
        parsedIndex: {},
        origin: "writeback" as const,
        createdAt: "2026-08-05T08:00:00.000Z",
        createdByUserId: null,
        createdByDisplayName: null
      }
    ]);
    const rollbackVersion = vi.fn(async () => ({
      item: {
        id: "version-board-13",
        fileId: "file-board",
        versionNumber: 13,
        checksum: "def",
        sizeBytes: 30,
        parsedIndex: {},
        origin: "rollback" as const,
        createdAt: "2026-08-17T10:00:00.000Z",
        createdByUserId: "user-admin",
        createdByDisplayName: "Xu Yun"
      },
      file: {
        id: "file-board",
        projectId: PROJECT.id,
        fileName: "aurora-board.dts",
        format: "dts" as const,
        enabled: true,
        currentVersionId: "version-board-13",
        currentVersionNumber: 13,
        updatedAt: "2026-08-17T10:00:00.000Z"
      }
    }));
    renderWorkbench({
      fileRepository: createFileRepository({ listVersions, rollbackVersion })
    });
    await screen.findByRole("heading", { name: "aurora-board.dts" });
    await openWorkbenchVersionDetails();
    expect(await screen.findByLabelText("版本历史")).toBeInTheDocument();
    expect(screen.getByText("操作人：Xu Yun")).toBeInTheDocument();
    expect(screen.getByText("操作人：用户已注销或未记录")).toBeInTheDocument();
    expect(screen.queryByText("user-ops")).not.toBeInTheDocument();
    await openVersionMenu(12);
    expect(screen.queryByRole("menuitem", { name: "将版本 12 恢复为当前" })).not.toBeInTheDocument();
    await userEvent.keyboard("{Escape}");

    await openVersionMenu(11);
    await userEvent.click(screen.getByRole("menuitem", { name: "将版本 11 恢复为当前" }));
    expect(await screen.findByRole("heading", { name: "恢复为当前版本" })).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toHaveTextContent("历史版本全部保留，不会倒带");
    fireEvent.click(screen.getByRole("button", { name: "恢复为当前" }));
    await waitFor(() =>
      expect(rollbackVersion).toHaveBeenCalledWith(PROJECT.id, "file-board", "version-board-11")
    );
  });

  it("hides restore-as-current when the viewer cannot administer the workbench", async () => {
    const listVersions = vi.fn(async () => [
      {
        id: "version-board-12",
        fileId: "file-board",
        versionNumber: 12,
        checksum: "abc",
        sizeBytes: 32,
        parsedIndex: {},
        origin: "upload" as const,
        createdAt: "2026-08-06T08:00:00.000Z",
        createdByDisplayName: "Xu Yun"
      },
      {
        id: "version-board-11",
        fileId: "file-board",
        versionNumber: 11,
        checksum: "def",
        sizeBytes: 30,
        parsedIndex: {},
        origin: "writeback" as const,
        createdAt: "2026-08-05T08:00:00.000Z",
        createdByDisplayName: "Riley Chen"
      }
    ]);
    renderWorkbench({
      canAdmin: false,
      fileRepository: createFileRepository({ listVersions })
    });
    await screen.findByRole("heading", { name: "aurora-board.dts" });
    await openWorkbenchVersionDetails();
    expect(await screen.findByLabelText("版本历史")).toBeInTheDocument();
    expect(screen.getByText("操作人：Riley Chen")).toBeInTheDocument();
    await openVersionMenu(11);
    expect(screen.queryByRole("menuitem", { name: "将版本 11 恢复为当前" })).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "下载版本 11" })).toBeEnabled();
  });

  it("updates inspector level from tree selection while preserving source selection", async () => {
    const getStructure = vi.fn(async () => ({
      nodes: [
        {
          nodePath: "board",
          name: "board",
          labels: [],
          properties: [
            {
              name: "model",
              valueType: "string-list" as const,
              rawText: '"Aurora"',
              normalizedValue: "Aurora",
              source: {
                startOffset: 20,
                endOffset: 28,
                startLine: 2,
                startColumn: 3,
                endLine: 2,
                endColumn: 11
              }
            }
          ],
          phandleRefs: [],
          source: {
            startOffset: 10,
            endOffset: 40,
            startLine: 1,
            startColumn: 1,
            endLine: 3,
            endColumn: 2
          }
        }
      ]
    }));
    const { onNavigate } = renderWorkbench({
      search: "?configSet=cs-default&file=file-board&node=board&property=model",
      dtsRepository: createDtsRepository({ getStructure }),
      syncSearch: true
    });
    await screen.findByRole("treeitem", { name: "属性 board/model" });
    expect(screen.queryByRole("complementary", { name: "配置检查器" })).not.toBeInTheDocument();
    await ensureInspectorOpen();
    expect(await screen.findByText("属性与来源详情")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "关闭检查器" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("treeitem", { name: "节点 board" }));
    await waitFor(() => expect(screen.getByText("节点路径")).toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "aurora-board.dts" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("treeitem", { name: /aurora-board\.dts/ }));
    await waitFor(() => expect(screen.queryByText("文件格式"), JSON.stringify({
      urls: onNavigate.mock.calls.map((call) => call[0]),
      inspector: screen.queryByRole("complementary", { name: "配置检查器" })?.textContent
    })).toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "aurora-board.dts" })).toBeInTheDocument();
    const urls = onNavigate.mock.calls.map((call) => String(call[0]));
    expect(urls.some((url) => url.includes("file=file-board") && !url.includes("node="))).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "关闭检查器" }));
    await waitFor(() =>
      expect(screen.queryByRole("complementary", { name: "配置检查器" })).not.toBeInTheDocument()
    );
  });

  it.each(["source", "structure"])("opens historical source from %s, downloads it, and restores the working target", async (tab) => {
    const downloadVersion = vi.fn(async (_projectId: string, _fileId: string, versionId: string) => ({
      contentType: "text/plain",
      fileName: "aurora-board.dts",
      bytes: new TextEncoder().encode(
        versionId === "version-board-11"
          ? `/dts-v1/;\n/ { model = "Legacy"; /* ${versionId} */ };\n`
          : `/dts-v1/;\n/ { model = "Aurora"; /* ${versionId} */ };\n`
      )
    }));
    const listVersions = vi.fn(async () => [
      {
        id: "version-board-12",
        fileId: "file-board",
        versionNumber: 12,
        checksum: "abc",
        sizeBytes: 32,
        parsedIndex: {},
        origin: "upload" as const,
        createdAt: "2026-08-06T08:00:00.000Z",
        createdByUserId: "user-admin"
      },
      {
        id: "version-board-11",
        fileId: "file-board",
        versionNumber: 11,
        checksum: "def",
        sizeBytes: 30,
        parsedIndex: {},
        origin: "writeback" as const,
        createdAt: "2026-08-05T08:00:00.000Z",
        createdByUserId: "user-ops"
      }
    ]);
    const { onNavigate } = renderWorkbench({
      fileRepository: createFileRepository({ downloadVersion, listVersions }),
      syncSearch: true,
      search: `?tab=${tab}`
    });
    if (tab === "source") await screen.findByText(/model = "Aurora"/);
    else await screen.findByRole("treeitem", { name: /aurora-board\.dts/ });
    await openWorkbenchVersionDetails();
    expect(await screen.findByLabelText("版本历史")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "查看版本 11 历史源码" }));
    await waitFor(() => {
      const urls = onNavigate.mock.calls.map((call) => String(call[0]));
      expect(urls.some((url) => url.includes("sourceMode=history") && url.includes("version=version-board-11"))).toBe(
        true
      );
    });
    expect(await screen.findByText(/历史版本 · 只读/)).toBeInTheDocument();
    expect(await screen.findByText(/model = "Legacy"/)).toBeInTheDocument();

    await openVersionMenu(11);
    await userEvent.click(screen.getByRole("menuitem", { name: "下载版本 11" }));
    await waitFor(() =>
      expect(downloadVersion).toHaveBeenCalledWith(PROJECT.id, "file-board", "version-board-11")
    );

    fireEvent.click(screen.getByRole("button", { name: "退出历史源码" }));
    await waitFor(() => {
      const urls = onNavigate.mock.calls.map((call) => String(call[0]));
      expect(urls.some((url) => url.includes("file=file-board") && !url.includes("sourceMode=history"))).toBe(true);
    });
    expect(await screen.findByText(/model = "Aurora"/)).toBeInTheDocument();
  });

  it("compares historical source through one diff action and restores working source afterward", async () => {
    const downloadVersion = vi.fn(async (_projectId: string, _fileId: string, versionId: string) => ({
      contentType: "text/plain",
      fileName: "aurora-board.dts",
      bytes: new TextEncoder().encode(
        versionId === "version-board-11"
          ? `/dts-v1/;\n/ { model = "Legacy"; };\n`
          : `/dts-v1/;\n/ { model = "Aurora"; };\n`
      )
    }));
    const listVersions = vi.fn(async () => [
      {
        id: "version-board-12",
        fileId: "file-board",
        versionNumber: 12,
        checksum: "abc",
        sizeBytes: 32,
        parsedIndex: {},
        origin: "upload" as const,
        createdAt: "2026-08-06T08:00:00.000Z"
      },
      {
        id: "version-board-11",
        fileId: "file-board",
        versionNumber: 11,
        checksum: "def",
        sizeBytes: 30,
        parsedIndex: {},
        origin: "writeback" as const,
        createdAt: "2026-08-05T08:00:00.000Z"
      }
    ]);
    const { onNavigate } = renderWorkbench({
      search: "?configSet=cs-default&file=file-board",
      fileRepository: createFileRepository({ downloadVersion, listVersions }),
      syncSearch: true
    });
    await screen.findByRole("heading", { name: "aurora-board.dts" });
    await openWorkbenchVersionDetails();
    fireEvent.click(screen.getByRole("button", { name: "查看版本 11 历史源码" }));
    expect(await screen.findByText(/历史版本 · 只读/)).toBeInTheDocument();
    expect(await screen.findByText(/model = "Legacy"/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "对比" }));
    await waitFor(() => expect(screen.getByLabelText("统一差异对比")).toHaveTextContent("Legacy"));
    expect(screen.getByRole("main", { name: /DTS 源码/ })).toHaveTextContent("只读对比");
    expect(screen.getByLabelText("统一差异对比")).toHaveTextContent("Legacy");

    for (const name of ["对比", "统一差异", "并排对比"]) expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("并排差异对比")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "退出对比" })).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "退出对比" }));
    await waitFor(() =>
      expect(
        onNavigate.mock.calls.some(
          (call) => String(call[0]).includes("file=file-board") && !String(call[0]).includes("sourceMode=")
        )
      ).toBe(true)
    );
  });

  it("maps an old side-by-side URL to the single read-only diff and restores its exact working target on exit", async () => {
    const { onNavigate } = renderWorkbench({ syncSearch: true,
      search: "?configSet=cs-default&file=file-board&node=board&property=model&sourceMode=side-by-side&version=version-board-11",
      dtsRepository: createDtsRepository({ getStructure: vi.fn(async () => BOARD_STRUCTURE) }),
      fileRepository: createFileRepository({ downloadVersion: vi.fn(async (_projectId, _fileId, versionId) => ({
        contentType: "text/plain", fileName: "aurora-board.dts",
        bytes: new TextEncoder().encode(versionId === "version-board-11" ? 'model = "Legacy";' : 'model = "Aurora";')
      })) }) });
    await waitFor(() => expect(screen.getByLabelText("统一差异对比")).toHaveTextContent("Legacy"));
    const selected = await screen.findByRole("treeitem", { name: "属性 board/model" });
    await waitFor(() => expect(selected).toHaveAttribute("aria-selected", "true"));
    expect(screen.queryByLabelText("并排差异对比")).not.toBeInTheDocument();
    for (const name of ["对比", "统一差异", "并排对比"]) expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    expect(screen.getByRole("main", { name: /DTS 源码/ }).querySelector('[contenteditable="true"]')).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "退出对比" }));
    await waitFor(() => {
      const returned = new URLSearchParams(String(onNavigate.mock.calls.at(-1)?.[0]).split("?")[1]);
      expect(returned.get("file")).toBe("file-board");
      expect(returned.get("node")).toBe("board");
      expect(returned.get("property")).toBe("model");
      expect(returned.has("sourceMode")).toBe(false);
      expect(returned.has("version")).toBe(false);
    });
    expect(screen.queryByLabelText("统一差异对比")).not.toBeInTheDocument();
    expect(selected).toHaveAttribute("aria-selected", "true");
  });

  it("keeps desktop details beside source content at compact and wide PC widths", async () => {
    const originalWidth = window.innerWidth;
    renderWorkbench();
    await screen.findByRole("heading", { name: "aurora-board.dts" });
    await openWorkbenchVersionDetails();
    const inspector = screen.getByRole("complementary", { name: "配置检查器" });
    try {
      for (const width of [1280, 1440]) {
        Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
        fireEvent(window, new Event("resize"));
        await waitFor(() => expect(inspector).toHaveAttribute("data-layout", "persistent"));
        expect(screen.getByRole("main", { name: /DTS 源码/ })).toBeVisible();
      }
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
    }
  });

  it("clears history version identity when switching member files", async () => {
    const { onNavigate } = renderWorkbench({
      search: "?configSet=cs-default&file=file-board&sourceMode=history&version=version-board-11",
      syncSearch: true
    });
    await screen.findByRole("heading", { name: "aurora-board.dts" });
    fireEvent.click(await screen.findByRole("treeitem", { name: /charging-overlay\.dtsi/ }));
    await waitFor(() => {
      const urls = onNavigate.mock.calls.map((call) => String(call[0]));
      expect(
        urls.some(
          (url) =>
            url.includes("file=file-overlay") &&
            !url.includes("sourceMode=history") &&
            !url.includes("version=version-board-11")
        ), urls.join("\n")
      ).toBe(true);
    });
  });

  it("uploads a candidate, shows impact evidence, and abandons without activating", async () => {
    const candidate = {
      id: "cand-1",
      projectId: PROJECT.id,
      fileId: "file-board",
      fileName: "aurora-board.dts",
      format: "dts" as const,
      status: "ready" as const,
      baseVersionId: "version-board-12",
      diagnostics: [],
      blockers: [],
      impact: {
        textDiff: "--- active\n+++ candidate\n+model = \"Cand\";",
        structuralDiff: [{ kind: "prop_changed" as const, nodePath: "/board", prop: "model", before: "Aurora", after: "Cand" }],
        diagnostics: [],
        blockers: [],
        conflicts: [],
        coverage: {
          matchedRegistered: ["wiseeff,cand"],
          newUnregistered: [],
          matchedRegisteredCount: 1,
          newUnregisteredCount: 0
        }
      },
      createdAt: "2026-08-07T00:00:00.000Z",
      updatedAt: "2026-08-07T00:00:00.000Z"
    };
    const createCandidate = vi.fn(async () => candidate);
    const getCandidate = vi.fn(async () => candidate);
    const downloadCandidate = vi.fn(async () => ({
      contentType: "text/plain",
      fileName: "aurora-board.dts",
      bytes: new TextEncoder().encode('/dts-v1/;\n/ { model = "Cand"; };\n')
    }));
    const abandonCandidate = vi.fn(async () => ({ ...candidate, status: "abandoned" as const }));

    const { onNavigate } = renderWorkbench({
      syncSearch: true,
      fileRepository: createFileRepository({
        createCandidate,
        getCandidate,
        downloadCandidate,
        abandonCandidate
      })
    });

    await screen.findByRole("heading", { name: "aurora-board.dts" });
    await openSourceUpdates();
    fireEvent.click(screen.getByRole("button", { name: "上传新文件" }));
    const uploadInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(uploadInput).toBeTruthy();
    const file = new File(['/dts-v1/;\n/ { model = "Cand"; };\n'], "aurora-board.dts", {
      type: "text/plain"
    });
    Object.defineProperty(uploadInput, "files", {
      configurable: true,
      value: [file]
    });
    fireEvent.change(uploadInput);

    await waitFor(() => expect(createCandidate).toHaveBeenCalled());
    expect(createCandidate).toHaveBeenCalledExactlyOnceWith(PROJECT.id, expect.objectContaining({ fileId: "file-board", fileName: "aurora-board.dts" }));
    await waitFor(() =>
      expect(onNavigate.mock.calls.some((call) => String(call[0]).includes("sourceMode=candidate"))).toBe(true)
    );
    expect(await screen.findByText(/待核对 · 只读/)).toBeInTheDocument();
    expect(screen.getByText(/待核对 · 只读/)).toBeInTheDocument();
    if (!screen.queryByRole("complementary", { name: "配置检查器" })) await openSourceUpdates();
    const inspector = await screen.findByRole("complementary", { name: "配置检查器" });
    expect(inspector).toHaveTextContent("结构差异");
    expect(inspector).toHaveTextContent("覆盖");
    expect(screen.getByLabelText("来源更新差异")).toHaveTextContent('+model = "Cand";');
    fireEvent.click(screen.getByRole("button", { name: "放弃更新" }));
    await waitFor(() => expect(abandonCandidate).toHaveBeenCalledWith(PROJECT.id, "cand-1"));
  });

  it("activates a ready candidate after impact confirmation and refreshes without full reset", async () => {
    const candidate = {
      id: "cand-ready",
      projectId: PROJECT.id,
      fileId: "file-board",
      fileName: "aurora-board.dts",
      format: "dts" as const,
      status: "ready" as const,
      baseVersionId: "version-board-12",
      diagnostics: [],
      blockers: [],
      impact: {
        textDiff: "--- active\n+++ candidate\n+model = \"Act\";",
        structuralDiff: [{ kind: "prop_changed" as const, nodePath: "/board", prop: "model", before: "Aurora", after: "Act" }],
        diagnostics: [],
        blockers: [],
        conflicts: [],
        coverage: {
          matchedRegistered: ["wiseeff,cand"],
          newUnregistered: [],
          matchedRegisteredCount: 1,
          newUnregisteredCount: 0
        }
      },
      createdAt: "2026-08-07T00:00:00.000Z",
      updatedAt: "2026-08-07T00:00:00.000Z"
    };
    const activateCandidate = vi.fn<ParameterFileRepository["activateCandidate"]>(async () => ({
      item: { ...candidate, status: "active" as const, activatedVersionId: "version-board-13" },
      file: {
        id: "file-board",
        projectId: PROJECT.id,
        fileName: "aurora-board.dts",
        format: "dts" as const,
        enabled: true,
        currentVersionId: "version-board-13",
        currentVersionNumber: 13,
        updatedAt: "2026-08-07T01:00:00.000Z"
      },
      version: {
        id: "version-board-13",
        fileId: "file-board",
        versionNumber: 13,
        checksum: "act",
        sizeBytes: 32,
        parsedIndex: {},
        origin: "upload" as const,
        createdAt: "2026-08-07T01:00:00.000Z"
      }
    }));
    const getCandidate = vi.fn(async () => candidate);
    const downloadCandidate = vi.fn(async () => ({
      contentType: "text/plain",
      fileName: "aurora-board.dts",
      bytes: new TextEncoder().encode('/dts-v1/;\n/ { model = "Act"; };\n')
    }));

    const { onNavigate } = renderWorkbench({
      syncSearch: true,
      search: "?configSet=cs-default&file=file-board&sourceMode=candidate&candidate=cand-ready",
      fileRepository: createFileRepository({
        getCandidate,
        downloadCandidate,
        activateCandidate
      })
    });

    expect(await screen.findByText(/待核对 · 只读/)).toBeInTheDocument();
    await openSourceUpdates();
    const activateButton = await screen.findByTestId("activate-candidate");
    expect(activateButton).toBeEnabled();
    fireEvent.click(activateButton);
    expect(await screen.findByRole("heading", { name: "确认应用来源更新" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "确认应用" }));
    await waitFor(() =>
      expect(activateCandidate).toHaveBeenCalledWith(PROJECT.id, "cand-ready", {
        expectedCurrentVersionId: "version-board-12",
        configSetId: undefined,
        role: undefined
      })
    );
    await waitFor(() =>
      expect(onNavigate.mock.calls.some((call) => String(call[0]).includes("file=file-board"))).toBe(true)
    );
    expect(screen.queryByTestId("activate-candidate")).not.toBeInTheDocument();
  });

  it("retains batch and single-conflict forms while a sibling pending draft blocks the multi-binding batch", async () => {
    const digest = "a".repeat(64);
    const candidate = { id: "multi-conflict", projectId: PROJECT.id, fileId: "file-board", fileName: "aurora-board.dts",
      baseVersionId: ACTIVE_BOARD_VERSION.id, checksum: "b".repeat(64), format: "dts" as const, status: "ready" as const,
      diagnostics: [], blockers: [], impact: {}, createdAt: "2026-08-07", updatedAt: "2026-08-07" };
    const bindings = ["binding-a", "binding-b"].map((bindingId) => ({ bindingId, definitionId: "definition",
      baseCurrentValueId: "value", configRevisionId: "revision", sourcePinId: `pin-${bindingId}`,
      locator: `/board/${bindingId}`, baseDigest: digest, proposedDigest: candidate.checksum,
      action: "set" as const, beforeText: "<36>", afterText: "<77>" }));
    const preview: Awaited<ReturnType<ParameterFileRepository["getCandidateSourcePreview"]>> = {
      kind: "canonical", canSubmit: false, reason: "canonical-batch-review-required", candidateId: candidate.id,
      fileId: candidate.fileId, baseVersionId: candidate.baseVersionId, format: "dts", proofToken: "multi-proof",
      cohortProofToken: "workflow", proposedDigest: candidate.checksum, bindings
    };
    const fileProof: canonicalConflictClient.CanonicalSourceConflictList["items"][number]["choices"]["file"] = {
      choice: "file", candidateId: candidate.id, selectedBindingId: "binding-a", selectedDraftId: "draft-a",
      fileId: candidate.fileId, baseVersionId: candidate.baseVersionId, configSetId: "cs-default",
      sourceProofToken: "multi-proof", cohortProofToken: "workflow", sourceCandidateDigest: candidate.checksum,
      selectedSourcePinId: "pin-binding-a", selectedBaseValueId: "value", selectedRevisionId: "revision",
      selectedDraftProof: digest, selectedDraftCandidateId: "draft-candidate", selectedDraftCandidateDigest: "c".repeat(64),
      decisionProofDigest: digest, action: "set", targetText: "<77>",
      members: [{ memberId: "member", fileId: candidate.fileId, fileVersionId: candidate.baseVersionId,
        sourceName: candidate.fileName, format: "dts", role: "base", sortOrder: 0, checksum: digest, sizeBytes: 10,
        configSetId: "cs-default", isCandidateFile: true }],
      cohort: bindings.map((binding) => ({ bindingId: binding.bindingId, oldValueId: binding.baseCurrentValueId,
        sourcePinId: binding.sourcePinId, sourceOccurrenceId: `occurrence-${binding.bindingId}`, definitionId: binding.definitionId,
        effectiveRevisionId: "revision", catalogReleaseId: "release", locator: { path: binding.locator },
        valueKind: "u32-array", valueDigest: digest, configSetId: "cs-default" }))
    };
    const listCandidateSourceConflicts = vi.fn(async () => ({ items: [{ selectedBindingId: "binding-a", selectedDraftId: "draft-a",
      authorUserId: "other-author", choices: { file: fileProof, draft: { ...fileProof, choice: "draft" as const,
        targetText: "<88>", decisionProofDigest: "d".repeat(64) } } }],
      ineligible: [{ selectedBindingId: "binding-b", selectedDraftId: "draft-b", reason: "selected-draft-pending" }] }));
    const submitCandidateSourceConflict = vi.fn<ReturnType<typeof canonicalConflictClient.createCanonicalConflictClient>["submitCandidateSourceConflict"]>()
      .mockResolvedValue({ requestId: "single-conflict-request", status: "pending", replayed: false });
    vi.spyOn(canonicalConflictClient, "createCanonicalConflictClient").mockReturnValue({ listCandidateSourceConflicts, submitCandidateSourceConflict });
    const governanceClient = userGovernanceClient.createUserGovernanceClient();
    vi.spyOn(userGovernanceClient, "createUserGovernanceClient").mockReturnValue({ ...governanceClient,
      getProjectWorkflowRoleBindings: vi.fn(async () => ({ projectId: PROJECT.id, ready: true, missingRoles: [],
        bindings: [{ userId: "reviewer", name: "软件审核员", username: null, email: null, title: "", isActive: true,
          roles: ["software-committer" as const] }] })) });
    const submitBatch = vi.fn();
    const submitOrdinary = vi.fn();
    const { onNavigate } = renderWorkbench({ syncSearch: true, apiMode: true, canAdmin: true, canEdit: true,
      currentUserId: "author", search: "?configSet=cs-default&file=file-board&sourceMode=candidate&candidate=multi-conflict&inspector=candidates",
      memberRemovalRepository: { getCatalog: vi.fn(), submitProjectValueBatchChangeRequest: submitBatch } as unknown as ProjectConfigurationWorkbenchProps["memberRemovalRepository"],
      fileRepository: createFileRepository({ getCandidate: vi.fn(async () => candidate),
        getCandidateSourcePreview: vi.fn(async () => preview),
        getSourceWorkflow: vi.fn(async () => ({ canonical: true, bindingCount: 2, configSetId: "cs-default", proofToken: "workflow" })),
        downloadCandidate: vi.fn(async () => ({ contentType: "text/plain", fileName: candidate.fileName, bytes: new TextEncoder().encode("updated") })),
        submitCandidateSourceReview: submitOrdinary }) });
    await screen.findByRole("heading", { name: "提交 DTS 批量来源审核" });
    const batchDraft = await screen.findByRole("radio", { name: /采用界面草稿 1/ });
    fireEvent.click(batchDraft);
    fireEvent.change(screen.getByRole("textbox", { name: "修改原因" }), { target: { value: "整批修改原因" } });
    expect(await screen.findByText("存在不可处理的竞争草稿，不能提交；请刷新来源。")).toBeVisible();
    expect(screen.getByRole("button", { name: "提交 2 项审核" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "单独处理一项冲突" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "单独处理一项冲突" }));
    expect(await screen.findByRole("region", { name: "来源变更审核" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "提交 DTS 批量来源审核" })).not.toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "提交前批量目标" })).not.toBeInTheDocument();
    const singleDraft = await screen.findByRole("radio", { name: /保留界面草稿值/ });
    expect(singleDraft).toBeEnabled();
    fireEvent.click(singleDraft);
    fireEvent.change(screen.getByRole("textbox", { name: "修改原因" }), { target: { value: "只处理当前冲突" } });
    expect(screen.getByRole("button", { name: "提交审核" })).toBeEnabled();
    expect(screen.getAllByRole("textbox", { name: "修改原因" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "关闭检查器" }));
    await openSourceUpdates();
    expect(screen.getByRole("textbox", { name: "修改原因" })).toHaveValue("只处理当前冲突");
    expect(screen.getByRole("radio", { name: /保留界面草稿值/ })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "返回整批更新" }));
    expect(await screen.findByRole("heading", { name: "提交 DTS 批量来源审核" })).toBeVisible();
    expect(screen.queryByRole("region", { name: "来源变更审核" })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "修改原因" })).toHaveValue("整批修改原因");
    expect(screen.getByRole("radio", { name: /采用界面草稿 1/ })).toBeChecked();
    expect(screen.getByRole("button", { name: "提交 2 项审核" })).toBeDisabled();
    expect(screen.getAllByRole("textbox", { name: "修改原因" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "单独处理一项冲突" }));
    expect(screen.getByRole("textbox", { name: "修改原因" })).toHaveValue("只处理当前冲突");
    fireEvent.click(screen.getByRole("button", { name: "提交审核" }));
    await waitFor(() => expect(submitCandidateSourceConflict).toHaveBeenCalledExactlyOnceWith(PROJECT.id, candidate.id, {
      selectedBindingId: "binding-a", selectedDraftId: "draft-a", choice: "draft", expectedDecisionProofDigest: "d".repeat(64),
      assignedToUserId: "reviewer", reason: "只处理当前冲突"
    }));
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith("/parameter-submissions?project=project-1&request=single-conflict-request"));
    expect(submitBatch).not.toHaveBeenCalled();
    expect(submitOrdinary).not.toHaveBeenCalled();
  });

  it("keeps inline source review closed until conflict and reviewer checks succeed, then retains its form across reopening", async () => {
    const candidate = {
      id: "cand-single", projectId: PROJECT.id, fileId: "file-board", fileName: "aurora-board.dts",
      format: "dts" as const, status: "ready" as const, baseVersionId: "version-board-12",
      diagnostics: [], blockers: [], impact: {}, createdAt: "2026-08-07T00:00:00.000Z", updatedAt: "2026-08-07T00:00:00.000Z"
    };
    let rejectConflicts!: (error: Error) => void;
    const listCandidateSourceConflicts = vi.fn<ReturnType<typeof canonicalConflictClient.createCanonicalConflictClient>["listCandidateSourceConflicts"]>()
      .mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectConflicts = reject; }))
      .mockResolvedValue({ items: [], ineligible: [] });
    const conflictClient = canonicalConflictClient.createCanonicalConflictClient();
    vi.spyOn(canonicalConflictClient, "createCanonicalConflictClient").mockReturnValue({ ...conflictClient, listCandidateSourceConflicts });
    const governanceClient = userGovernanceClient.createUserGovernanceClient();
    const getProjectWorkflowRoleBindings = vi.fn<typeof governanceClient.getProjectWorkflowRoleBindings>(async () => ({
      projectId: PROJECT.id, ready: true, missingRoles: [], bindings: [{ userId: "reviewer-2", name: "软件审核员", username: null,
        email: null, title: "", isActive: true, roles: ["software-committer"] }]
    }));
    vi.spyOn(userGovernanceClient, "createUserGovernanceClient").mockReturnValue({ ...governanceClient, getProjectWorkflowRoleBindings });
    const submitCandidateSourceReview = vi.fn<ParameterFileRepository["submitCandidateSourceReview"]>(async () => ({ requestId: "single-request", status: "pending", replayed: false }));
    const activateCandidate = vi.fn();
    const getCandidateSourcePreview = vi.fn<ParameterFileRepository["getCandidateSourcePreview"]>(async () => ({
      kind: "canonical", candidateId: candidate.id, fileId: candidate.fileId, format: "dts", canSubmit: true,
      baseVersionId: candidate.baseVersionId, proofToken: "single-proof", before: '"Aurora"', after: '"Reviewed"',
      ...(submitCandidateSourceReview.mock.calls.length ? { request: { id: "single-request", status: "pending" as const, kind: "single" as const } } : {})
    }));
    renderWorkbench({ syncSearch: true, canAdmin: true, canEdit: true,
      search: "?configSet=cs-default&file=file-board&sourceMode=candidate&candidate=cand-single&inspector=candidates",
      fileRepository: createFileRepository({ getCandidate: vi.fn(async () => candidate), getCandidateSourcePreview,
        getSourceWorkflow: vi.fn(async () => ({ canonical: true, bindingCount: 1, configSetId: "cs-default", proofToken: "single-proof" })),
        downloadCandidate: vi.fn(async () => ({ contentType: "text/plain", fileName: candidate.fileName, bytes: new TextEncoder().encode("updated") })),
        submitCandidateSourceReview, activateCandidate }) });
    await screen.findByText("正在读取来源冲突…");
    expect(screen.queryByRole("button", { name: /^提交审核$/ })).not.toBeInTheDocument();
    expect(screen.queryByTestId("activate-candidate")).not.toBeInTheDocument();
    await act(async () => { rejectConflicts(new Error("conflict service unavailable")); });
    expect(await screen.findByRole("alert")).toHaveTextContent("加载来源冲突失败，请重新核对。");
    expect(screen.queryByRole("button", { name: /^提交审核$/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重新核对冲突" }));
    const form = await screen.findByRole("region", { name: "来源变更审核" });
    const reason = await within(form).findByRole("textbox", { name: "修改原因" });
    const submit = within(form).getByRole("button", { name: /^提交审核$/ });
    expect(submit).toBeDisabled();
    fireEvent.change(reason, { target: { value: "核对板卡来源更新" } });
    expect(submit).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "关闭检查器" }));
    await openSourceUpdates();
    expect(screen.getByRole("textbox", { name: "修改原因" })).toHaveValue("核对板卡来源更新");
    expect(screen.getByRole("combobox", { name: "指定软件审核人" })).toHaveTextContent("软件审核员");
    fireEvent.click(screen.getByRole("button", { name: /^提交审核$/ }));
    await waitFor(() => expect(submitCandidateSourceReview).toHaveBeenCalledExactlyOnceWith(PROJECT.id, candidate.id, {
      expectedCurrentVersionId: candidate.baseVersionId, expectedProofToken: "single-proof", assignedToUserId: "reviewer-2", reason: "核对板卡来源更新"
    }));
    expect(await screen.findByText("审核状态：待审核 · 单目标")).toBeVisible();
    expect(screen.queryByRole("button", { name: /^提交审核$/ })).not.toBeInTheDocument();
    expect(activateCandidate).not.toHaveBeenCalled();
    expect(listCandidateSourceConflicts).toHaveBeenCalledTimes(2);
  });

  it.each([
    { status: "pending", bulkStatus: undefined },
    { status: "approved", bulkStatus: undefined },
    { status: "approved", bulkStatus: "pending" }
  ] as const)("keeps a candidate's $status review reachable without repeat submission or mutations (bulk=$bulkStatus)", async ({ status, bulkStatus }) => {
    const candidate = {
      id: "cand-reviewed", projectId: PROJECT.id, fileId: "file-board", fileName: "aurora-board.dts",
      format: "dts" as const, status: "ready" as const, baseVersionId: "version-board-12",
      diagnostics: [], impact: { textDiff: "", structuralDiff: [], diagnostics: [], blockers: [], conflicts: [] }, blockers: [],
      createdAt: "2026-08-07T00:00:00.000Z", updatedAt: "2026-08-07T00:00:00.000Z"
    };
    const requestId = `existing-review-${status}`;
    const submitCandidateSourceReview = vi.fn();
    const activateCandidate = vi.fn();
    const abandonCandidate = vi.fn();
    const recomputeCandidate = vi.fn();
    const getCandidateSourcePreview = vi.fn<ParameterFileRepository["getCandidateSourcePreview"]>(async () => ({
      kind: "canonical", candidateId: candidate.id, fileId: candidate.fileId, format: "dts", canSubmit: true,
      baseVersionId: candidate.baseVersionId, proofToken: "proof-reviewed", before: '"Aurora"', after: '"Reviewed"',
      request: { id: requestId, status, kind: "single" }
    }));
    let finishBulk!: () => void;
    const bulkGate = new Promise<void>((resolve) => { finishBulk = resolve; });
    const listSingleReviews = vi.fn(async () => {
      await bulkGate;
      return { items: [
        { id: "stale-bulk-current", projectId: PROJECT.id, candidateId: candidate.id, status: "pending" },
        { id: "cached-other-review", projectId: PROJECT.id, candidateId: "other-update", status: "approved" }
      ] };
    });
    const { onNavigate } = renderWorkbench({
      search: "?configSet=cs-default&file=file-board&sourceMode=candidate&candidate=cand-reviewed&inspector=candidates",
      canAdmin: true, canEdit: true, canEditCritical: true,
      ...(bulkStatus ? { memberRemovalRepository: { getCatalog: vi.fn(), listProjectValueChangeRequests: listSingleReviews,
        listProjectValueBatchChangeRequests: vi.fn(async () => ({ items: [] })) } as unknown as ProjectConfigurationWorkbenchProps["memberRemovalRepository"] } : {}),
      fileRepository: createFileRepository({ getCandidate: vi.fn(async () => candidate), getCandidateSourcePreview,
        ...(bulkStatus ? { listCandidates: vi.fn(async () => [candidate, { ...candidate, id: "other-update", fileName: "other.dts" }]) } : {}),
        getSourceWorkflow: vi.fn(async () => ({ canonical: true, bindingCount: 1, configSetId: "cs-default", proofToken: "proof-reviewed" })),
        downloadCandidate: vi.fn(async () => ({ contentType: "text/plain", fileName: "aurora-board.dts", bytes: new TextEncoder().encode('/dts-v1/;\n/ { model = "Reviewed"; };\n') })),
        submitCandidateSourceReview, activateCandidate, abandonCandidate, recomputeCandidate })
    });
    const inspector = await screen.findByRole("complementary", { name: "配置检查器" });
    expect(await within(inspector).findByText(status === "pending" ? "审核状态：待审核 · 单目标" : "审核状态：已通过 · 单目标")).toBeVisible();
    expect(getCandidateSourcePreview).toHaveBeenCalledWith(PROJECT.id, candidate.id);
    if (bulkStatus) {
      const records = within(inspector).getByRole("region", { name: "候选记录" });
      expect(await within(records).findByRole("button", { name: /aurora-board\.dts.*审核通过/ })).toHaveAttribute("aria-pressed", "true");
      await act(async () => { finishBulk(); });
      expect(listSingleReviews).toHaveBeenCalledWith(PROJECT.id, { mine: true });
      expect(within(records).getByRole("button", { name: /aurora-board\.dts.*审核通过/ })).toHaveAttribute("aria-pressed", "true");
      expect(within(records).getByRole("button", { name: /other\.dts.*审核通过/ })).toHaveAttribute("aria-pressed", "false");
      expect(within(records).queryByRole("button", { name: /aurora-board\.dts.*待审核/ })).not.toBeInTheDocument();
    }
    expect(within(inspector).queryByRole("button", { name: /提交.*审核/ })).not.toBeInTheDocument();
    expect(within(inspector).queryByTestId("activate-candidate")).not.toBeInTheDocument();
    expect(within(inspector).queryByRole("button", { name: "放弃更新" })).not.toBeInTheDocument();
    expect(within(inspector).queryByRole("button", { name: "重新核对" })).not.toBeInTheDocument();
    expect(within(inspector).getByText(status === "pending"
      ? "已有待处理的来源审核，请等待审核完成后再放弃或重算候选。"
      : "来源审核已通过，候选仍保留审核关联，不能放弃或重算。")).toBeVisible();
    fireEvent.click(within(inspector).getByRole("button", { name: "查看审核" }));
    expect(onNavigate).toHaveBeenLastCalledWith(`/parameter-submissions?project=project-1&request=${requestId}`);
    for (const mutate of [submitCandidateSourceReview, activateCandidate, abandonCandidate, recomputeCandidate]) expect(mutate).not.toHaveBeenCalled();
  });

  it.each(["blocked", "failed", "abandoned", "stale"] as const)("does not offer activate for a %s candidate", async (status) => {
      const candidate = {
        id: `cand-${status}`,
        projectId: PROJECT.id,
        fileId: "file-board",
        fileName: "aurora-board.dts",
        format: "dts" as const,
        status,
        baseVersionId: "version-board-12",
        diagnostics: [],
        blockers: status === "blocked" ? [{ code: "open-conflict", message: "conflict" }] : [],
        impact: { textDiff: "", structuralDiff: [], diagnostics: [], blockers: [], conflicts: [] },
        createdAt: "2026-08-07T00:00:00.000Z",
        updatedAt: "2026-08-07T00:00:00.000Z"
      };
      renderWorkbench({
        search: `?configSet=cs-default&file=file-board&sourceMode=candidate&candidate=cand-${status}`,
        fileRepository: createFileRepository({
          getCandidate: vi.fn(async () => candidate),
          downloadCandidate: vi.fn(async () => ({
            contentType: "text/plain",
            fileName: "aurora-board.dts",
            bytes: new TextEncoder().encode("/dts-v1/;\n/ { };\n")
          }))
        })
      });
      await screen.findByTitle(`cand-${status}`);
      await openSourceUpdates();
      await screen.findByRole("complementary", { name: "配置检查器" });
      expect(screen.queryByTestId("activate-candidate")).not.toBeInTheDocument();
  });

  it.each(["canonical", "unknown"])("blocks new-file candidate activation into a %s target configuration set", async (kind) => {
    const activateCandidate = vi.fn();
    const getSourceWorkflow = vi.fn(async () => {
      if (kind === "unknown") throw new Error("来源状态未知");
      return { canonical: true, bindingCount: 2, configSetId: "cs-default", proofToken: "source-proof" };
    });
    renderWorkbench({ search: "?configSet=cs-default&file=file-board&sourceMode=candidate&candidate=cand-new&inspector=candidates",
      fileRepository: createFileRepository({
        getSourceWorkflow, activateCandidate,
        getCandidate: vi.fn(async () => ({ id: "cand-new", projectId: PROJECT.id, fileName: "new-overlay.dtsi",
          format: "dts" as const, status: "ready" as const, diagnostics: [], blockers: [],
          impact: { textDiff: "", structuralDiff: [], diagnostics: [], blockers: [], conflicts: [] },
          createdAt: "2026-10-17T00:00:00.000Z", updatedAt: "2026-10-17T00:00:00.000Z" })),
        getCandidateSourcePreview: vi.fn(async () => ({ kind: "legacy" as const, candidateId: "cand-new", format: "dts", canSubmit: false })),
        downloadCandidate: vi.fn(async () => ({ contentType: "text/plain", fileName: "new-overlay.dtsi", bytes: new TextEncoder().encode("/dts-v1/;\n/ { };\n") }))
      }) });
    await screen.findByText(kind === "canonical" ? "当前配置受审核保护，暂不支持直接应用新文件候选。" : "来源校验尚未满足应用条件。");
    await waitFor(() => expect(getSourceWorkflow).toHaveBeenCalledWith(PROJECT.id, "file-board"));
    expect(screen.queryByTestId("activate-candidate")).not.toBeInTheDocument();
    expect(activateCandidate).not.toHaveBeenCalled();
    if (kind === "canonical") {
      const files = await openSchemeFiles();
      expect(within(files).getByText("此配置已登记来源。添加或移除文件均需预览并确认，项目文件及历史会保留。")).toBeVisible();
      expect(within(files).queryByText(/同一文件可用于多个方案/)).not.toBeInTheDocument();
      expect(within(files).queryByRole("button", { name: "添加文件" })).not.toBeInTheDocument();
      await userEvent.click(within(files).getByRole("button", { name: "aurora-board.dts 更多" }));
      expect(screen.queryByRole("menuitem", { name: /从配置移除/ })).not.toBeInTheDocument();
    }
  });

  it("maps a legacy file inspector deep link to versions and keeps config-set membership details", async () => {
    renderWorkbench({
      search: "?configSet=cs-default&file=file-board&inspector=file"
    });
    await screen.findByRole("heading", { name: "aurora-board.dts" });
    const fileInspector = await screen.findByRole("complementary", { name: "配置检查器" });
    expect(within(fileInspector).getByText("aurora-board.dts")).toBeInTheDocument();
    expect(within(fileInspector).getByRole("region", { name: "版本历史" })).toBeVisible();
    expect(within(fileInspector).queryByRole("button", { name: "手动同步" })).not.toBeInTheDocument();
    expect(within(fileInspector).queryByRole("button", { name: /从配置移除/ })).not.toBeInTheDocument();
    const { default: axe } = await import("axe-core");
    expect((await axe.run(fileInspector, { runOnly: ["definition-list", "dlitem"] })).violations).toEqual([]);

    cleanup();
    const { onNavigate } = renderWorkbench({ syncSearch: true,
      search: "?configSet=cs-default&inspector=config-set"
    });
    const files = await screen.findByRole("dialog", { name: "配置组成" });
    expect(screen.queryByRole("complementary", { name: "配置检查器" })).not.toBeInTheDocument();
    expect(files).toHaveTextContent("默认配置");
    expect(files).not.toHaveTextContent("default");
    expect(within(files).queryByText("描述", { exact: true })).not.toBeInTheDocument();
    expect(within(files).getByRole("table", { name: "配置文件" }).closest("dl")).toBeNull();
    expect((await axe.run(files, { runOnly: ["definition-list", "dlitem"] })).violations).toEqual([]);
    expect(files).toBeVisible();
    await userEvent.click(within(files).getByRole("button", { name: "关闭配置组成" }));
    await selectScheme("cs-alpha");
    expect(screen.queryByRole("dialog", { name: "配置组成" })).not.toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "配置检查器" })).not.toBeInTheDocument();
    const latest = new URLSearchParams(String(onNavigate.mock.calls.at(-1)?.[0]).split("?")[1]);
    expect(latest.get("configSet")).toBe("cs-alpha");
    expect(latest.get("inspector")).toBeNull();
  });

  it("does not render the revision gate without a topology repository", async () => {
    renderWorkbench({
      search: "?configSet=cs-default&inspector=config-set"
    });
    await screen.findByRole("dialog", { name: "配置组成" });
    expect(screen.queryByRole("region", { name: "配置修订门禁" })).not.toBeInTheDocument();
  });

  it.each([0, 1])("uses no revision selector for %i revisions while retaining server validation for a real revision", async (count) => {
    const topologyRepository = createTopologyRepository({ listConfigRevisions: vi.fn(async () => count === 0 ? [] : [{
      id: "rev-only", configSetId: "cs-default", revisionNumber: 7, status: "resolved" as const, createdAt: "2026-08-17T10:00:00.000Z"
    }]) });
    renderWorkbench({ search: "?configSet=cs-default&inspector=release", topologyRepository });
    const inspector = await screen.findByRole("dialog", { name: "配置版本" });
    fireEvent.click(within(inspector).getByText("高级校验"));
    const gate = await within(inspector).findByRole("region", { name: "配置修订门禁" });
    if (count === 0) expect(await within(gate).findByText(/尚无配置修订/)).toBeVisible();
    else expect(await within(gate).findByText("修订 7 · 已解析", { exact: true })).toBeVisible();
    expect(within(gate).queryByRole("combobox", { name: "配置修订" })).not.toBeInTheDocument();
    const validate = within(gate).getByRole("button", { name: "校验修订" });
    if (count === 0) {
      expect(validate).toBeDisabled();
      fireEvent.click(validate);
      expect(topologyRepository.validateRevision).not.toHaveBeenCalled();
    } else {
      expect(validate).toBeEnabled();
      fireEvent.click(validate);
      await waitFor(() => expect(topologyRepository.validateRevision).toHaveBeenCalledExactlyOnceWith(PROJECT.id, "rev-only"));
      expect(await within(gate).findByRole("status")).toHaveTextContent("修订校验未硬性通过，发布前需确认该风险。");
    }
  });

  it("lists real config revisions and validates the selected listed id", async () => {
    const topologyRepository = createTopologyRepository();
    renderWorkbench({
      search: "?configSet=cs-default&inspector=release",
      topologyRepository
    });

    const inspector = await screen.findByRole("dialog", { name: "配置版本" });
    fireEvent.click(within(inspector).getByText("高级校验"));
    const gate = await within(inspector).findByRole("region", { name: "配置修订门禁" });
    const revisionSelect = await within(gate).findByRole("combobox", { name: "配置修订" });
    await waitFor(() => expect(revisionSelect).toHaveAttribute("data-value", "rev-cs-listed"));
    expect(within(gate).getByRole("combobox", { name: "配置修订" })).toHaveTextContent("修订 2 · 已解析");
    expect(within(gate).queryByText("revision-teaching-1")).not.toBeInTheDocument();

    fireEvent.click(within(gate).getByRole("button", { name: "校验修订" }));
    await waitFor(() =>
      expect(topologyRepository.validateRevision).toHaveBeenCalledWith("project-1", "rev-cs-listed")
    );
    expect(topologyRepository.validateRevision).not.toHaveBeenCalledWith(
      "project-1",
      "revision-teaching-1"
    );
    expect(await within(gate).findByRole("status")).toHaveTextContent(
      "修订校验未硬性通过，发布前需确认该风险。"
    );
    await selectControlOption(revisionSelect, "rev-cs-older");
    fireEvent.click(within(gate).getByRole("button", { name: "校验修订" }));
    await waitFor(() => expect(topologyRepository.validateRevision).toHaveBeenLastCalledWith(PROJECT.id, "rev-cs-older"));
  });

  it("requires acknowledgement on baseline release when revision validation is a soft pass", async () => {
    const topologyRepository = createTopologyRepository();
    renderWorkbench({
      search: "?configSet=cs-default&inspector=release&baseline=baseline-draft-v2",
      topologyRepository,
      dtsRepository: createDtsRepository({
        listBaselines: vi.fn<DtsStructuredRepository["listBaselines"]>(async (_projectId, configSetId) =>
          configSetId === "cs-default"
            ? [
                {
                  id: "baseline-draft-v2",
                  organizationId: "org-1",
                  configSetId,
                  name: "draft-v2",
                  status: "draft" as const,
                  createdAt: "2026-08-17T08:00:00.000Z"
                },
                {
                  id: "baseline-seed-v1",
                  organizationId: "org-1",
                  configSetId,
                  name: "seed-v1",
                  status: "released" as const,
                  createdAt: "2026-08-06T08:00:00.000Z"
                }
              ]
            : []
        )
      })
    });

    const inspector = await screen.findByRole("dialog", { name: "配置版本" });
    fireEvent.click(within(inspector).getByText("高级校验"));
    const gate = await within(inspector).findByRole("region", { name: "配置修订门禁" });
    await waitFor(() =>
      expect(within(gate).getByRole("combobox", { name: "配置修订" })).toHaveAttribute("data-value", "rev-cs-listed")
    );
    fireEvent.click(within(gate).getByRole("button", { name: "校验修订" }));
    await waitFor(() =>
      expect(topologyRepository.validateRevision).toHaveBeenCalledWith("project-1", "rev-cs-listed")
    );

    fireEvent.click(await within(inspector).findByRole("button", { name: "设为正式版本" }));
    const dialog = await screen.findByRole("dialog", { name: "设为正式版本确认" });
    const confirm = within(dialog).getByRole("button", { name: "确认设为正式版本" });
    expect(confirm).toBeDisabled();
    fireEvent.click(
      within(dialog).getByRole("checkbox", {
        name: "我已了解修订校验未硬性通过的风险，确认继续设为正式版本。"
      })
    );
    expect(confirm).toBeEnabled();
  });

  it("opens the conflicts tab from the legacy task query without an empty task dock", async () => {
    renderWorkbench({
      search: "?configSet=cs-default&file=file-board&tasks=conflicts"
    });
    expect(await screen.findByRole("tabpanel", { name: "冲突" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "任务" })).not.toBeInTheDocument();
    expect(screen.getByText("当前没有待处理同步冲突。来源冲突请在候选记录中查看。")).toBeInTheDocument();
  });

  it.each([
    ["更新来源", "candidates", "来源更新"],
    ["版本历史与下载", "versions", "版本历史"],
    ["配置版本", "release", "配置版本"]
  ])("switches an activity URL to the %s task and clears the inspector query on close", async (button, level, title) => {
    let finishStructure!: (result: DtsStructureResult) => void;
    const pendingStructure = new Promise<DtsStructureResult>((resolve) => { finishStructure = resolve; });
    const { onNavigate } = renderWorkbench({ syncSearch: true,
      search: "?configSet=cs-default&file=file-board&node=board&property=model&inspector=activity",
      dtsRepository: createDtsRepository({ getStructure: vi.fn(async () => pendingStructure) }) });
    const initial = await screen.findByRole("complementary", { name: "配置检查器" });
    expect(initial).toHaveTextContent("项目活动");
    if (level === "release") fireEvent.click(screen.getByRole("button", { name: /^配置版本/ }));
    else if (level === "candidates") await openSourceUpdates();
    else await openWorkbenchVersionDetails();
    await waitFor(() => {
      const selected = new URLSearchParams(String(onNavigate.mock.calls.at(-1)?.[0]).split("?")[1]);
      expect(selected.get("inspector")).toBe(level);
      expect(selected.get("file")).toBe("file-board");
    });
    await act(async () => {
      finishStructure({ nodes: [BOARD_STRUCTURE.nodes[1]!] });
      await pendingStructure;
    });
    const panel = level === "release" ? screen.getByRole("dialog", { name: "配置版本" }) : screen.getByRole("complementary", { name: "配置检查器" });
    await waitFor(() => expect(panel).toHaveTextContent(title!));
    expect(panel).not.toHaveTextContent("活动时间线");
    if (level === "release") expect(screen.getByRole("button", { name: /^配置版本/ })).toHaveAttribute("aria-pressed", "true");
    if (level === "candidates") expect(screen.queryByRole("button", { name: /^更新来源/ })).not.toBeInTheDocument();
    fireEvent.click(within(panel).getByRole("button", { name: level === "release" ? "关闭配置版本" : "关闭检查器" }));
    await waitFor(() => expect(panel).not.toBeInTheDocument());
    const closed = new URLSearchParams(String(onNavigate.mock.calls.at(-1)?.[0]).split("?")[1]);
    expect(closed.has("inspector")).toBe(false);
    expect(closed.get("configSet")).toBe("cs-default");
    expect(closed.get("file")).toBe("file-board");
    expect(screen.getByRole("main", { name: /DTS 源码/ })).toBeVisible();
  });

  it("opens Activity from the command bar without a permanent audit banner above source", async () => {
    const listAuditEvents = vi.fn<NonNullable<ProjectConfigurationWorkbenchProps["listAuditEvents"]>>(async () => ({
      items: [
        {
          id: "evt-activity-1",
          organizationId: "org-chargelab",
          projectId: PROJECT.id,
          actorUserId: "user-ada",
          actorType: "user" as const,
          actorName: "Ada Admin",
          app: "parameters",
          kind: "parameter-file-candidate-create",
          action: "create",
          severity: "Medium" as const,
          targetType: "project-parameter-file-candidate",
          targetId: "cand-1",
          metadata: {
            fileName: "aurora-board.dts",
            fileId: "file-board",
            status: "ready"
          },
          traceId: "trace-activity-1",
          createdAt: "2026-08-07T04:00:00.000Z"
        }
      ],
      nextCursor: null
    }));

    renderWorkbench({
      search: "?configSet=cs-default&file=file-board",
      listAuditEvents
    });

    await screen.findByRole("heading", { name: "aurora-board.dts" });
    expect(screen.queryByLabelText("治理审计")).not.toBeInTheDocument();

    await openWorkbenchMoreMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "项目活动" }));
    const inspector = await screen.findByRole("complementary", { name: "配置检查器" });
    expect(inspector).toHaveTextContent("项目活动");
    await waitFor(() => expect(listAuditEvents).toHaveBeenCalled());
    expect(listAuditEvents.mock.calls[0]?.[0]).toMatchObject({
      projectId: PROJECT.id,
      apps: expect.arrayContaining(["parameters", "parameter-management", "parameter-admin"])
    });
    await waitFor(() => expect(inspector).toHaveTextContent("Ada Admin"));
    expect(inspector).toHaveTextContent("创建");
    expect(inspector).toHaveTextContent("候选文件版本");
    expect(inspector).toHaveTextContent("成功");
  });

  it("restores file context from a targetable activity event and fails gracefully when missing", async () => {
    const listAuditEvents = vi.fn(async () => ({
      items: [
        {
          id: "evt-file",
          organizationId: "org-chargelab",
          projectId: PROJECT.id,
          actorUserId: "user-ada",
          actorType: "user" as const,
          actorName: "Ada Admin",
          app: "parameters",
          kind: "parameter-file-upload",
          action: "upload",
          severity: "Low" as const,
          targetType: "project-parameter-file",
          targetId: "file-overlay",
          metadata: { fileName: "charging-overlay.dtsi" },
          traceId: "trace-file",
          createdAt: "2026-08-07T04:01:00.000Z"
        },
        {
          id: "evt-missing",
          organizationId: "org-chargelab",
          projectId: PROJECT.id,
          actorUserId: "user-ada",
          actorType: "user" as const,
          actorName: "Ada Admin",
          app: "parameters",
          kind: "parameter-file-candidate-create",
          action: "create",
          severity: "Medium" as const,
          targetType: "project-parameter-file-candidate",
          targetId: "cand-gone",
          metadata: { fileName: "gone.dts", fileId: "file-board", status: "ready" },
          traceId: "trace-missing",
          createdAt: "2026-08-07T04:02:00.000Z"
        }
      ],
      nextCursor: null
    }));
    const onNavigate = vi.fn();

    renderWorkbench({
      search: "?configSet=cs-default&file=file-board",
      onNavigate,
      listAuditEvents,
      syncSearch: true
    });

    await screen.findByRole("heading", { name: "aurora-board.dts" });
    await openWorkbenchMoreMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "项目活动" }));
    await screen.findByLabelText("项目活动事件");

    fireEvent.click(screen.getByRole("button", { name: /上传 · 参数文件 · charging-overlay\.dtsi/i }));
    await waitFor(() =>
      expect(onNavigate.mock.calls.some((call) => String(call[0]).includes("file=file-overlay"))).toBe(true)
    );

    await openWorkbenchMoreMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "项目活动" }));
    await screen.findByLabelText("项目活动事件");
    fireEvent.click(screen.getByRole("button", { name: /创建 · 候选文件版本 · gone\.dts/i }));
    expect(await screen.findByRole("status", { name: "活动目标不可用" })).toHaveTextContent(/候选/);
    expect(screen.getByRole("main", { name: /DTS 源码/ })).toBeInTheDocument();
  });

  it("shows mutation toasts and refreshes the activity timeline from server evidence", async () => {
    const listAuditEvents = vi.fn(async () => ({ items: [], nextCursor: null }));
    const createCandidate = vi.fn(async () => ({
      id: "cand-1",
      projectId: PROJECT.id,
      fileId: "file-board",
      fileName: "aurora-board.dts",
      format: "dts" as const,
      status: "ready" as const,
      sizeBytes: 32,
      createdAt: "2026-08-07T05:00:00.000Z",
      updatedAt: "2026-08-07T05:00:00.000Z",
      diagnostics: [],
      blockers: [],
      impact: {
        textDiff: "--- a\n+++ b\n",
        structuralDiff: [],
        conflicts: [],
        blockers: []
      }
    }));

    renderWorkbench({
      search: "?configSet=cs-default&file=file-board",
      listAuditEvents,
      fileRepository: createFileRepository({ createCandidate })
    });

    await screen.findByRole("heading", { name: "aurora-board.dts" });
    await openWorkbenchMoreMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "项目活动" }));
    await waitFor(() => expect(listAuditEvents).toHaveBeenCalledTimes(1));

    await openSourceUpdates();
    fireEvent.click(screen.getByRole("button", { name: "上传新文件" }));
    const uploadInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['/dts-v1/;\n/ { model = "Cand"; };\n'], "aurora-board.dts", {
      type: "text/plain"
    });
    Object.defineProperty(uploadInput, "files", { configurable: true, value: [file] });
    fireEvent.change(uploadInput);

    await waitFor(() => expect(createCandidate).toHaveBeenCalled());
    expect(await screen.findByText("候选已创建，工作配置与活跃版本未改动。")).toBeInTheDocument();
    await openWorkbenchMoreMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "项目活动" }));
    await waitFor(() => expect(listAuditEvents.mock.calls.length).toBeGreaterThan(1));
  });

  it("keeps the workbench and desktop detail layout when activity loading fails", async () => {
    const listAuditEvents = vi.fn(async () => {
      throw new Error("audit unavailable");
    });

    renderWorkbench({
      search: "?configSet=cs-default&file=file-board",
      listAuditEvents
    });

    await screen.findByRole("heading", { name: "aurora-board.dts" });
    await openWorkbenchMoreMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "项目活动" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/audit unavailable|活动|失败/i);
    expect(screen.getByRole("main", { name: /DTS 源码/ })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "配置检查器" })).toHaveAttribute("data-layout", "persistent");
  });

  it("creates a Config set from the empty project path with name validation and duplicate handling", async () => {
    const created = {
      id: "cs-board-a",
      organizationId: "org-1",
      projectId: PROJECT.id,
      name: "board-a",
      createdAt: "2026-08-07T12:00:00.000Z",
      updatedAt: "2026-08-07T12:00:00.000Z"
    };
    let configSets: Array<typeof created> = [];
    const createConfigSet = vi.fn(async (_projectId: string, input: { name: string }) => {
      const next = { ...created, name: input.name };
      configSets = [next, ...configSets];
      return next;
    });
    const listConfigSets = vi.fn(async () => configSets);
    const { onNavigate } = renderWorkbench({
      search: "?inspector=versions&baseline=old-baseline&candidate=old-candidate&sourceMode=history",
      dtsRepository: createDtsRepository({
        listConfigSets,
        createConfigSet,
        listConfigSetFiles: vi.fn<DtsStructuredRepository["listConfigSetFiles"]>(async () => [])
      })
    });

    expect(await screen.findByText("项目还没有配置")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "打开旧配置管理" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^更新来源/ })).not.toBeInTheDocument();

    await openCreateConfigSetDialog();
    await userEvent.click(screen.getByRole("button", { name: "取消" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "配置" })).toHaveFocus());
    await openCreateConfigSetDialog();
    fireEvent.click(screen.getByRole("button", { name: "创建配置" }));
    expect(await screen.findByText(/请先填写配置名称/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("配置名称"), { target: { value: "board-a" } });
    fireEvent.click(screen.getByRole("button", { name: "创建配置" }));
    await waitFor(() => expect(createConfigSet).toHaveBeenCalledWith(PROJECT.id, { name: "board-a" }));
    await waitFor(() =>
      expect(onNavigate).toHaveBeenCalledWith(
        expect.stringContaining("configSet=cs-board-a")
      )
    );
    const files = await screen.findByRole("dialog", { name: "配置组成" });
    expect(files).toBeVisible();
    const createdPath = onNavigate.mock.calls.map((call) => String(call[0]))
      .find((path) => path.includes("configSet=cs-board-a"))!;
    const createdQuery = new URLSearchParams(createdPath.split("?")[1]);
    expect(createdQuery.get("inspector")).toBe("config-set");
    for (const key of ["baseline", "candidate", "sourceMode"]) expect(createdQuery.has(key)).toBe(false);
    await userEvent.click(within(files).getByRole("button", { name: "关闭配置组成" }));

    await openCreateConfigSetDialog();
    fireEvent.change(screen.getByLabelText("配置名称"), { target: { value: "Board-A" } });
    fireEvent.click(screen.getByRole("button", { name: "创建配置" }));
    expect(await screen.findByText(/已存在名为「Board-A」的配置/)).toBeInTheDocument();
  });

  it("adds and removes Config set members with role, sortOrder, and blast-radius confirmation", async () => {
    const members: Awaited<ReturnType<DtsStructuredRepository["listConfigSetFiles"]>> = [
      {
        configSetId: "cs-default",
        fileId: "file-board",
        fileName: "aurora-board.dts",
        format: "dts" as const,
        role: "base" as const,
        sortOrder: 0,
        currentVersionId: "version-board-12",
        currentVersionNumber: 12
      }
    ];
    const addConfigSetFile = vi.fn(async (_projectId: string, configSetId: string, input: { fileId: string; role: string; sortOrder?: number }) => {
      const added = {
        configSetId,
        fileId: input.fileId,
        fileName: "notes.json",
        format: "json" as const,
        role: input.role as "misc",
        sortOrder: input.sortOrder ?? 1,
        currentVersionId: "version-loose-1",
        currentVersionNumber: 1
      };
      members.push(added);
      return added;
    });
    const removeConfigSetFile = vi.fn(async (_projectId: string, _configSetId: string, fileId: string) => {
      const index = members.findIndex((item) => item.fileId === fileId);
      if (index >= 0) members.splice(index, 1);
    });
    const listConfigSetFiles = vi.fn<DtsStructuredRepository["listConfigSetFiles"]>(async () => [...members]);

    renderWorkbench({
      syncSearch: true,
      dtsRepository: createDtsRepository({
        listConfigSetFiles,
        addConfigSetFile,
        removeConfigSetFile
      })
    });

    await screen.findByRole("heading", { name: "aurora-board.dts" });
    const ungrouped = screen.getByRole("group", { name: "待分配项目文件" });
    expect(ungrouped).toHaveTextContent("notes.json");
    expect(ungrouped).toHaveTextContent("待分配");

    const readsBeforeAdd = listConfigSetFiles.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "加入 notes.json" }));
    await waitFor(() =>
      expect(addConfigSetFile).toHaveBeenCalledWith(PROJECT.id, "cs-default", {
        fileId: "file-loose",
        role: "misc",
        sortOrder: 1
      })
    );
    await waitFor(() => expect(screen.getByRole("treeitem", { name: /notes\.json/ })).toBeInTheDocument());
    expect(listConfigSetFiles.mock.calls.length).toBeGreaterThan(readsBeforeAdd);

    const files = await openSchemeFiles();
    expect(within(files).getByRole("table", { name: "配置文件" })).toHaveTextContent("notes.json");
    expect(within(files).getByRole("button", { name: "关闭配置组成" })).toBeInTheDocument();
    await userEvent.click(within(files).getByRole("button", { name: "aurora-board.dts 更多" }));
    const remove = await screen.findByRole("menuitem", { name: "从配置移除" });
    await waitFor(() => expect(remove).toBeEnabled());
    fireEvent.click(remove);
    expect(await screen.findByRole("dialog", { name: "从配置移除文件" })).toHaveTextContent("后续基线与导出将不再包含它");
    expect(removeConfigSetFile).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "确认移除" }));
    await waitFor(() =>
      expect(removeConfigSetFile).toHaveBeenCalledWith(PROJECT.id, "cs-default", "file-board")
    );
    expect(removeConfigSetFile).toHaveBeenCalledTimes(1);
  });

  it.each(["source", "conflicts"])("keeps conflict locate on a non-member file and shows its source from %s", async (tab) => {
    const onNavigate = vi.fn();
    const listConflicts = vi.fn<ParameterFileRepository["listConflicts"]>(async () => [
      {
        id: "conflict-loose",
        organizationId: "org-1",
        projectId: PROJECT.id,
        projectParameterValueId: "ppv-loose",
        parameterDefinitionId: "def-loose",
        parameterName: "note",
        fileVersionId: "version-loose-1",
        fileDraftId: "fd-loose",
        uiDraftId: "ud-loose",
        fileValue: "from-file",
        uiDraftValue: "from-ui",
        baseValue: "base",
        status: "open" as const,
        createdAt: "2026-08-07T12:00:00.000Z",
        fileVersionLabel: "v1",
        fileId: "file-loose",
        fileName: "notes.json",
        source: {
          startOffset: 0,
          endOffset: 8,
          startLine: 1,
          startColumn: 1,
          endLine: 1,
          endColumn: 9
        }
      }
    ]);
    const downloadVersion = vi.fn(async (_projectId: string, fileId: string) => ({
      contentType: "application/json",
      fileName: fileId === "file-loose" ? "notes.json" : "aurora-board.dts",
      bytes: new TextEncoder().encode(
        fileId === "file-loose" ? '{"notes":"ungrouped"}\n' : '/dts-v1/;\n/ { model = "Aurora"; };\n'
      )
    }));

    renderWorkbench({
      syncSearch: true,
      search: `?configSet=cs-default&file=file-board&tab=${tab}`,
      onNavigate,
      fileRepository: createFileRepository({ listConflicts, downloadVersion })
    });

    if (tab === "source") await screen.findByRole("heading", { name: "aurora-board.dts" });
    else await screen.findByRole("tabpanel", { name: "冲突" });
    const taskToggle = await screen.findByRole("button", { name: "任务" });
    await waitFor(() => expect(taskToggle).toHaveTextContent("冲突"));
    if (taskToggle.getAttribute("aria-expanded") !== "true") {
      fireEvent.click(taskToggle);
    }
    if (tab === "source") {
      expect(onNavigate).not.toHaveBeenCalledWith(expect.stringMatching(/file=file-loose/));
      expect(screen.queryByRole("button", { name: "处理 1 项冲突" })).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole("tab", { name: /^冲突/ }));
    }
    const dock = await screen.findByLabelText("冲突仲裁");

    fireEvent.click(within(dock).getByRole("button", { name: "在源码中定位" }));
    expect(await screen.findByRole("tabpanel", { name: "源码" })).toBeInTheDocument();
    await waitFor(() => {
      const paths = onNavigate.mock.calls.map((call) => String(call[0]));
      const lastLoose = [...paths].reverse().find((path) => path.includes("file=file-loose"));
      expect(lastLoose).toBeTruthy();
      const afterLoose = paths.slice(paths.lastIndexOf(lastLoose!) + 1);
      expect(
        afterLoose.every((path) => path.includes("file=file-loose") || !/file=file-board\b/.test(path))
      ).toBe(true);
    });
    expect(screen.getByRole("heading", { name: "notes.json" })).toBeInTheDocument();
  });

  it("runs manual sync from the command menu and dismisses its result without losing drafts, conflicts, or a later error", async () => {
    const syncFile = vi.fn(async () => ({
      draftsCreated: 2,
      unchanged: 1,
      unmatched: 0,
      skipped: false
    }));
    const listConflicts = vi.fn<ParameterFileRepository["listConflicts"]>(async () => [
      {
        id: "conflict-1",
        organizationId: "org-1",
        projectId: PROJECT.id,
        projectParameterValueId: "ppv-1",
        parameterDefinitionId: "def-1",
        parameterName: "model",
        parameterModule: "Board",
        fileVersionId: "version-board-12",
        fileDraftId: "fd-1",
        uiDraftId: "ud-1",
        fileValue: "Aurora",
        uiDraftValue: "Other",
        baseValue: "Legacy",
        status: "open" as const,
        createdAt: "2026-08-07T12:00:00.000Z",
        fileVersionLabel: "v12",
        fileId: "file-board",
        fileName: "aurora-board.dts",
        nodePath: "board",
        propertyName: "model"
      }
    ]);

    const draftStorage = legacyDraftStorage();
    renderWorkbench({ draftStorage, currentUserId: "user-a", organizationId: "org-1",
      syncSearch: true,
      canEdit: true,
      canEditCritical: true,
      dtsRepository: createDtsRepository({ getStructure: vi.fn(async () => BOARD_STRUCTURE),
        exportConfigSet: vi.fn(async () => { throw new Error("导出记录不可用"); }) }),
      fileRepository: createFileRepository({ syncFile, listConflicts })
    });

    await screen.findByRole("heading", { name: "aurora-board.dts" });
    fireEvent.click(await screen.findByRole("treeitem", { name: "属性 board/model" }));
    await openLocalChanges();
    expect(screen.getByRole("checkbox", { name: "board/model" })).toBeChecked();
    await openWorkbenchMoreMenu();
    await userEvent.click(screen.getByRole("menuitem", { name: "手动同步" }));
    await waitFor(() => expect(syncFile).toHaveBeenCalledWith(PROJECT.id, "file-board"));
    await waitFor(() => expect(listConflicts).toHaveBeenCalledWith(PROJECT.id));

    const taskToggle = screen.getByRole("button", { name: "任务" });
    if (taskToggle.getAttribute("aria-expanded") !== "true") {
      fireEvent.click(taskToggle);
    }
    const tasks = await openLocalChanges();
    expect(tasks).toHaveTextContent("aurora-board.dts");
    expect(tasks).toHaveTextContent("已创建 2 条草稿");
    expect(taskToggle).toHaveTextContent("冲突");
    expect(taskToggle).toHaveTextContent("1");
    expect(within(tasks).queryByLabelText("冲突仲裁")).not.toBeInTheDocument();
    expect(within(tasks).queryByRole("button", { name: "处理 1 项冲突" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: /^冲突/ }));
    const conflicts = await screen.findByRole("tabpanel", { name: /冲突/ });
    expect(within(conflicts).getByLabelText("冲突仲裁")).toBeInTheDocument();
    expect(within(conflicts).getByRole("button", { name: "使用文件值" })).toBeInTheDocument();
    expect(within(conflicts).getByRole("button", { name: "保留界面值" })).toBeInTheDocument();
    expect(within(conflicts).getByText("基线值")).toBeInTheDocument();
    expect(tasks).not.toHaveTextContent("旧冲突视图");
    const syncSuccess = within(tasks).getByText(/aurora-board.dts：同步成功/).textContent!;
    expect(screen.getAllByText(syncSuccess, { exact: true })).toHaveLength(1);
    await openSchemeMenu();
    await userEvent.click(screen.getByRole("menuitem", { name: "导出当前配置" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("导出记录不可用");
    fireEvent.click(within(tasks).getByRole("button", { name: "关闭操作结果" }));
    expect(screen.queryByText(syncSuccess, { exact: true })).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("导出记录不可用");
    expect(within(tasks).getByRole("checkbox", { name: "board/model" })).toBeChecked();
    expect(within(tasks).getByText(/Legacy recovered/)).toBeInTheDocument();
    expect(taskToggle).toHaveTextContent(/冲突\s*1/);
    expect(within(conflicts).getByLabelText("冲突仲裁")).toBeInTheDocument();
  });

  it.each([false, true])("exports the current scheme ZIP and reports success only after download (archiveFailure=%s)", async (archiveFailure) => {
    const exportConfigSet = vi.fn(async () => ({
      manifest: {
        configSetId: "cs-default",
        name: "default",
        projectId: PROJECT.id,
        exportedAt: "2026-08-07T12:00:00.000Z",
        validation: { ok: true, mode: "warn" as const, compiler: "dtc" as const, requiresConfirmation: false },
        members: [
          {
            fileId: "file-board",
            fileName: "aurora-board.dts",
            role: "base" as const,
            sortOrder: 0,
            versionNumber: 12,
            format: "dts" as const
          }
        ]
      },
      files: [{ name: "aurora-board.dts", format: "dts" as const, content: '/dts-v1/;\n/ { model = "Aurora"; };\n' }]
    }));
    const createObjectURL = vi.fn((_blob: Blob) => {
      if (archiveFailure) throw new Error("archive download failed");
      return "blob:export";
    });
    const revokeObjectURL = vi.fn();
    const clickSpy = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tagName: string) => {
      const element = originalCreateElement(tagName);
      if (tagName === "a") {
        Object.defineProperty(element, "click", { value: clickSpy });
      }
      return element;
    });

    renderWorkbench({
      dtsRepository: createDtsRepository({ exportConfigSet })
    });

    await screen.findByRole("heading", { name: "aurora-board.dts" });
    await openSchemeMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "导出当前配置" }));
    await waitFor(() => expect(exportConfigSet).toHaveBeenCalledWith(PROJECT.id, "cs-default"));
    await waitFor(() => expect(createObjectURL).toHaveBeenCalled());
    if (archiveFailure) {
      expect(await screen.findByRole("alert")).toHaveTextContent("操作未完成");
      expect(screen.queryByText(/已导出/)).not.toBeInTheDocument();
      expect(clickSpy).not.toHaveBeenCalled();
      expect(revokeObjectURL).not.toHaveBeenCalled();
      return;
    }
    const blob = createObjectURL.mock.calls[0]![0];
    expect(blob.type).toBe("application/zip");
    const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => typeof reader.result === "string" || !reader.result ? reject(new Error("Expected ZIP bytes")) : resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(blob);
    });
    const { default: JSZip } = await import("jszip");
    const archive = await JSZip.loadAsync(bytes, { checkCRC32: true });
    expect(Object.keys(archive.files).sort()).toEqual(["aurora-board.dts", "wiseeff-config-set-export-manifest.json"]);
    const exported = await exportConfigSet.mock.results[0]!.value;
    expect(JSON.parse(await archive.file("wiseeff-config-set-export-manifest.json")!.async("string"))).toEqual(exported.manifest);
    expect(await archive.file("aurora-board.dts")!.async("string")).toBe(exported.files[0]!.content);
    expect(clickSpy).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalled();
    const tasks = await openLocalChanges();
    expect(tasks).toHaveTextContent("导出");
    const exportSuccess = within(tasks).getByText(/已导出配置/).textContent!;
    expect(screen.getAllByText(exportSuccess, { exact: true })).toHaveLength(1);
    fireEvent.click(within(tasks).getByRole("button", { name: "关闭操作结果" }));
    expect(screen.queryByRole("button", { name: "任务" })).not.toBeInTheDocument();
    expect(screen.queryByText(exportSuccess, { exact: true })).not.toBeInTheDocument();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("downloads the active member DTS from the version record menu", async () => {
    const downloadVersion = vi.fn(async () => ({
      contentType: "text/plain",
      fileName: "aurora-board.dts",
      bytes: new TextEncoder().encode('/dts-v1/;\n/ { model = "Aurora"; };\n')
    }));
    const createObjectURL = vi.fn(() => "blob:dts");
    const revokeObjectURL = vi.fn();
    const clickSpy = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tagName: string) => {
      const element = originalCreateElement(tagName);
      if (tagName === "a") {
        Object.defineProperty(element, "click", { value: clickSpy });
      }
      return element;
    });

    renderWorkbench({
      fileRepository: createFileRepository({ downloadVersion, listVersions: vi.fn(async () => [ACTIVE_BOARD_VERSION]) })
    });

    await screen.findByRole("heading", { name: "aurora-board.dts" });
    await openWorkbenchVersionDetails();
    await openVersionMenu(12);
    const downloadItem = screen.getByRole("menuitem", { name: "下载版本 12" });
    expect(downloadItem).toBeEnabled();
    const downloadsBeforeAction = downloadVersion.mock.calls.length;
    fireEvent.click(downloadItem);
    await waitFor(() => expect(downloadVersion).toHaveBeenCalledTimes(downloadsBeforeAction + 1));
    expect(downloadVersion).toHaveBeenLastCalledWith(PROJECT.id, "file-board", "version-board-12");
    await waitFor(() => expect(clickSpy).toHaveBeenCalledExactlyOnceWith());
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:dts");
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("keeps download DTS available for non-admin viewers", async () => {
    renderWorkbench({ canAdmin: false, fileRepository: createFileRepository({ listVersions: vi.fn(async () => [ACTIVE_BOARD_VERSION]) }) });
    await screen.findByRole("heading", { name: "aurora-board.dts" });
    const schemes = await openSchemeMenu();
    expect(within(schemes).queryByRole("menuitem", { name: "导出当前配置" })).not.toBeInTheDocument();
    expect(within(schemes).getByRole("menuitem", { name: "查看文件" })).toBeEnabled();
    await userEvent.keyboard("{Escape}");
    await openWorkbenchVersionDetails();
    await openVersionMenu(12);
    expect(screen.getByRole("menuitem", { name: "下载版本 12" })).toBeEnabled();
  });

  it("disables download DTS when the Config set has no members", async () => {
    renderWorkbench({
      dtsRepository: createDtsRepository({
        listConfigSetFiles: vi.fn<DtsStructuredRepository["listConfigSetFiles"]>(async () => [])
      })
    });
    await screen.findByText("当前配置还没有文件");
    await openWorkbenchMoreMenu();
    expect(screen.queryByRole("menuitem", { name: "下载当前 DTS" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "版本历史与下载" })).not.toBeInTheDocument();
  });

  it("keeps read context visible and denies mutations when canAdmin is false", async () => {
    renderWorkbench({ canAdmin: false });

    expect(await screen.findByRole("heading", { name: "aurora-board.dts" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "待分配项目文件" })).toHaveTextContent("notes.json");
    expect(screen.queryByText(/仅管理员可变更配置文件、同步或导出/)).not.toBeInTheDocument();
    const schemes = await openSchemeMenu();
    expect(within(schemes).queryByRole("menuitem", { name: "新建配置…" })).not.toBeInTheDocument();
    expect(within(schemes).queryByRole("menuitem", { name: "导出当前配置" })).not.toBeInTheDocument();
    expect(within(schemes).getByRole("menuitem", { name: "查看文件" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "加入 notes.json" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "手动同步" })).not.toBeInTheDocument();
  });

  it("shows a focused upload and assignment path for an empty Config set", async () => {
    renderWorkbench({
      dtsRepository: createDtsRepository({
        listConfigSetFiles: vi.fn<DtsStructuredRepository["listConfigSetFiles"]>(async () => [])
      })
    });

    expect(await screen.findByText("当前配置还没有文件")).toBeInTheDocument();
    await openSourceUpdates();
    expect(screen.getByRole("button", { name: "添加来源文件" })).toBeEnabled();
    expect(screen.getAllByRole("button", { name: /更新来源|添加来源文件/ }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /更新来源|添加来源文件/ })[0]).toBeEnabled();
    expect(screen.getByRole("group", { name: "待分配项目文件" })).toHaveTextContent("加入");
  });

  it("assigns a verified ungrouped file to an empty config set", async () => {
    const addConfigSetFile = vi.fn<DtsStructuredRepository["addConfigSetFile"]>(async (_projectId, configSetId, input) => ({ configSetId, ...input, sortOrder: input.sortOrder ?? 0 }));
    renderWorkbench({ dtsRepository: createDtsRepository({
      listConfigSetFiles: vi.fn<DtsStructuredRepository["listConfigSetFiles"]>(async () => []), addConfigSetFile
    }) });
    const assign = await screen.findByRole("button", { name: "加入 notes.json" });
    await waitFor(() => expect(assign).toBeEnabled());
    fireEvent.click(assign);
    await waitFor(() => expect(addConfigSetFile).toHaveBeenCalledWith(PROJECT.id, "cs-default", {
      fileId: "file-loose", role: "misc", sortOrder: 0
    }));
  });

  it("reports a changed source proof without adding a member or losing the assignment action", async () => {
    const legacy = createFileRepository();
    let changed = false;
    const addConfigSetFile = vi.fn();
    renderWorkbench({ dtsRepository: createDtsRepository({
      listConfigSetFiles: vi.fn<DtsStructuredRepository["listConfigSetFiles"]>(async () => []), addConfigSetFile
    }), fileRepository: createFileRepository({ getSourceWorkflow: vi.fn(async (projectId, fileId) => {
      if (changed && fileId === "file-loose") throw new Error("proof unavailable");
      return legacy.getSourceWorkflow(projectId, fileId);
    }) }) });
    const assign = await screen.findByRole("button", { name: "加入 notes.json" });
    await waitFor(() => expect(assign).toBeEnabled());
    changed = true;
    fireEvent.click(assign);
    expect(await screen.findByText("操作未完成，请刷新来源状态后重试。")).toBeVisible();
    expect(addConfigSetFile).not.toHaveBeenCalled();
    expect(assign).toBeEnabled();
  });

  it.each(["canonical", "unknown"])("blocks %s ungrouped files even in an empty config set", async (kind) => {
    const legacy = createFileRepository();
    const addConfigSetFile = vi.fn();
    renderWorkbench({ dtsRepository: createDtsRepository({
      listConfigSetFiles: vi.fn<DtsStructuredRepository["listConfigSetFiles"]>(async () => []), addConfigSetFile
    }), fileRepository: createFileRepository({ getSourceWorkflow: vi.fn(async (projectId, fileId) => {
      if (fileId !== "file-loose") return legacy.getSourceWorkflow(projectId, fileId);
      if (kind === "unknown") throw new Error("来源校验不可用");
      return { ...(await legacy.getSourceWorkflow(projectId, fileId)), canonical: true };
    }) }) });
    const assign = await screen.findByRole("button", { name: "加入 notes.json" });
    await waitFor(() => expect(screen.getByRole("button", { name: "加入 aurora-board.dts" })).toBeEnabled());
    expect(assign).toBeDisabled();
    fireEvent.click(assign);
    expect(addConfigSetFile).not.toHaveBeenCalled();
  });

  it("distinguishes conflict request failure from an empty queue and retries", async () => {
    const listConflicts = vi.fn<ParameterFileRepository["listConflicts"]>().mockRejectedValueOnce(new Error("offline")).mockResolvedValue([]);
    renderWorkbench({ search: "?configSet=cs-default&tab=conflicts", fileRepository: createFileRepository({ listConflicts }) });
    expect(await screen.findByText("冲突加载失败，请重试。")).toBeVisible();
    expect(screen.queryByText("当前没有待处理同步冲突。来源冲突请在候选记录中查看。")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByText("当前没有待处理同步冲突。来源冲突请在候选记录中查看。")).toBeVisible();
    expect(listConflicts).toHaveBeenCalledTimes(2);
  });

  it("loads open conflicts on mount so the task count stays current", async () => {
    const listConflicts = vi.fn<ParameterFileRepository["listConflicts"]>(async () => [
      {
        id: "conflict-mount",
        organizationId: "org-1",
        projectId: PROJECT.id,
        projectParameterValueId: "ppv-1",
        parameterDefinitionId: "def-1",
        parameterName: "model",
        fileVersionId: "version-board-12",
        fileDraftId: "fd-1",
        uiDraftId: "ud-1",
        fileValue: "Aurora",
        uiDraftValue: "Other",
        baseValue: "Legacy",
        status: "open" as const,
        createdAt: "2026-08-07T12:00:00.000Z",
        fileId: "file-board",
        fileName: "aurora-board.dts",
        nodePath: "board",
        propertyName: "model"
      }
    ]);

    renderWorkbench({
      search: "?configSet=cs-default&file=file-board",
      fileRepository: createFileRepository({ listConflicts })
    });

    await waitFor(() => expect(listConflicts).toHaveBeenCalledWith(PROJECT.id));
    const taskToggle = await screen.findByRole("button", { name: "任务" });
    expect(taskToggle).toHaveTextContent("冲突");
    expect(taskToggle).toHaveTextContent("1");
  });

  it("opens the Conflicts task dock from a conflict activity event", async () => {
    const listConflicts = vi.fn<ParameterFileRepository["listConflicts"]>(async () => [
      {
        id: "conflict-activity",
        organizationId: "org-1",
        projectId: PROJECT.id,
        projectParameterValueId: "ppv-1",
        parameterDefinitionId: "def-1",
        parameterName: "model",
        fileVersionId: "version-board-12",
        fileDraftId: "fd-1",
        uiDraftId: "ud-1",
        fileValue: "Aurora",
        uiDraftValue: "Other",
        baseValue: "Legacy",
        status: "open" as const,
        createdAt: "2026-08-07T12:00:00.000Z",
        fileId: "file-board",
        fileName: "aurora-board.dts",
        nodePath: "board",
        propertyName: "model"
      }
    ]);
    const listAuditEvents = vi.fn(async () => ({
      items: [
        {
          id: "evt-conflict",
          organizationId: "org-chargelab",
          projectId: PROJECT.id,
          actorUserId: "user-ada",
          actorType: "user" as const,
          actorName: "Ada Admin",
          app: "parameters",
          kind: "parameter-file-conflict-open",
          action: "resolve",
          severity: "High" as const,
          targetType: "parameter-file-conflict",
          targetId: "conflict-activity",
          metadata: { fileId: "file-board", fileName: "aurora-board.dts", parameterName: "model" },
          traceId: "trace-conflict",
          createdAt: "2026-08-07T04:03:00.000Z"
        }
      ],
      nextCursor: null
    }));

    renderWorkbench({
      search: "?configSet=cs-default&file=file-board",
      syncSearch: true,
      listAuditEvents,
      fileRepository: createFileRepository({ listConflicts })
    });

    await screen.findByRole("heading", { name: "aurora-board.dts" });
    await openWorkbenchMoreMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "项目活动" }));
    await screen.findByLabelText("项目活动事件");
    fireEvent.click(screen.getByRole("button", { name: /裁决 · 文件冲突 · aurora-board\.dts/i }));

    const tasks = await openLocalChanges();
    expect(within(tasks).queryByRole("button", { name: "处理 1 项冲突" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: /^冲突/ }));
    expect(await screen.findByLabelText("冲突仲裁")).toBeInTheDocument();
    expect(screen.queryByText(/冲突裁决面板尚未接入/)).not.toBeInTheDocument();
  });

});

describe("configuration-workbench stylesheet", () => {
  const featurePath = "src/components/project-configuration-workbench/configuration-workbench.css";

  it("owns the project configuration workbench rules next to the feature module", () => {
    const css = readStylesheet(featurePath);

    expect(hasRule(css, ".configuration-workbench")).toBe(true);
    expect(hasRule(css, ".workbench-conflict-dock")).toBe(true);
    expect(hasRule(css, ".configuration-workbench__revision-gate")).toBe(true);
    expect(hasRule(css, ".main-content:has(.param-admin-shell--configuration-workbench)")).toBe(true);
    expect(hasRule(css, ".param-admin-shell--configuration-workbench")).toBe(true);
    expect(hasAtRule(css, "@media (max-width: 1024px)")).toBe(true);
    expect(hasAtRule(css, "@media (max-width: 768px)")).toBe(true);
    expect(hasAtRule(css, "@media (max-width: 460px)")).toBe(true);
    expect(hasRule(css, ".configuration-workbench__body")).toBe(false);
    expect(declarationsFor(readStylesheet("src/components/layout/navigator-workbench.css"), ".navigator-workbench__navigator")["border-radius"])
      .toBe("var(--radius-md)");

    expect(
      declarationsFor(
        css,
        ".project-primary-dts-viewer__line.has-session-change .project-primary-dts-viewer__line-number"
      )["box-shadow"]
    ).toBe("var(--shadow-status-accent)");
    expect(declarationsFor(readStylesheet("src/styles.css"), ":root")["--shadow-status-accent"])
      .toBe("inset 3px 0 0 var(--accent)");
  });

  it("leaves shared workbench chrome in styles.css", () => {
    const css = readStylesheet("src/styles.css");

    expect(hasRule(css, ".workbench-page")).toBe(true);
    expect(hasRule(css, ".workbench-main")).toBe(true);
    expect(hasRule(css, ".dts-parameter-workbench")).toBe(true);
    expect(hasRule(css, ".configuration-workbench")).toBe(false);
    expect(hasRule(css, ".workbench-conflict-dock")).toBe(false);
  });
});
