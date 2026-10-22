import type {
  KnowledgeListQuery,
  KnowledgeRepository,
  UpdateKnowledgeInput
} from "@/application/ports/KnowledgeRepository";
import { KnowledgeRevisionConflictError } from "@/application/ports/KnowledgeRepository";
import { buildLogDistillationDraft } from "@/domain/knowledge/distill";
import { buildReloadDistillationDraft, isReloadRunDistillable } from "@/domain/knowledge/distillReload";
import type { DtsReloadRun } from "@/domain/dtsReload/types";
import type {
  KnowledgeEntry,
  KnowledgeBatchResult,
  KnowledgeImportOutcome,
  KnowledgeImportReport,
  KnowledgeIndexState,
  KnowledgeParameterReference,
  KnowledgeRevision,
  KnowledgeSearchResult,
  KnowledgeReferenceSuggestion
} from "@/domain/knowledge/types";
import type { ParameterSpecReferenceLifecycle } from "@/domain/knowledge/types";
import type { LogRecord } from "@/domain/prototype/types";
import { activeDefinition } from "@/application/parameter-catalog/fixtures";
import { mockApiError } from "./mockApiError";

const MOCK_KNOWLEDGE_NOW = "2026-08-12T00:00:00.000Z";
const MOCK_USER_ID = "u-xu-yun";

const MOCK_SUGGESTION_DEFINITIONS = [
  { definitionId: activeDefinition.id, propertyKey: activeDefinition.propertyKey, displayName: activeDefinition.currentRevision.displayName,
    driverModule: activeDefinition.subject.canonicalName, lifecycle: "active" as const },
  { definitionId: "mock-definition-gpio-b", propertyKey: activeDefinition.propertyKey, displayName: "GPIO interrupt B",
    driverModule: "module-b", lifecycle: "deprecated" as const },
  { definitionId: "mock-definition-gpio-c", propertyKey: activeDefinition.propertyKey, displayName: "GPIO interrupt C",
    driverModule: "module-c", lifecycle: "active" as const }
];
type MockSuggestion = KnowledgeReferenceSuggestion & { status: "pending" | "accepted" | "dismissed" | "withdrawn" };
type MockExtractedFile = { text: string; pageOffsets?: number[] };

function sourceBytes(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/**
 * Definition chip data aligned with the `mockParameterTopologyRepository`
 * spec fixtures, so mock-mode reference chips and the picker stay consistent
 * (same ADR-0002 fixture-alignment pattern as `sourceLogId: "log-auth"`).
 */
const MOCK_SPEC_CATALOG: Record<string, { propertyKey: string; displayName: string | null; driverModule: string | null; lifecycle: ParameterSpecReferenceLifecycle }> = {
  "spec-sc8562-gpio-int": {
    propertyKey: "gpio_int",
    displayName: "SC8562 GPIO interrupt",
    driverModule: "sc8562",
    lifecycle: "active"
  },
  "spec-mt5788-gpio-int": {
    propertyKey: "gpio_int",
    displayName: "MT5788 GPIO interrupt",
    driverModule: "mt5788",
    lifecycle: "active"
  },
  "spec-draft-mystery": {
    propertyKey: "mystery_prop",
    displayName: "Mystery property (draft)",
    driverModule: null,
    lifecycle: "draft"
  },
  "spec-deprecated-legacy": {
    propertyKey: "legacy_status",
    displayName: "Legacy status (deprecated)",
    driverModule: null,
    lifecycle: "deprecated"
  }
};

function mockReference(specId: string, createdByUserId: string): KnowledgeParameterReference {
  const chip = MOCK_SPEC_CATALOG[specId] ?? {
    propertyKey: specId,
    displayName: null,
    driverModule: null,
    lifecycle: "active" as const
  };
  return { specId, ...chip, createdByUserId, createdAt: MOCK_KNOWLEDGE_NOW };
}

type MockIndexRecord = {
  status: KnowledgeIndexState;
  error: string | null;
  indexedRevisionNumber: number | null;
  chunkCount: number;
};

type MockStore = {
  entries: KnowledgeEntry[];
  revisions: KnowledgeRevision[];
  files: Map<string, File>;
  index: Map<string, MockIndexRecord>;
  suggestions: Map<string, MockSuggestion[]>;
  extractedFiles: Map<string, MockExtractedFile>;
  counter: number;
};

export type MockKnowledgeCapability = {
  userId?: string;
  canManage?: boolean;
  /** Mock distillation source: resolves a frontend log record by id (App wires state.logs). */
  getLogRecord?: (logId: string) => LogRecord | undefined;
  /**
   * Mock distillation source #2: resolves a reload run by id. The app wires
   * this to the runtime's mock DtsReloadRepository instance so both ports
   * describe the same device story (ADR-0002 port parity).
   */
  getReloadRun?: (runId: string) => Promise<DtsReloadRun | undefined> | DtsReloadRun | undefined;
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function searchableText(entry: KnowledgeEntry): string {
  return [entry.title, entry.tags.join(" "), entry.contentMarkdown ?? "", entry.file?.fileName ?? ""].join("\n");
}

/**
 * Mock stand-in for the server's trigram relevance cutoff: character bigrams
 * (CJK-friendly) with a containment score — how much of the derived
 * conclusion/impact query the entry text covers. Same published-only and
 * cutoff semantics as the API implementation.
 */
const MOCK_RELATED_MIN_SCORE = 0.25;
const MOCK_RELATED_LIMIT = 5;

function characterBigrams(text: string): Set<string> {
  const normalized = text.replace(/\s+/g, "").toLocaleLowerCase();
  const grams = new Set<string>();
  for (let index = 0; index < normalized.length - 1; index += 1) {
    grams.add(normalized.slice(index, index + 2));
  }
  return grams;
}

function bigramContainment(queryGrams: Set<string>, textGrams: Set<string>): number {
  if (queryGrams.size === 0) return 0;
  let shared = 0;
  for (const gram of queryGrams) {
    if (textGrams.has(gram)) shared += 1;
  }
  return shared / queryGrams.size;
}

export function createMockKnowledgeFixtures(): {
  entries: KnowledgeEntry[]; revisions: KnowledgeRevision[];
  suggestions?: Record<string, KnowledgeReferenceSuggestion[]>;
  extractedFiles?: Record<string, MockExtractedFile>;
} {
  const publishedMarkdown: KnowledgeEntry = {
    origin: "authored",
    id: "mock-kb-1",
    title: "快充温控调参经验",
    contentForm: "markdown",
    status: "published",
    tags: ["project-aurora", "快充", "温控"],
    sourceType: "human",
    sourceSessionId: null,
    sourceLogId: null,
    sourceReloadRunId: null,
    createdByUserId: MOCK_USER_ID,
    headRevisionNumber: 2,
    createdAt: "2026-08-01T02:00:00.000Z",
    updatedAt: "2026-08-10T06:30:00.000Z",
    publishedAt: "2026-08-02T09:00:00.000Z",
    archivedAt: null,
    contentMarkdown:
      "# 快充温控调参经验\n\n当电池温度超过 45 度时,按 0.5A 步长下调快充电流。\n\n- 观察 NTC 采样间隔\n- 记录降流后的温升斜率\n- 核对 gpio-int 配置",
    file: null,
    parameterReferences: [
      mockReference("spec-sc8562-gpio-int", MOCK_USER_ID),
      // Deprecated definition: the chip stays with an honest 已废弃 badge.
      mockReference("spec-deprecated-legacy", MOCK_USER_ID)
    ]
  };

  const draftMarkdown: KnowledgeEntry = {
    origin: "authored",
    id: "mock-kb-2",
    title: "SC8562 充电泵比率切换草稿",
    contentForm: "markdown",
    status: "draft",
    tags: ["硬件", "sc8562"],
    sourceType: "human",
    sourceSessionId: null,
    sourceLogId: null,
    sourceReloadRunId: null,
    createdByUserId: MOCK_USER_ID,
    headRevisionNumber: 1,
    createdAt: "2026-08-11T03:00:00.000Z",
    updatedAt: "2026-08-11T03:00:00.000Z",
    publishedAt: null,
    archivedAt: null,
    contentMarkdown: "## 待验证\n\n2:1 与 4:1 模式切换阈值仍需实验数据。",
    file: null,
    parameterReferences: [mockReference("spec-sc8562-gpio-int", MOCK_USER_ID)]
  };

  const publishedFile: KnowledgeEntry = {
    origin: "uploaded",
    id: "mock-kb-3",
    title: "MT5788 无线充手册摘录",
    contentForm: "file",
    status: "published",
    tags: ["project-nebula", "无线充"],
    sourceType: "human",
    sourceSessionId: null,
    sourceLogId: null,
    sourceReloadRunId: null,
    createdByUserId: "u-li-fang",
    headRevisionNumber: 1,
    createdAt: "2026-08-05T08:00:00.000Z",
    updatedAt: "2026-08-05T08:00:00.000Z",
    publishedAt: "2026-08-05T08:10:00.000Z",
    archivedAt: null,
    contentMarkdown: null,
    file: {
      id: "mock-kb-3-file",
      fileName: "mt5788-manual.pdf",
      contentType: "application/pdf",
      sizeBytes: 128_000,
      extractionStatus: "succeeded",
      extractionError: null,
      createdAt: "2026-08-05T08:00:00.000Z"
    },
    parameterReferences: []
  };

  const failedExtractionFile: KnowledgeEntry = {
    origin: "uploaded",
    id: "mock-kb-4",
    title: "旧版工艺规范(.doc)",
    contentForm: "file",
    status: "draft",
    tags: ["流程规范"],
    sourceType: "human",
    sourceSessionId: null,
    sourceLogId: null,
    sourceReloadRunId: null,
    createdByUserId: MOCK_USER_ID,
    headRevisionNumber: 1,
    createdAt: "2026-08-09T01:00:00.000Z",
    updatedAt: "2026-08-09T01:00:00.000Z",
    publishedAt: null,
    archivedAt: null,
    contentMarkdown: null,
    file: {
      id: "mock-kb-4-file",
      fileName: "legacy-process.doc",
      contentType: "application/msword",
      sizeBytes: 64_000,
      extractionStatus: "failed",
      extractionError: "Legacy .doc binaries are not supported for text extraction; convert the document to .docx and replace the file.",
      createdAt: "2026-08-09T01:00:00.000Z"
    },
    parameterReferences: []
  };

  const archivedMarkdown: KnowledgeEntry = {
    origin: "authored",
    id: "mock-kb-5",
    title: "已归档:旧平台日志格式说明",
    contentForm: "markdown",
    status: "archived",
    tags: ["日志"],
    sourceType: "human",
    sourceSessionId: null,
    sourceLogId: null,
    sourceReloadRunId: null,
    createdByUserId: "u-li-fang",
    headRevisionNumber: 3,
    createdAt: "2026-07-01T02:00:00.000Z",
    updatedAt: "2026-08-08T02:00:00.000Z",
    publishedAt: "2026-07-02T02:00:00.000Z",
    archivedAt: "2026-08-08T02:00:00.000Z",
    contentMarkdown: "旧平台日志格式已下线,保留历史供追溯。",
    file: null,
    parameterReferences: []
  };

  // Agent-draft publish-queue states: one draft distilled in the current
  // user's session (publishable by them), one from another engineer's session
  // (manage-only governance) — so the /knowledge-admin queue has both rows.
  const agentDraftOwn: KnowledgeEntry = {
    origin: "agent-drafted",
    id: "mock-kb-agent-1",
    title: "小泽沉淀:充电异常断电根因排查",
    contentForm: "markdown",
    status: "draft",
    tags: ["日志分析", "严重"],
    sourceType: "agent",
    sourceSessionId: "mock-xiaoze-session-1",
    sourceLogId: "log-auth",
    sourceReloadRunId: null,
    createdByUserId: MOCK_USER_ID,
    headRevisionNumber: 1,
    createdAt: "2026-08-11T09:20:00.000Z",
    updatedAt: "2026-08-11T09:20:00.000Z",
    publishedAt: null,
    archivedAt: null,
    contentMarkdown:
      "## 结论\n\n充电异常断电与鉴权重试风暴相关,建议限制重试频率。\n\n(由小泽在会话中沉淀,待人工审阅发布。)",
    file: null,
    parameterReferences: []
  };

  const agentDraftOther: KnowledgeEntry = {
    origin: "agent-drafted",
    id: "mock-kb-agent-2",
    title: "小泽沉淀:无线充异物检测误报处置",
    contentForm: "markdown",
    status: "draft",
    tags: ["小泽沉淀"],
    sourceType: "agent",
    sourceSessionId: "mock-xiaoze-session-2",
    sourceLogId: null,
    sourceReloadRunId: null,
    createdByUserId: "u-li-fang",
    headRevisionNumber: 1,
    createdAt: "2026-08-11T11:05:00.000Z",
    updatedAt: "2026-08-11T11:05:00.000Z",
    publishedAt: null,
    archivedAt: null,
    contentMarkdown: "## 结论\n\nFOD 阈值偏严导致金属边框误报,建议按整机型号分档配置。",
    file: null,
    parameterReferences: []
  };

  // Related to the completed mock log (log-auth, PD negotiation): the log
  // result page's related-knowledge section has a real hit in mock mode.
  const publishedPdHandbook: KnowledgeEntry = {
    origin: "authored",
    id: "mock-kb-8",
    title: "PD 快充协议兼容性排查手册",
    contentForm: "markdown",
    status: "published",
    tags: ["快充", "PD 协议"],
    sourceType: "human",
    sourceSessionId: null,
    sourceLogId: null,
    sourceReloadRunId: null,
    createdByUserId: "u-li-fang",
    headRevisionNumber: 1,
    createdAt: "2026-08-06T03:00:00.000Z",
    updatedAt: "2026-08-06T03:00:00.000Z",
    publishedAt: "2026-08-06T03:10:00.000Z",
    archivedAt: null,
    contentMarkdown:
      "# PD 快充协议兼容性排查手册\n\n典型健康样本:PD 协商在 9V/3A 档位稳定完成,未出现握手重试,说明 SourceCap 与 Request 匹配良好。\n\n- 出现握手重试时优先复核适配器白名单\n- 记录 PD 协商日志中的 SourceCap 档位与 Accept 时序",
    file: null,
    parameterReferences: []
  };

  const revisions: KnowledgeRevision[] = [
    {
      id: "mock-kb-1-r1",
      entryId: "mock-kb-1",
      revisionNumber: 1,
      title: "快充温控调参经验",
      tags: ["project-aurora", "快充"],
      contentMarkdown: "# 快充温控调参经验\n\n初版:超温后直接降到 2A。",
      fileId: null,
      authorUserId: MOCK_USER_ID,
      restoredFromRevisionId: null,
      createdAt: "2026-08-01T02:00:00.000Z"
    },
    {
      id: "mock-kb-1-r2",
      entryId: "mock-kb-1",
      revisionNumber: 2,
      title: "快充温控调参经验",
      tags: ["project-aurora", "快充", "温控"],
      contentMarkdown: publishedMarkdown.contentMarkdown ?? "",
      fileId: null,
      authorUserId: MOCK_USER_ID,
      restoredFromRevisionId: null,
      createdAt: "2026-08-10T06:30:00.000Z"
    },
    {
      id: "mock-kb-2-r1",
      entryId: "mock-kb-2",
      revisionNumber: 1,
      title: draftMarkdown.title,
      tags: draftMarkdown.tags,
      contentMarkdown: draftMarkdown.contentMarkdown ?? "",
      fileId: null,
      authorUserId: MOCK_USER_ID,
      restoredFromRevisionId: null,
      createdAt: draftMarkdown.createdAt
    },
    {
      id: "mock-kb-3-r1",
      entryId: "mock-kb-3",
      revisionNumber: 1,
      title: publishedFile.title,
      tags: publishedFile.tags,
      contentMarkdown: null,
      fileId: "mock-kb-3-file",
      authorUserId: "u-li-fang",
      restoredFromRevisionId: null,
      createdAt: publishedFile.createdAt
    },
    {
      id: "mock-kb-4-r1",
      entryId: "mock-kb-4",
      revisionNumber: 1,
      title: failedExtractionFile.title,
      tags: failedExtractionFile.tags,
      contentMarkdown: null,
      fileId: "mock-kb-4-file",
      authorUserId: MOCK_USER_ID,
      restoredFromRevisionId: null,
      createdAt: failedExtractionFile.createdAt
    },
    {
      id: "mock-kb-5-r3",
      entryId: "mock-kb-5",
      revisionNumber: 3,
      title: archivedMarkdown.title,
      tags: archivedMarkdown.tags,
      contentMarkdown: archivedMarkdown.contentMarkdown ?? "",
      fileId: null,
      authorUserId: "u-li-fang",
      restoredFromRevisionId: null,
      createdAt: archivedMarkdown.updatedAt
    },
    {
      id: "mock-kb-agent-1-r1",
      entryId: "mock-kb-agent-1",
      revisionNumber: 1,
      title: agentDraftOwn.title,
      tags: agentDraftOwn.tags,
      contentMarkdown: agentDraftOwn.contentMarkdown ?? "",
      fileId: null,
      authorUserId: MOCK_USER_ID,
      restoredFromRevisionId: null,
      createdAt: agentDraftOwn.createdAt
    },
    {
      id: "mock-kb-agent-2-r1",
      entryId: "mock-kb-agent-2",
      revisionNumber: 1,
      title: agentDraftOther.title,
      tags: agentDraftOther.tags,
      contentMarkdown: agentDraftOther.contentMarkdown ?? "",
      fileId: null,
      authorUserId: "u-li-fang",
      restoredFromRevisionId: null,
      createdAt: agentDraftOther.createdAt
    },
    {
      id: "mock-kb-8-r1",
      entryId: "mock-kb-8",
      revisionNumber: 1,
      title: publishedPdHandbook.title,
      tags: publishedPdHandbook.tags,
      contentMarkdown: publishedPdHandbook.contentMarkdown ?? "",
      fileId: null,
      authorUserId: "u-li-fang",
      restoredFromRevisionId: null,
      createdAt: publishedPdHandbook.createdAt
    }
  ];

  return {
    entries: [
      publishedMarkdown,
      draftMarkdown,
      publishedFile,
      failedExtractionFile,
      archivedMarkdown,
      agentDraftOwn,
      agentDraftOther,
      publishedPdHandbook
    ],
    revisions,
    extractedFiles: { [publishedFile.file!.id]: { text: "PDF 参数说明\ngpio-int gpio-int", pageOffsets: [0, 9] } }
  };
}

export function createMockKnowledgeRepository(
  capability: MockKnowledgeCapability = {},
  fixtures = createMockKnowledgeFixtures()
): KnowledgeRepository {
  const userId = capability.userId ?? MOCK_USER_ID;
  const canManage = capability.canManage ?? true;
  const imports = new Map<string, KnowledgeImportReport>();
  const sources = new Map<string, { bytes: string; contentMarkdown: string | null; fileId: string | null }>();
  const requireImport = (id: string) => {
    const batch = imports.get(id);
    if (!batch) throw mockApiError("NOT_FOUND", "找不到导入批次。");
    return batch;
  };
  const store: MockStore = {
    entries: fixtures.entries.map(clone),
    revisions: fixtures.revisions.map(clone),
    counter: fixtures.entries.length,
    files: new Map(),
    index: new Map(),
    suggestions: new Map(Object.entries(fixtures.suggestions ?? {}).map(([id, items]) => [id, items.map((item) => ({ ...clone(item), status: "pending" }))])),
    extractedFiles: new Map(Object.entries(fixtures.extractedFiles ?? {}).map(([id, source]) => [id, clone(source)]))
  };

  function detectSuggestions(entry: KnowledgeEntry, revisionId = `${entry.id}-r${entry.headRevisionNumber}`) {
    if (entry.status === "archived" || (entry.contentForm === "file" && entry.file?.extractionStatus !== "succeeded")) return;
    const extracted = entry.file ? store.extractedFiles.get(entry.file.id) : undefined;
    const text = entry.contentForm === "markdown" ? entry.contentMarkdown ?? "" : extracted?.text ?? "";
    const items = store.suggestions.get(entry.id) ?? [];
    for (const definition of MOCK_SUGGESTION_DEFINITIONS) {
      const existing = items.find((item) => item.definitionId === definition.definitionId);
      if (existing && ["accepted", "dismissed"].includes(existing.status)) continue;
      const escaped = definition.propertyKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const matches = [...text.matchAll(new RegExp(`(?<![A-Za-z0-9_,.+?#-])${escaped}(?![A-Za-z0-9_,.+?#-])`, "g"))];
      const first = matches[0];
      if (!first || entry.parameterReferences.some((reference) => reference.kind === "definition" && reference.definitionId === definition.definitionId)) {
        if (existing) existing.status = "withdrawn";
        continue;
      }
      const next: MockSuggestion = { ...definition, mentionCount: matches.length,
        snippet: text.slice(Math.max(0, first.index - 80), first.index + definition.propertyKey.length + 120),
        page: entry.file?.contentType === "application/pdf"
          ? extracted?.pageOffsets?.reduce<number | null>((page, start, index) => start <= first.index ? index + 1 : page, null) ?? null : null,
        detectedRevisionId: revisionId, status: "pending" };
      if (existing) Object.assign(existing, next); else items.push(next);
    }
    store.suggestions.set(entry.id, items);
  }

  function pendingSuggestions(entry: KnowledgeEntry): MockSuggestion[] {
    return entry.status === "archived" ? [] : (store.suggestions.get(entry.id) ?? []).filter((item) => item.status === "pending"
      && !entry.parameterReferences.some((reference) => reference.kind === "definition" && reference.definitionId === item.definitionId))
      .sort((a, b) => b.mentionCount - a.mentionCount || a.propertyKey.localeCompare(b.propertyKey) || a.definitionId.localeCompare(b.definitionId));
  }

  function requireSuggestionEntry(entryId: string) {
    const entry = requireEntry(entryId);
    if (!canManage && entry.createdByUserId !== userId) throw mockApiError("FORBIDDEN", "Suggestions require entry governance.");
    return entry;
  }

  function acceptSuggestion(entry: KnowledgeEntry, item: MockSuggestion) {
    if (!entry.parameterReferences.some((reference) => reference.kind === "definition" && reference.definitionId === item.definitionId)) {
      entry.parameterReferences.push({ kind: "definition", definitionId: item.definitionId, availability: "current",
        propertyKey: item.propertyKey, displayName: item.displayName, driverModule: item.driverModule, lifecycle: item.lifecycle,
        createdByUserId: userId, createdAt: MOCK_KNOWLEDGE_NOW });
    }
    item.status = "accepted";
  }

  for (const entry of store.entries) if (!store.suggestions.has(entry.id)) detectSuggestions(entry);

  // Simulated index states: published entries are indexed; one carries a
  // deterministic failure so the admin health UI has a retry path to show.
  for (const entry of store.entries) {
    if (entry.status !== "published") continue;
    if (entry.id === "mock-kb-3") {
      store.index.set(entry.id, {
        status: "failed",
        error: "Embedding failed (FTS chunks kept): Embedding API timed out after 10000ms.",
        indexedRevisionNumber: entry.headRevisionNumber,
        chunkCount: 3
      });
    } else {
      store.index.set(entry.id, {
        status: "succeeded",
        error: null,
        indexedRevisionNumber: entry.headRevisionNumber,
        chunkCount: 2
      });
    }
  }

  function markIndexed(entry: KnowledgeEntry) {
    if (entry.status === "published") {
      store.index.set(entry.id, {
        status: "succeeded",
        error: null,
        indexedRevisionNumber: entry.headRevisionNumber,
        chunkCount: Math.max(1, Math.ceil((entry.contentMarkdown ?? "").length / 400))
      });
    } else if (store.index.has(entry.id)) {
      store.index.set(entry.id, {
        status: "succeeded",
        error: null,
        indexedRevisionNumber: entry.headRevisionNumber,
        chunkCount: 0
      });
    }
  }

  function findEntry(entryId: string): KnowledgeEntry | undefined {
    const entry = store.entries.find((item) => item.id === entryId);
    if (!entry) return undefined;
    if (entry.status === "draft" && !canManage && entry.createdByUserId !== userId) {
      return undefined;
    }
    return entry;
  }

  function requireEntry(entryId: string): KnowledgeEntry {
    const entry = findEntry(entryId);
    if (!entry) throw mockApiError("NOT_FOUND", `Knowledge entry not found: ${entryId}`, { entryId });
    return entry;
  }

  function appendRevision(entry: KnowledgeEntry, patch: Partial<KnowledgeRevision> = {}): KnowledgeRevision {
    const revision: KnowledgeRevision = {
      id: `${entry.id}-r${entry.headRevisionNumber + 1}`,
      entryId: entry.id,
      revisionNumber: entry.headRevisionNumber + 1,
      title: entry.title,
      tags: [...entry.tags],
      contentMarkdown: entry.contentMarkdown,
      fileId: entry.file?.id ?? null,
      authorUserId: userId,
      restoredFromRevisionId: null,
      createdAt: MOCK_KNOWLEDGE_NOW,
      ...patch
    };
    store.revisions.push(revision);
    detectSuggestions(entry, revision.id);
    return revision;
  }

  const repository: KnowledgeRepository = {
    async list(query?: KnowledgeListQuery) {
      const items = store.entries.filter((entry) => {
        if (query?.pendingSuggestions && ((!canManage && entry.createdByUserId !== userId) || !pendingSuggestions(entry).length)) return false;
        if (query?.governable && (entry.status === "archived" || (!canManage && entry.createdByUserId !== userId))) return false;
        if (entry.status === "draft" && !canManage && entry.createdByUserId !== userId) return false;
        if (query?.status && entry.status !== query.status) return false;
        if (query?.contentForm && entry.contentForm !== query.contentForm) return false;
        if (query?.sourceType && entry.sourceType !== query.sourceType) return false;
        if (query?.origin && entry.origin !== query.origin) return false;
        if (query?.tag && !entry.tags.includes(query.tag)) return false;
        if (query?.q && !entry.title.toLocaleLowerCase().includes(query.q.toLocaleLowerCase())) return false;
        return true;
      });
      const offset = query?.offset ?? 0;
      return { items: items.slice(offset, offset + (query?.limit ?? 100)).map((entry) => {
        const copy = clone(entry);
        delete copy.pendingSuggestionCount;
        return canManage || entry.createdByUserId === userId ? { ...copy, pendingSuggestionCount: pendingSuggestions(entry).length } : copy;
      }) };
    },

    async get(entryId) {
      const entry = findEntry(entryId);
      return entry ? clone(entry) : null;
    },

    async getBinding(entryId) {
      const entry = findEntry(entryId);
      return { entry: entry ? clone(entry) : null, deleted: !store.entries.some((item) => item.id === entryId) };
    },

    async createMarkdown(input) {
      store.counter += 1;
      const entry: KnowledgeEntry = {
        origin: input.origin ?? "authored",
        id: `mock-kb-${store.counter}`,
        title: input.title,
        contentForm: "markdown",
        status: "draft",
        tags: [...input.tags],
        sourceType: "human",
        sourceSessionId: null,
        sourceLogId: null,
        sourceReloadRunId: null,
        createdByUserId: userId,
        headRevisionNumber: 0,
        createdAt: MOCK_KNOWLEDGE_NOW,
        updatedAt: MOCK_KNOWLEDGE_NOW,
        publishedAt: null,
        archivedAt: null,
        contentMarkdown: input.contentMarkdown,
        file: null,
        parameterReferences: []
      };
      appendRevision(entry);
      entry.headRevisionNumber = 1;
      store.entries = [entry, ...store.entries];
      return clone(entry);
    },

    async openImport(tags) {
      if (tags.length > 20 || tags.some((tag) => !tag.trim() || tag.length > 60)) {
        throw mockApiError("VALIDATION_FAILED", "标签最多 20 个，每个标签不超过 60 字符。");
      }
      const id = crypto.randomUUID();
      imports.set(id, { id, tags: [...new Set(tags.map((tag) => tag.trim()))], completed: false, documentCount: 0, totalBytes: 0,
        counts: { created: 0, duplicate_skipped: 0, unsupported_skipped: 0, extraction_failed: 0, rejected: 0 }, outcomes: [] });
      return { id };
    },
    async importDocument(batchId, input) {
      const batch = requireImport(batchId);
      if (batch.completed) throw mockApiError("CONFLICT", "导入批次已完成。");
      if (input.file.size > 20 * 1024 * 1024) throw mockApiError("VALIDATION_FAILED", "文件超过 20 MB 上限。");
      if (batch.documentCount >= 200) throw mockApiError("VALIDATION_FAILED", "每批最多导入 200 个文档。");
      if (batch.totalBytes + input.file.size > 100 * 1024 * 1024) throw mockApiError("VALIDATION_FAILED", "每批文件总大小不能超过 100 MB。");
      const outcome: KnowledgeImportOutcome = { id: crypto.randomUUID(), relativePath: input.relativePath,
        status: "unsupported_skipped", entryId: null, error: null };
      batch.documentCount++;
      batch.totalBytes += input.file.size;
      if (/\.(pdf|docx|txt|md)$/i.test(input.file.name)) {
        const bytes = await sourceBytes(input.file);
        const match = store.entries.find((entry) => {
          const source = sources.get(entry.id);
          return findEntry(entry.id) && source?.bytes === bytes && source.contentMarkdown === entry.contentMarkdown && source.fileId === (entry.file?.id ?? null);
        });
        if (match) {
          outcome.status = "duplicate_skipped";
          outcome.entryId = match.id;
        } else {
          try {
            const folderTags = input.relativePath.split("/").slice(0, -1).map((tag) => tag.trim().slice(0, 60)).filter(Boolean);
            const entry = await repository.createFile({ file: input.file, title: input.file.name.slice(0, 200),
              tags: [...new Set([...batch.tags, ...folderTags])].slice(0, 20) });
            outcome.status = entry.file?.extractionStatus === "failed" ? "extraction_failed" : "created";
            outcome.entryId = entry.id;
            outcome.error = entry.file?.extractionError ?? null;
          } catch (error) {
            outcome.status = "rejected";
            outcome.error = error instanceof Error ? error.message : "导入失败，请重试。";
          }
        }
      }
      batch.outcomes.push(outcome);
      batch.counts[outcome.status]++;
      return clone(outcome);
    },
    async importArchive(batchId, file) {
      const batch = requireImport(batchId);
      if (batch.completed) throw mockApiError("CONFLICT", "导入批次已完成。");
      if (file.size > 100 * 1024 * 1024) throw mockApiError("VALIDATION_FAILED", "ZIP 压缩包不能超过 100 MB。");
      const { default: JSZip } = await import("jszip");
      const zip = await JSZip.loadAsync(await sourceBytes(file), { base64: true });
      const documents: { file: File; relativePath: string }[] = [];
      for (const entry of Object.values(zip.files)) {
        const original = (entry as typeof entry & { unsafeOriginalName?: string }).unsafeOriginalName ?? entry.name;
        if (/^[a-z]:/i.test(original) || /[\\\u0000-\u001f]/.test(original)
          || original.replace(/\/$/, "").split("/").some((part) => !part || part === "." || part === "..")
          || original.replace(/\/$/, "").split("/").length > (entry.dir ? 20 : 21)) {
          throw mockApiError("VALIDATION_FAILED", "ZIP 文档路径无效或嵌套超过 20 层。");
        }
        if (entry.dir || entry.name.split("/").some((part) => part === "__MACOSX" || part === ".DS_Store")) continue;
        documents.push({ relativePath: entry.name, file: new File([await entry.async("uint8array") as BlobPart], entry.name.split("/").at(-1)!) });
      }
      if (documents.some((document) => document.file.size > 20 * 1024 * 1024)) throw mockApiError("VALIDATION_FAILED", "文件超过 20 MB 上限。");
      if (batch.documentCount + documents.length > 200) throw mockApiError("VALIDATION_FAILED", "每批最多导入 200 个文档。");
      if (batch.totalBytes + documents.reduce((total, document) => total + document.file.size, 0) > 100 * 1024 * 1024) {
        throw mockApiError("VALIDATION_FAILED", "每批文件总大小不能超过 100 MB。");
      }
      const outcomes: KnowledgeImportOutcome[] = [];
      for (const document of documents) outcomes.push(await repository.importDocument(batchId, document));
      return { outcomes };
    },
    async getImport(batchId) { return clone(requireImport(batchId)); },
    async completeImport(batchId) {
      const batch = requireImport(batchId);
      batch.completed = true;
      return clone(batch);
    },

    async createFile(input) {
      if (!input.file.size || input.file.size > 20 * 1024 * 1024) throw mockApiError("VALIDATION_FAILED", "文件须为非空且不超过 20 MB。");
      const source = await sourceBytes(input.file);
      if (/\.(md|txt)$/i.test(input.file.name)) {
        const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as ArrayBuffer);
          reader.onerror = () => reject(reader.error);
          reader.readAsArrayBuffer(input.file);
        });
        let contentMarkdown: string;
        try {
          contentMarkdown = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
        } catch {
          throw mockApiError("VALIDATION_FAILED", "文本文件必须使用有效的 UTF-8 编码，请转换编码后重新上传。");
        }
        if (contentMarkdown.length > 200_000) {
          throw mockApiError("VALIDATION_FAILED", "正文超过知识库 200,000 字符上限，请精简后重新上传。");
        }
        const entry = await repository.createMarkdown({ title: input.title, tags: input.tags, contentMarkdown, origin: "uploaded" });
        sources.set(entry.id, { bytes: source, contentMarkdown, fileId: null });
        return entry;
      }
      store.counter += 1;
      const id = `mock-kb-${store.counter}`;
      const isLegacyDoc = input.file.name.toLocaleLowerCase().endsWith(".doc");
      const entry: KnowledgeEntry = {
        origin: "uploaded",
        id,
        title: input.title,
        contentForm: "file",
        status: "draft",
        tags: [...input.tags],
        sourceType: "human",
        sourceSessionId: null,
        sourceLogId: null,
        sourceReloadRunId: null,
        createdByUserId: userId,
        headRevisionNumber: 0,
        createdAt: MOCK_KNOWLEDGE_NOW,
        updatedAt: MOCK_KNOWLEDGE_NOW,
        publishedAt: null,
        archivedAt: null,
        contentMarkdown: null,
        file: {
          id: `${id}-file`,
          fileName: input.file.name,
          contentType: input.file.type || "text/plain",
          sizeBytes: input.file.size,
          extractionStatus: isLegacyDoc ? "failed" : "succeeded",
          extractionError: isLegacyDoc
            ? "Legacy .doc binaries are not supported for text extraction; convert the document to .docx and replace the file."
            : null,
          createdAt: MOCK_KNOWLEDGE_NOW
        },
        parameterReferences: []
      };
      store.files.set(`${id}-file`, input.file);
      sources.set(id, { bytes: source, contentMarkdown: null, fileId: `${id}-file` });
      appendRevision(entry);
      entry.headRevisionNumber = 1;
      store.entries = [entry, ...store.entries];
      return clone(entry);
    },

    async distillFromLog(logId) {
      const log = capability.getLogRecord?.(logId);
      if (!log) {
        throw mockApiError("NOT_FOUND", `Log record not found: ${logId}`, { logId });
      }
      if (log.status !== "Complete") {
        throw mockApiError("INTERNAL_ERROR", "只有已完成的日志分析才能沉淀为知识。");
      }
      const draft = buildLogDistillationDraft(log);
      store.counter += 1;
      const entry: KnowledgeEntry = {
        origin: "distilled",
        id: `mock-kb-${store.counter}`,
        title: draft.title,
        contentForm: "markdown",
        status: "draft",
        tags: [...draft.tags],
        sourceType: "human",
        sourceSessionId: null,
        sourceLogId: log.id,
        sourceReloadRunId: null,
        createdByUserId: userId,
        headRevisionNumber: 0,
        createdAt: MOCK_KNOWLEDGE_NOW,
        updatedAt: MOCK_KNOWLEDGE_NOW,
        publishedAt: null,
        archivedAt: null,
        contentMarkdown: draft.contentMarkdown,
        file: null,
        parameterReferences: []
      };
      appendRevision(entry);
      entry.headRevisionNumber = 1;
      store.entries = [entry, ...store.entries];
      return clone(entry);
    },

    async distillFromReloadRun(runId) {
      const run = await capability.getReloadRun?.(runId);
      if (!run) {
        throw mockApiError("NOT_FOUND", `未找到重载运行：${runId}`, { runId });
      }
      if (!isReloadRunDistillable(run.status)) {
        throw mockApiError("INTERNAL_ERROR", "只有终态重载运行(已验证/不可验证/矛盾/失败)才能沉淀为知识。");
      }
      const draft = buildReloadDistillationDraft(run);
      store.counter += 1;
      const entry: KnowledgeEntry = {
        origin: "distilled",
        id: `mock-kb-${store.counter}`,
        title: draft.title,
        contentForm: "markdown",
        status: "draft",
        tags: [...draft.tags],
        sourceType: "human",
        sourceSessionId: null,
        sourceLogId: null,
        sourceReloadRunId: run.id,
        createdByUserId: userId,
        headRevisionNumber: 0,
        createdAt: MOCK_KNOWLEDGE_NOW,
        updatedAt: MOCK_KNOWLEDGE_NOW,
        publishedAt: null,
        archivedAt: null,
        contentMarkdown: draft.contentMarkdown,
        file: null,
        parameterReferences: []
      };
      appendRevision(entry);
      entry.headRevisionNumber = 1;
      store.entries = [entry, ...store.entries];
      return clone(entry);
    },

    async rejectAgentDraft(entryId) {
      const entry = requireEntry(entryId);
      if (!canManage && entry.createdByUserId !== userId) {
        throw mockApiError("FORBIDDEN", "Rejecting someone else's agent draft requires knowledge:manage.");
      }
      if (entry.status !== "draft" || entry.sourceType !== "agent") {
        throw mockApiError("INTERNAL_ERROR", "Only agent-sourced drafts can be archive-rejected.");
      }
      entry.status = "archived";
      entry.archivedAt = MOCK_KNOWLEDGE_NOW;
      entry.updatedAt = MOCK_KNOWLEDGE_NOW;
      return clone(entry);
    },

    async batch(input) {
      const results: KnowledgeBatchResult[] = [];
      for (const entryId of input.entryIds) {
        let title: string | null = null;
        try {
          const current = requireEntry(entryId);
          title = current.title;
          if (!canManage && current.createdByUserId !== userId) {
            throw mockApiError("FORBIDDEN", "仅条目作者或知识管理员可以管理此条目。");
          }
          let entry: KnowledgeEntry;
          if (input.action === "publish") entry = await this.publish(entryId);
          else if (input.action === "archive") entry = await this.archive(entryId);
          else if (input.action === "accept_suggestions") {
            if (current.status === "archived") throw mockApiError("VALIDATION_FAILED", "Archived knowledge entries cannot be edited.");
            for (const suggestion of pendingSuggestions(current)) acceptSuggestion(current, suggestion);
            entry = { ...clone(current), pendingSuggestionCount: 0 };
          }
          else {
            const requestedTags = input.tags;
            const tags = input.action === "add_tags" ? [...new Set([...current.tags, ...requestedTags])]
              : current.tags.filter((tag) => !requestedTags.includes(tag));
            if (tags.length > 20 || tags.some((tag) => !tag.length || tag.length > 60)) {
              throw mockApiError("VALIDATION_FAILED", "每条最多 20 个标签，每个标签为 1–60 个字符。");
            }
            entry = await this.update(entryId, { tags, expectedHeadRevisionNumber: current.headRevisionNumber });
          }
          results.push({ entryId, title: entry.title, status: "succeeded", entry, error: null });
        } catch (failure) {
          const error = failure as { code?: string; message?: string };
          const code = error.code ?? "INTERNAL_ERROR";
          results.push({ entryId, title, status: code === "FORBIDDEN" || code === "NOT_FOUND" ? "refused" : "failed", entry: null,
            error: { code, message: error.message ?? "操作失败。" } });
        }
      }
      return { results, summaryError: null };
    },

    async update(entryId, input: UpdateKnowledgeInput) {
      const entry = requireEntry(entryId);
      if (entry.headRevisionNumber !== input.expectedHeadRevisionNumber) {
        throw new KnowledgeRevisionConflictError(
          "知识条目已被其他保存修改,请刷新后重试。",
          input.expectedHeadRevisionNumber,
          entry.headRevisionNumber
        );
      }

      entry.title = input.title ?? entry.title;
      entry.tags = input.tags ? [...input.tags] : entry.tags;
      if (entry.contentForm === "markdown" && input.contentMarkdown !== undefined) {
        entry.contentMarkdown = input.contentMarkdown;
      }
      if (entry.contentForm === "file" && input.file) {
        const fileId = `${entry.id}-file-r${entry.headRevisionNumber + 1}`;
        entry.file = {
          id: fileId,
          fileName: input.file.name,
          contentType: input.file.type || "text/plain",
          sizeBytes: input.file.size,
          extractionStatus: input.file.name.toLocaleLowerCase().endsWith(".doc") ? "failed" : "succeeded",
          extractionError: null,
          createdAt: MOCK_KNOWLEDGE_NOW
        };
        store.files.set(fileId, input.file);
      }
      appendRevision(entry);
      entry.headRevisionNumber += 1;
      entry.updatedAt = MOCK_KNOWLEDGE_NOW;
      return clone(entry);
    },

    async publish(entryId) {
      const entry = requireEntry(entryId);
      if (entry.status !== "draft") throw mockApiError("CONFLICT", `Illegal transition: ${entry.status} -> published`, { status: entry.status });
      entry.status = "published";
      entry.publishedAt = MOCK_KNOWLEDGE_NOW;
      entry.updatedAt = MOCK_KNOWLEDGE_NOW;
      markIndexed(entry);
      return clone(entry);
    },

    async archive(entryId) {
      const entry = requireEntry(entryId);
      if (entry.status === "archived") throw mockApiError("CONFLICT", `Illegal transition: ${entry.status} -> archived`, { status: entry.status });
      entry.status = "archived";
      entry.archivedAt = MOCK_KNOWLEDGE_NOW;
      entry.updatedAt = MOCK_KNOWLEDGE_NOW;
      markIndexed(entry);
      return clone(entry);
    },

    async restore(entryId) {
      const entry = requireEntry(entryId);
      if (entry.status !== "archived") throw mockApiError("CONFLICT", `Illegal transition: ${entry.status} -> published`, { status: entry.status });
      entry.status = "published";
      entry.archivedAt = null;
      entry.updatedAt = MOCK_KNOWLEDGE_NOW;
      markIndexed(entry);
      detectSuggestions(entry);
      return clone(entry);
    },

    async hardDelete(entryId) {
      if (!canManage) throw mockApiError("FORBIDDEN", "Hard delete requires knowledge:manage.");
      requireEntry(entryId);
      store.entries = store.entries.filter((entry) => entry.id !== entryId);
      store.revisions = store.revisions.filter((revision) => revision.entryId !== entryId);
      store.index.delete(entryId);
      store.suggestions.delete(entryId);
    },

    async listRevisions(entryId) {
      requireEntry(entryId);
      return store.revisions
        .filter((revision) => revision.entryId === entryId)
        .sort((a, b) => b.revisionNumber - a.revisionNumber)
        .map(clone);
    },

    async restoreRevision(entryId, revisionId, expectedHeadRevisionNumber) {
      const entry = requireEntry(entryId);
      if (entry.status === "archived") {
        throw mockApiError("INTERNAL_ERROR", "Archived knowledge entries cannot be edited.");
      }
      if (entry.headRevisionNumber !== expectedHeadRevisionNumber) {
        throw new KnowledgeRevisionConflictError(
          "知识条目已被其他保存修改,请刷新后重试。",
          expectedHeadRevisionNumber,
          entry.headRevisionNumber
        );
      }
      const revision = store.revisions.find((item) => item.entryId === entryId && item.id === revisionId);
      if (!revision) throw mockApiError("NOT_FOUND", `Knowledge revision not found: ${revisionId}`, { revisionId });

      entry.title = revision.title;
      entry.tags = [...revision.tags];
      if (entry.contentForm === "markdown") {
        entry.contentMarkdown = revision.contentMarkdown;
      }
      appendRevision(entry, { restoredFromRevisionId: revision.id, fileId: revision.fileId });
      entry.headRevisionNumber += 1;
      entry.updatedAt = MOCK_KNOWLEDGE_NOW;
      return clone(entry);
    },

    async search(q) {
      const query = q.trim().toLocaleLowerCase();
      const retrieval = { mode: "fts_only" as const, vectorAvailable: false, embeddingConfigured: false };
      if (!query) return { items: [], retrieval };
      const items = store.entries
        .filter((entry) => entry.status === "published")
        .filter((entry) => searchableText(entry).toLocaleLowerCase().includes(query))
        .map<KnowledgeSearchResult>((entry) => {
          const text = searchableText(entry).replace(/\s+/g, " ");
          const index = text.toLocaleLowerCase().indexOf(query);
          const start = Math.max(0, index - 30);
          const headRevision = store.revisions
            .filter((revision) => revision.entryId === entry.id)
            .sort((a, b) => b.revisionNumber - a.revisionNumber)[0];
          return {
            entryId: entry.id,
            title: entry.title,
            contentForm: entry.contentForm,
            tags: [...entry.tags],
            excerpt: text.slice(start, start + 120),
            updatedAt: entry.updatedAt,
            revisionId: headRevision?.id ?? null
          };
        });
      return { items, retrieval };
    },

    async relatedToLog(logId) {
      const retrieval = { mode: "fts_only" as const, vectorAvailable: false, embeddingConfigured: false };
      const log = capability.getLogRecord?.(logId);
      if (!log) {
        throw mockApiError("NOT_FOUND", `Log record not found: ${logId}`, { logId });
      }
      if (log.status !== "Complete") {
        throw mockApiError("INTERNAL_ERROR", "只有已完成的日志分析才有相关知识。");
      }

      const query = [log.conclusion, log.impact]
        .map((part) => part?.trim() ?? "")
        .filter(Boolean)
        .join(" ");
      const queryGrams = characterBigrams(query);
      if (queryGrams.size === 0) {
        return { items: [], retrieval };
      }

      const items = store.entries
        .filter((entry) => entry.status === "published")
        .map((entry) => ({ entry, score: bigramContainment(queryGrams, characterBigrams(searchableText(entry))) }))
        .filter(({ score }) => score >= MOCK_RELATED_MIN_SCORE)
        .sort((a, b) => b.score - a.score)
        .slice(0, MOCK_RELATED_LIMIT)
        .map<KnowledgeSearchResult>(({ entry }) => {
          const text = searchableText(entry).replace(/\s+/g, " ");
          const headRevision = store.revisions
            .filter((revision) => revision.entryId === entry.id)
            .sort((a, b) => b.revisionNumber - a.revisionNumber)[0];
          return {
            entryId: entry.id,
            title: entry.title,
            contentForm: entry.contentForm,
            tags: [...entry.tags],
            excerpt: text.slice(0, 120),
            updatedAt: entry.updatedAt,
            revisionId: headRevision?.id ?? null
          };
        });
      return { items, retrieval };
    },

    async relatedToSpec(specId) {
      // Published-only invariant, same as the API: drafts/archived never appear.
      const items = store.entries
        .filter((entry) => entry.status === "published")
        .filter((entry) => entry.parameterReferences.some((reference) => reference.specId === specId))
        .map<KnowledgeSearchResult>((entry) => {
          const text = searchableText(entry).replace(/\s+/g, " ");
          const headRevision = store.revisions
            .filter((revision) => revision.entryId === entry.id)
            .sort((a, b) => b.revisionNumber - a.revisionNumber)[0];
          return {
            entryId: entry.id,
            title: entry.title,
            contentForm: entry.contentForm,
            tags: [...entry.tags],
            excerpt: text.slice(0, 160),
            updatedAt: entry.updatedAt,
            revisionId: headRevision?.id ?? null
          };
        });
      return { items };
    },

    async relatedToDefinition(definitionId) {
      const items = store.entries
        .filter((entry) => entry.status === "published")
        .filter((entry) => entry.parameterReferences.some((reference) => reference.kind === "definition" && reference.definitionId === definitionId))
        .map<KnowledgeSearchResult>((entry) => ({
          entryId: entry.id,
          title: entry.title,
          contentForm: entry.contentForm,
          tags: [...entry.tags],
          excerpt: searchableText(entry).replace(/\s+/g, " ").slice(0, 160),
          updatedAt: entry.updatedAt,
          revisionId: store.revisions.filter((revision) => revision.entryId === entry.id)
            .sort((a, b) => b.revisionNumber - a.revisionNumber)[0]?.id ?? null
        }));
      return { items };
    },

    async addDefinitionReference(entryId, definitionId) {
      const entry = requireEntry(entryId);
      if (!canManage && entry.createdByUserId !== userId) {
        throw mockApiError("FORBIDDEN", "Editing someone else's entry references requires knowledge:manage.");
      }
      if (entry.status === "archived") {
        throw mockApiError("VALIDATION_FAILED", "Archived knowledge entries cannot change parameter references.");
      }
      if (definitionId !== activeDefinition.id) throw mockApiError("NOT_FOUND", "Definition not found.");
      if (!entry.parameterReferences.some((reference) => reference.kind === "definition" && reference.definitionId === definitionId)) {
        entry.parameterReferences = [...entry.parameterReferences, {
          kind: "definition", definitionId, availability: "current",
          propertyKey: activeDefinition.propertyKey,
          displayName: activeDefinition.currentRevision.displayName,
          driverModule: activeDefinition.subject.canonicalName,
          lifecycle: activeDefinition.lifecycle,
          createdByUserId: userId,
          createdAt: MOCK_KNOWLEDGE_NOW
        }];
      }
      return clone(entry);
    },

    async listReferenceSuggestions(entryId) {
      const entry = requireSuggestionEntry(entryId);
      return pendingSuggestions(entry).map(({ status: _status, ...item }) => clone(item));
    },
    async acceptReferenceSuggestion(entryId, definitionId) {
      const entry = requireSuggestionEntry(entryId);
      if (entry.status === "archived") throw mockApiError("VALIDATION_FAILED", "Archived knowledge entries cannot be edited.");
      const suggestion = store.suggestions.get(entryId)?.find((item) => item.definitionId === definitionId);
      if (!suggestion || !["pending", "accepted"].includes(suggestion.status)) throw mockApiError("CONFLICT", "Reference suggestion is not pending.");
      acceptSuggestion(entry, suggestion);
      return { ...clone(entry), pendingSuggestionCount: pendingSuggestions(entry).length };
    },
    async dismissReferenceSuggestion(entryId, definitionId) {
      const entry = requireSuggestionEntry(entryId);
      if (entry.status === "archived") throw mockApiError("VALIDATION_FAILED", "Archived knowledge entries cannot be edited.");
      const suggestion = store.suggestions.get(entryId)?.find((item) => item.definitionId === definitionId && item.status === "pending");
      if (suggestion) suggestion.status = "dismissed";
    },

    async removeDefinitionReference(entryId, definitionId) {
      const entry = requireEntry(entryId);
      if (!canManage && entry.createdByUserId !== userId) {
        throw mockApiError("FORBIDDEN", "Editing someone else's entry references requires knowledge:manage.");
      }
      if (entry.status === "archived") {
        throw mockApiError("VALIDATION_FAILED", "Archived knowledge entries cannot change parameter references.");
      }
      entry.parameterReferences = entry.parameterReferences.filter((reference) =>
        reference.kind !== "definition" || reference.definitionId !== definitionId);
      return clone(entry);
    },

    async removeParameterReference(entryId, specId) {
      const entry = requireEntry(entryId);
      if (!canManage && entry.createdByUserId !== userId) {
        throw mockApiError("FORBIDDEN", "Editing someone else's entry references requires knowledge:manage.");
      }
      if (entry.status === "archived") {
        throw mockApiError("INTERNAL_ERROR", "Archived knowledge entries cannot change parameter references.");
      }
      const next = entry.parameterReferences.filter((reference) => reference.specId !== specId);
      if (next.length === entry.parameterReferences.length) {
        throw mockApiError("NOT_FOUND", `Parameter reference not found on entry: ${specId}`, { specId });
      }
      entry.parameterReferences = next;
      return clone(entry);
    },

    async getFileObjectUrl(entryId, revisionId) {
      const entry = requireEntry(entryId);
      const revision = revisionId ? store.revisions.find((item) => item.entryId === entryId && item.id === revisionId) : null;
      if (revisionId && !revision) throw mockApiError("NOT_FOUND", "Knowledge revision was not found.");
      const fileId = revision ? revision.fileId : entry.file?.id;
      const file = fileId ? store.files.get(fileId) : undefined;
      if (file && typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
        return URL.createObjectURL(file);
      }
      return `mock-knowledge://${encodeURIComponent(entry.file?.fileName ?? entryId)}`;
    },

    async getIndexHealth() {
      if (!canManage) throw mockApiError("FORBIDDEN", "Index health requires knowledge:manage.");
      return {
        retrieval: { mode: "fts_only" as const, vectorAvailable: false, embeddingConfigured: false },
        items: Array.from(store.index.entries())
          .map(([entryId, record]) => {
            const entry = store.entries.find((item) => item.id === entryId);
            if (!entry) return null;
            return {
              entryId,
              title: entry.title,
              entryStatus: entry.status,
              status: record.status,
              error: record.error,
              indexedRevisionNumber: record.indexedRevisionNumber,
              chunkCount: record.chunkCount,
              embeddedChunkCount: 0,
              updatedAt: entry.updatedAt
            };
          })
          .filter((item): item is NonNullable<typeof item> => item !== null)
      };
    },

    async retryEntryIndex(entryId) {
      if (!canManage) throw mockApiError("FORBIDDEN", "Index retry requires knowledge:manage.");
      const entry = requireEntry(entryId);
      store.index.set(entryId, {
        status: "pending",
        error: null,
        indexedRevisionNumber: entry.headRevisionNumber,
        chunkCount: store.index.get(entryId)?.chunkCount ?? 0
      });
    },

    async rebuildIndex() {
      if (!canManage) throw mockApiError("FORBIDDEN", "Index rebuild requires knowledge:manage.");
      const published = store.entries.filter((entry) => entry.status === "published");
      for (const entry of published) {
        store.index.set(entry.id, {
          status: "pending",
          error: null,
          indexedRevisionNumber: entry.headRevisionNumber,
          chunkCount: store.index.get(entry.id)?.chunkCount ?? 0
        });
      }
      return { enqueued: published.length };
    },

    async rescanReferenceSuggestions() {
      if (!canManage) throw mockApiError("FORBIDDEN", "Reference suggestion rescan requires knowledge:manage.");
      const entries = store.entries.filter((entry) => entry.status !== "archived");
      for (const entry of entries) detectSuggestions(entry);
      return { enqueued: entries.length };
    }
  };
  return repository;
}
