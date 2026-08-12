import type {
  KnowledgeListQuery,
  KnowledgeRepository,
  UpdateKnowledgeInput
} from "@/application/ports/KnowledgeRepository";
import { KnowledgeRevisionConflictError } from "@/application/ports/KnowledgeRepository";
import type {
  KnowledgeEntry,
  KnowledgeRevision,
  KnowledgeSearchResult
} from "@/domain/knowledge/types";

const MOCK_KNOWLEDGE_NOW = "2026-08-12T00:00:00.000Z";
const MOCK_USER_ID = "u-xu-yun";

type MockStore = {
  entries: KnowledgeEntry[];
  revisions: KnowledgeRevision[];
  files: Map<string, File>;
  counter: number;
};

export type MockKnowledgeCapability = {
  userId?: string;
  canManage?: boolean;
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function searchableText(entry: KnowledgeEntry): string {
  return [entry.title, entry.tags.join(" "), entry.contentMarkdown ?? "", entry.file?.fileName ?? ""].join("\n");
}

export function createMockKnowledgeFixtures(): { entries: KnowledgeEntry[]; revisions: KnowledgeRevision[] } {
  const publishedMarkdown: KnowledgeEntry = {
    id: "mock-kb-1",
    title: "快充温控调参经验",
    contentForm: "markdown",
    status: "published",
    tags: ["project-aurora", "快充", "温控"],
    sourceType: "human",
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
    createdByUserId: "u-li-fang",
    headRevisionNumber: 3,
    createdAt: "2026-07-01T02:00:00.000Z",
    updatedAt: "2026-08-08T02:00:00.000Z",
    publishedAt: "2026-07-02T02:00:00.000Z",
    archivedAt: "2026-08-08T02:00:00.000Z",
    contentMarkdown: "旧平台日志格式已下线,保留历史供追溯。",
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
    }
  ];

  return {
    entries: [publishedMarkdown, draftMarkdown, publishedFile, failedExtractionFile, archivedMarkdown],
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
    files: new Map()
  };

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
      return clone(entry);
    },

    async archive(entryId) {
      const entry = requireEntry(entryId);
      if (entry.status !== "published") throw new Error(`Illegal transition: ${entry.status} -> archived`);
      entry.status = "archived";
      entry.archivedAt = MOCK_KNOWLEDGE_NOW;
      entry.updatedAt = MOCK_KNOWLEDGE_NOW;
      return clone(entry);
    },

    async restore(entryId) {
      const entry = requireEntry(entryId);
      if (entry.status !== "archived") throw new Error(`Illegal transition: ${entry.status} -> published`);
      entry.status = "published";
      entry.archivedAt = null;
      entry.updatedAt = MOCK_KNOWLEDGE_NOW;
      return clone(entry);
    },

    async hardDelete(entryId) {
      if (!canManage) throw new Error("Hard delete requires knowledge:manage.");
      requireEntry(entryId);
      store.entries = store.entries.filter((entry) => entry.id !== entryId);
      store.revisions = store.revisions.filter((revision) => revision.entryId !== entryId);
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
      if (!query) return [];
      return store.entries
        .filter((entry) => entry.status === "published")
        .filter((entry) => searchableText(entry).toLocaleLowerCase().includes(query))
        .map<KnowledgeSearchResult>((entry) => {
          const text = searchableText(entry).replace(/\s+/g, " ");
          const index = text.toLocaleLowerCase().indexOf(query);
          const start = Math.max(0, index - 30);
          return {
            entryId: entry.id,
            title: entry.title,
            contentForm: entry.contentForm,
            tags: [...entry.tags],
            excerpt: text.slice(start, start + 120),
            updatedAt: entry.updatedAt
          };
        });
    },

    async getFileObjectUrl(entryId) {
      const entry = requireEntry(entryId);
      const file = entry.file ? store.files.get(entry.file.id) : undefined;
      if (file && typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
        return URL.createObjectURL(file);
      }
      return `mock-knowledge://${encodeURIComponent(entry.file?.fileName ?? entryId)}`;
    }
  };
}
