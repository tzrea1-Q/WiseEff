import type {
  KnowledgeListQuery,
  KnowledgeRepository,
  UpdateKnowledgeInput
} from "@/application/ports/KnowledgeRepository";
import { KnowledgeRevisionConflictError } from "@/application/ports/KnowledgeRepository";
import { buildLogDistillationDraft } from "@/domain/knowledge/distill";
import type {
  KnowledgeEntry,
  KnowledgeIndexState,
  KnowledgeRevision,
  KnowledgeSearchResult
} from "@/domain/knowledge/types";
import type { LogRecord } from "@/domain/prototype/types";

const MOCK_KNOWLEDGE_NOW = "2026-08-12T00:00:00.000Z";
const MOCK_USER_ID = "u-xu-yun";

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
  counter: number;
};

export type MockKnowledgeCapability = {
  userId?: string;
  canManage?: boolean;
  /** Mock distillation source: resolves a frontend log record by id (App wires state.logs). */
  getLogRecord?: (logId: string) => LogRecord | undefined;
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

export function createMockKnowledgeFixtures(): { entries: KnowledgeEntry[]; revisions: KnowledgeRevision[] } {
  const publishedMarkdown: KnowledgeEntry = {
    id: "mock-kb-1",
    title: "快充温控调参经验",
    contentForm: "markdown",
    status: "published",
    tags: ["project-aurora", "快充", "温控"],
    sourceType: "human",
    sourceSessionId: null,
    sourceLogId: null,
    createdByUserId: MOCK_USER_ID,
    headRevisionNumber: 2,
    createdAt: "2026-08-01T02:00:00.000Z",
    updatedAt: "2026-08-10T06:30:00.000Z",
    publishedAt: "2026-08-02T09:00:00.000Z",
    archivedAt: null,
    contentMarkdown:
      "# 快充温控调参经验\n\n当电池温度超过 45 度时,按 0.5A 步长下调快充电流。\n\n- 观察 NTC 采样间隔\n- 记录降流后的温升斜率",
    file: null
  };

  const draftMarkdown: KnowledgeEntry = {
    id: "mock-kb-2",
    title: "SC8562 充电泵比率切换草稿",
    contentForm: "markdown",
    status: "draft",
    tags: ["硬件", "sc8562"],
    sourceType: "human",
    sourceSessionId: null,
    sourceLogId: null,
    createdByUserId: MOCK_USER_ID,
    headRevisionNumber: 1,
    createdAt: "2026-08-11T03:00:00.000Z",
    updatedAt: "2026-08-11T03:00:00.000Z",
    publishedAt: null,
    archivedAt: null,
    contentMarkdown: "## 待验证\n\n2:1 与 4:1 模式切换阈值仍需实验数据。",
    file: null
  };

  const publishedFile: KnowledgeEntry = {
    id: "mock-kb-3",
    title: "MT5788 无线充手册摘录",
    contentForm: "file",
    status: "published",
    tags: ["project-nebula", "无线充"],
    sourceType: "human",
    sourceSessionId: null,
    sourceLogId: null,
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
    }
  };

  const failedExtractionFile: KnowledgeEntry = {
    id: "mock-kb-4",
    title: "旧版工艺规范(.doc)",
    contentForm: "file",
    status: "draft",
    tags: ["流程规范"],
    sourceType: "human",
    sourceSessionId: null,
    sourceLogId: null,
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
    }
  };

  const archivedMarkdown: KnowledgeEntry = {
    id: "mock-kb-5",
    title: "已归档:旧平台日志格式说明",
    contentForm: "markdown",
    status: "archived",
    tags: ["日志"],
    sourceType: "human",
    sourceSessionId: null,
    sourceLogId: null,
    createdByUserId: "u-li-fang",
    headRevisionNumber: 3,
    createdAt: "2026-07-01T02:00:00.000Z",
    updatedAt: "2026-08-08T02:00:00.000Z",
    publishedAt: "2026-07-02T02:00:00.000Z",
    archivedAt: "2026-08-08T02:00:00.000Z",
    contentMarkdown: "旧平台日志格式已下线,保留历史供追溯。",
    file: null
  };

  // Agent-draft publish-queue states: one draft distilled in the current
  // user's session (publishable by them), one from another engineer's session
  // (manage-only governance) — so the /knowledge-admin queue has both rows.
  const agentDraftOwn: KnowledgeEntry = {
    id: "mock-kb-agent-1",
    title: "小泽沉淀:充电异常断电根因排查",
    contentForm: "markdown",
    status: "draft",
    tags: ["日志分析", "严重"],
    sourceType: "agent",
    sourceSessionId: "mock-xiaoze-session-1",
    sourceLogId: "log-auth",
    createdByUserId: MOCK_USER_ID,
    headRevisionNumber: 1,
    createdAt: "2026-08-11T09:20:00.000Z",
    updatedAt: "2026-08-11T09:20:00.000Z",
    publishedAt: null,
    archivedAt: null,
    contentMarkdown:
      "## 结论\n\n充电异常断电与鉴权重试风暴相关,建议限制重试频率。\n\n(由小泽在会话中沉淀,待人工审阅发布。)",
    file: null
  };

  const agentDraftOther: KnowledgeEntry = {
    id: "mock-kb-agent-2",
    title: "小泽沉淀:无线充异物检测误报处置",
    contentForm: "markdown",
    status: "draft",
    tags: ["小泽沉淀"],
    sourceType: "agent",
    sourceSessionId: "mock-xiaoze-session-2",
    sourceLogId: null,
    createdByUserId: "u-li-fang",
    headRevisionNumber: 1,
    createdAt: "2026-08-11T11:05:00.000Z",
    updatedAt: "2026-08-11T11:05:00.000Z",
    publishedAt: null,
    archivedAt: null,
    contentMarkdown: "## 结论\n\nFOD 阈值偏严导致金属边框误报,建议按整机型号分档配置。",
    file: null
  };

  // Related to the completed mock log (log-auth, PD negotiation): the log
  // result page's related-knowledge section has a real hit in mock mode.
  const publishedPdHandbook: KnowledgeEntry = {
    id: "mock-kb-8",
    title: "PD 快充协议兼容性排查手册",
    contentForm: "markdown",
    status: "published",
    tags: ["快充", "PD 协议"],
    sourceType: "human",
    sourceSessionId: null,
    sourceLogId: null,
    createdByUserId: "u-li-fang",
    headRevisionNumber: 1,
    createdAt: "2026-08-06T03:00:00.000Z",
    updatedAt: "2026-08-06T03:00:00.000Z",
    publishedAt: "2026-08-06T03:10:00.000Z",
    archivedAt: null,
    contentMarkdown:
      "# PD 快充协议兼容性排查手册\n\n典型健康样本:PD 协商在 9V/3A 档位稳定完成,未出现握手重试,说明 SourceCap 与 Request 匹配良好。\n\n- 出现握手重试时优先复核适配器白名单\n- 记录 PD 协商日志中的 SourceCap 档位与 Accept 时序",
    file: null
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
    revisions
  };
}

export function createMockKnowledgeRepository(
  capability: MockKnowledgeCapability = {},
  fixtures = createMockKnowledgeFixtures()
): KnowledgeRepository {
  const userId = capability.userId ?? MOCK_USER_ID;
  const canManage = capability.canManage ?? true;
  const store: MockStore = {
    entries: fixtures.entries.map(clone),
    revisions: fixtures.revisions.map(clone),
    counter: fixtures.entries.length,
    files: new Map(),
    index: new Map()
  };

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
    if (!entry) throw new Error(`Knowledge entry not found: ${entryId}`);
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
    return revision;
  }

  return {
    async list(query?: KnowledgeListQuery) {
      const items = store.entries.filter((entry) => {
        if (entry.status === "draft" && !canManage && entry.createdByUserId !== userId) return false;
        if (query?.status && entry.status !== query.status) return false;
        if (query?.contentForm && entry.contentForm !== query.contentForm) return false;
        if (query?.sourceType && entry.sourceType !== query.sourceType) return false;
        if (query?.tag && !entry.tags.includes(query.tag)) return false;
        if (query?.q && !entry.title.toLocaleLowerCase().includes(query.q.toLocaleLowerCase())) return false;
        return true;
      });
      return { items: items.map(clone) };
    },

    async get(entryId) {
      const entry = findEntry(entryId);
      return entry ? clone(entry) : null;
    },

    async createMarkdown(input) {
      store.counter += 1;
      const entry: KnowledgeEntry = {
        id: `mock-kb-${store.counter}`,
        title: input.title,
        contentForm: "markdown",
        status: "draft",
        tags: [...input.tags],
        sourceType: "human",
        sourceSessionId: null,
        sourceLogId: null,
        createdByUserId: userId,
        headRevisionNumber: 0,
        createdAt: MOCK_KNOWLEDGE_NOW,
        updatedAt: MOCK_KNOWLEDGE_NOW,
        publishedAt: null,
        archivedAt: null,
        contentMarkdown: input.contentMarkdown,
        file: null
      };
      appendRevision(entry);
      entry.headRevisionNumber = 1;
      store.entries = [entry, ...store.entries];
      return clone(entry);
    },

    async createFile(input) {
      store.counter += 1;
      const id = `mock-kb-${store.counter}`;
      const isLegacyDoc = input.file.name.toLocaleLowerCase().endsWith(".doc");
      const entry: KnowledgeEntry = {
        id,
        title: input.title,
        contentForm: "file",
        status: "draft",
        tags: [...input.tags],
        sourceType: "human",
        sourceSessionId: null,
        sourceLogId: null,
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
        }
      };
      store.files.set(`${id}-file`, input.file);
      appendRevision(entry);
      entry.headRevisionNumber = 1;
      store.entries = [entry, ...store.entries];
      return clone(entry);
    },

    async distillFromLog(logId) {
      const log = capability.getLogRecord?.(logId);
      if (!log) {
        throw new Error(`Log record not found: ${logId}`);
      }
      if (log.status !== "Complete") {
        throw new Error("只有已完成的日志分析才能沉淀为知识。");
      }
      const draft = buildLogDistillationDraft(log);
      store.counter += 1;
      const entry: KnowledgeEntry = {
        id: `mock-kb-${store.counter}`,
        title: draft.title,
        contentForm: "markdown",
        status: "draft",
        tags: [...draft.tags],
        sourceType: "human",
        sourceSessionId: null,
        sourceLogId: log.id,
        createdByUserId: userId,
        headRevisionNumber: 0,
        createdAt: MOCK_KNOWLEDGE_NOW,
        updatedAt: MOCK_KNOWLEDGE_NOW,
        publishedAt: null,
        archivedAt: null,
        contentMarkdown: draft.contentMarkdown,
        file: null
      };
      appendRevision(entry);
      entry.headRevisionNumber = 1;
      store.entries = [entry, ...store.entries];
      return clone(entry);
    },

    async rejectAgentDraft(entryId) {
      const entry = requireEntry(entryId);
      if (!canManage && entry.createdByUserId !== userId) {
        throw new Error("Rejecting someone else's agent draft requires knowledge:manage.");
      }
      if (entry.status !== "draft" || entry.sourceType !== "agent") {
        throw new Error("Only agent-sourced drafts can be archive-rejected.");
      }
      entry.status = "archived";
      entry.archivedAt = MOCK_KNOWLEDGE_NOW;
      entry.updatedAt = MOCK_KNOWLEDGE_NOW;
      return clone(entry);
    },

    async update(entryId, input: UpdateKnowledgeInput) {
      const entry = requireEntry(entryId);
      if (entry.status === "archived") {
        throw new Error("Archived knowledge entries cannot be edited.");
      }
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
      if (entry.status !== "draft") throw new Error(`Illegal transition: ${entry.status} -> published`);
      entry.status = "published";
      entry.publishedAt = MOCK_KNOWLEDGE_NOW;
      entry.updatedAt = MOCK_KNOWLEDGE_NOW;
      markIndexed(entry);
      return clone(entry);
    },

    async archive(entryId) {
      const entry = requireEntry(entryId);
      if (entry.status !== "published") throw new Error(`Illegal transition: ${entry.status} -> archived`);
      entry.status = "archived";
      entry.archivedAt = MOCK_KNOWLEDGE_NOW;
      entry.updatedAt = MOCK_KNOWLEDGE_NOW;
      markIndexed(entry);
      return clone(entry);
    },

    async restore(entryId) {
      const entry = requireEntry(entryId);
      if (entry.status !== "archived") throw new Error(`Illegal transition: ${entry.status} -> published`);
      entry.status = "published";
      entry.archivedAt = null;
      entry.updatedAt = MOCK_KNOWLEDGE_NOW;
      markIndexed(entry);
      return clone(entry);
    },

    async hardDelete(entryId) {
      if (!canManage) throw new Error("Hard delete requires knowledge:manage.");
      requireEntry(entryId);
      store.entries = store.entries.filter((entry) => entry.id !== entryId);
      store.revisions = store.revisions.filter((revision) => revision.entryId !== entryId);
      store.index.delete(entryId);
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
        throw new Error("Archived knowledge entries cannot be edited.");
      }
      if (entry.headRevisionNumber !== expectedHeadRevisionNumber) {
        throw new KnowledgeRevisionConflictError(
          "知识条目已被其他保存修改,请刷新后重试。",
          expectedHeadRevisionNumber,
          entry.headRevisionNumber
        );
      }
      const revision = store.revisions.find((item) => item.entryId === entryId && item.id === revisionId);
      if (!revision) throw new Error(`Knowledge revision not found: ${revisionId}`);

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
        throw new Error(`Log record not found: ${logId}`);
      }
      if (log.status !== "Complete") {
        throw new Error("只有已完成的日志分析才有相关知识。");
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

    async getFileObjectUrl(entryId) {
      const entry = requireEntry(entryId);
      const file = entry.file ? store.files.get(entry.file.id) : undefined;
      if (file && typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
        return URL.createObjectURL(file);
      }
      return `mock-knowledge://${encodeURIComponent(entry.file?.fileName ?? entryId)}`;
    },

    async getIndexHealth() {
      if (!canManage) throw new Error("Index health requires knowledge:manage.");
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
      if (!canManage) throw new Error("Index retry requires knowledge:manage.");
      const entry = requireEntry(entryId);
      store.index.set(entryId, {
        status: "pending",
        error: null,
        indexedRevisionNumber: entry.headRevisionNumber,
        chunkCount: store.index.get(entryId)?.chunkCount ?? 0
      });
    },

    async rebuildIndex() {
      if (!canManage) throw new Error("Index rebuild requires knowledge:manage.");
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
    }
  };
}
