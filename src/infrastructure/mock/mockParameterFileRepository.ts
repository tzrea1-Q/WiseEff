import type {
  ActivateParameterFileCandidateInput,
  ActivateParameterFileCandidateResult,
  CreateParameterFileCandidateInput,
  DownloadParameterFileCandidateResult,
  DownloadParameterFileVersionResult,
  FileSyncSummary,
  ParameterFileCandidate,
  ParameterFileConflictResolution,
  ParameterFileRepository,
  ParameterFileSyncConflict,
  ProjectParameterFile,
  ProjectParameterFileVersion,
  UploadParameterFileInput
} from "@/application/ports/ParameterFileRepository";

const MOCK_NOW = "2026-07-14T10:00:00.000Z";
const DEFAULT_PROJECT_ID = "project-teaching";
const DEFAULT_FILE_ID = "file-teaching-dts";
const DEFAULT_FILE_NAME = "atlas-board.dts";
const DEFAULT_VERSION_ID = "version-teaching-1";
const DEFAULT_ORG_ID = "org-teaching";
const DEFAULT_CONFLICT_ID = "conflict-teaching-1";

type Store = {
  filesByProject: Map<string, ProjectParameterFile[]>;
  versionsByFile: Map<string, ProjectParameterFileVersion[]>;
  contentByVersion: Map<string, Uint8Array>;
  conflictsByProject: Map<string, ParameterFileSyncConflict[]>;
  candidatesByProject: Map<string, ParameterFileCandidate[]>;
  contentByCandidate: Map<string, Uint8Array>;
};

function decodeBase64(contentBase64: string): Uint8Array {
  const binary = atob(contentBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function seedStore(): Store {
  const file: ProjectParameterFile = {
    id: DEFAULT_FILE_ID,
    projectId: DEFAULT_PROJECT_ID,
    fileName: DEFAULT_FILE_NAME,
    format: "dts",
    moduleHint: "teaching",
    enabled: true,
    currentVersionId: DEFAULT_VERSION_ID,
    currentVersionNumber: 1,
    updatedAt: MOCK_NOW
  };
  const version: ProjectParameterFileVersion = {
    id: DEFAULT_VERSION_ID,
    fileId: DEFAULT_FILE_ID,
    versionNumber: 1,
    checksum: "mock-checksum-teaching",
    sizeBytes: 64,
    parsedIndex: {
      "demo_bool.weak_source_sleep_enabled": { value: "true", line: 10 }
    },
    origin: "upload",
    createdAt: MOCK_NOW,
    createdByUserId: "user-teaching"
  };
  const conflict: ParameterFileSyncConflict = {
    id: DEFAULT_CONFLICT_ID,
    organizationId: DEFAULT_ORG_ID,
    projectId: DEFAULT_PROJECT_ID,
    projectParameterValueId: "ppv-teaching-1",
    parameterDefinitionId: "pd-teaching-1",
    parameterName: "weak_source_sleep_enabled",
    parameterModule: "demo_bool",
    fileVersionId: DEFAULT_VERSION_ID,
    fileDraftId: "draft-file-1",
    uiDraftId: "draft-ui-1",
    fileValue: "true",
    uiDraftValue: "false",
    status: "open",
    createdAt: MOCK_NOW
  };

  return {
    filesByProject: new Map([[DEFAULT_PROJECT_ID, [file]]]),
    versionsByFile: new Map([[DEFAULT_FILE_ID, [version]]]),
    contentByVersion: new Map([[DEFAULT_VERSION_ID, new TextEncoder().encode("/ { };\n")]]),
    conflictsByProject: new Map([[DEFAULT_PROJECT_ID, [conflict]]]),
    candidatesByProject: new Map(),
    contentByCandidate: new Map()
  };
}

function ensureProjectFiles(store: Store, projectId: string): ProjectParameterFile[] {
  const existing = store.filesByProject.get(projectId);
  if (existing) {
    return existing;
  }
  if (projectId === DEFAULT_PROJECT_ID) {
    return store.filesByProject.get(DEFAULT_PROJECT_ID) ?? [];
  }
  const seeded = (store.filesByProject.get(DEFAULT_PROJECT_ID) ?? []).map((file) => ({
    ...file,
    id: `${file.id}-${projectId}`,
    projectId
  }));
  store.filesByProject.set(projectId, seeded);
  for (const file of seeded) {
    const versions = (store.versionsByFile.get(DEFAULT_FILE_ID) ?? []).map((version) => ({
      ...version,
      id: `${version.id}-${projectId}`,
      fileId: file.id
    }));
    store.versionsByFile.set(file.id, versions);
    for (const version of versions) {
      store.contentByVersion.set(version.id, new TextEncoder().encode("/ { };\n"));
    }
  }
  return seeded;
}

/**
 * In-memory ParameterFileRepository for mock runtime demos and component tests.
 * Seeded with a teaching-style DTS file and one open sync conflict.
 */
export function createMockParameterFileRepository(): ParameterFileRepository {
  const store = seedStore();
  let uploadCounter = 0;

  return {
    async listFiles(projectId) {
      return ensureProjectFiles(store, projectId).map((file) => ({ ...file }));
    },

    async uploadFile(projectId, input: UploadParameterFileInput) {
      uploadCounter += 1;
      const fileId = `file-mock-${uploadCounter}`;
      const versionId = `version-mock-${uploadCounter}-1`;
      const bytes = decodeBase64(input.contentBase64);
      const version: ProjectParameterFileVersion = {
        id: versionId,
        fileId,
        versionNumber: 1,
        checksum: `mock-checksum-${uploadCounter}`,
        sizeBytes: bytes.byteLength,
        parsedIndex: {},
        origin: "upload",
        createdAt: MOCK_NOW
      };
      const format = input.fileName.toLowerCase().endsWith(".json") ? "json" : "dts";
      const file: ProjectParameterFile = {
        id: fileId,
        projectId,
        fileName: input.fileName,
        format,
        enabled: true,
        currentVersionId: versionId,
        currentVersionNumber: 1,
        updatedAt: MOCK_NOW
      };
      const files = ensureProjectFiles(store, projectId);
      files.push(file);
      store.filesByProject.set(projectId, files);
      store.versionsByFile.set(fileId, [version]);
      store.contentByVersion.set(versionId, bytes);
      return { item: { ...file }, version: { ...version } };
    },

    async uploadVersion(projectId, fileId, input: UploadParameterFileInput) {
      const files = ensureProjectFiles(store, projectId);
      const file = files.find((item) => item.id === fileId);
      if (!file) {
        throw new Error(`Parameter file not found: ${fileId}`);
      }
      const existing = store.versionsByFile.get(fileId) ?? [];
      const versionNumber = (existing[existing.length - 1]?.versionNumber ?? 0) + 1;
      const bytes = decodeBase64(input.contentBase64);
      const version: ProjectParameterFileVersion = {
        id: `version-${fileId}-${versionNumber}`,
        fileId,
        versionNumber,
        checksum: `mock-checksum-${fileId}-${versionNumber}`,
        sizeBytes: bytes.byteLength,
        parsedIndex: {},
        origin: "upload",
        createdAt: MOCK_NOW
      };
      existing.push(version);
      store.versionsByFile.set(fileId, existing);
      store.contentByVersion.set(version.id, bytes);
      file.currentVersionId = version.id;
      file.currentVersionNumber = version.versionNumber;
      file.updatedAt = MOCK_NOW;
      return { item: { ...version } };
    },

    async listVersions(projectId, fileId) {
      ensureProjectFiles(store, projectId);
      return (store.versionsByFile.get(fileId) ?? []).map((version) => ({ ...version }));
    },

    async downloadVersion(projectId, fileId, versionId): Promise<DownloadParameterFileVersionResult> {
      ensureProjectFiles(store, projectId);
      const versions = store.versionsByFile.get(fileId) ?? [];
      const version = versions.find((item) => item.id === versionId);
      if (!version) {
        throw new Error(`Parameter file version not found: ${versionId}`);
      }
      const file = (store.filesByProject.get(projectId) ?? []).find((item) => item.id === fileId);
      const bytes = store.contentByVersion.get(versionId) ?? new Uint8Array();
      return {
        contentType: "application/octet-stream",
        fileName: file?.fileName,
        bytes: new Uint8Array(bytes)
      };
    },

    async syncFile(projectId, fileId): Promise<FileSyncSummary> {
      ensureProjectFiles(store, projectId);
      const versions = store.versionsByFile.get(fileId);
      if (!versions?.length) {
        throw new Error(`Parameter file not found: ${fileId}`);
      }
      return {
        draftsCreated: 1,
        unchanged: 0,
        unmatched: 0,
        skipped: false,
        identityFallbackUses: 0
      };
    },

    async listConflicts(projectId) {
      ensureProjectFiles(store, projectId);
      const conflicts = store.conflictsByProject.get(projectId);
      if (!conflicts) {
        const seeded = (store.conflictsByProject.get(DEFAULT_PROJECT_ID) ?? []).map((conflict) => ({
          ...conflict,
          id: `${conflict.id}-${projectId}`,
          projectId
        }));
        store.conflictsByProject.set(projectId, seeded);
        return seeded.filter((item) => item.status === "open").map((item) => ({ ...item }));
      }
      return conflicts.filter((item) => item.status === "open").map((item) => ({ ...item }));
    },

    async resolveConflict(projectId, conflictId, resolution: ParameterFileConflictResolution) {
      const conflicts = store.conflictsByProject.get(projectId) ?? [];
      const conflict = conflicts.find((item) => item.id === conflictId);
      if (!conflict || conflict.status !== "open") {
        throw new Error(`Open conflict not found: ${conflictId}`);
      }
      conflict.status = resolution === "file" ? "resolved_file" : "resolved_ui";
      conflict.resolvedAt = MOCK_NOW;
      conflict.resolvedByUserId = "user-teaching";
      return { ...conflict };
    },

    async listCandidates(projectId, options) {
      const items = store.candidatesByProject.get(projectId) ?? [];
      return items
        .filter((item) => (options?.fileId ? item.fileId === options.fileId : true))
        .filter((item) => (options?.includeAbandoned ? true : item.status !== "abandoned"))
        .map((item) => ({ ...item, diagnostics: [...item.diagnostics], blockers: [...item.blockers], impact: { ...item.impact } }));
    },

    async createCandidate(projectId, input: CreateParameterFileCandidateInput) {
      uploadCounter += 1;
      const bytes = decodeBase64(input.contentBase64);
      const source = new TextDecoder().decode(bytes);
      const files = ensureProjectFiles(store, projectId);
      const file = input.fileId
        ? files.find((item) => item.id === input.fileId)
        : files.find((item) => item.fileName === input.fileName);
      const format = input.fileName.toLowerCase().endsWith(".json") ? "json" : "dts";
      let status: ParameterFileCandidate["status"] = "ready";
      const diagnostics: ParameterFileCandidate["diagnostics"] = [];
      if (format === "json") {
        try {
          JSON.parse(source);
        } catch (error) {
          status = "failed";
          diagnostics.push({
            severity: "error",
            code: "parse-failed",
            message: error instanceof Error ? error.message : "parse failed"
          });
        }
      }
      const candidate: ParameterFileCandidate = {
        id: `candidate-mock-${uploadCounter}`,
        projectId,
        fileId: file?.id,
        fileName: file?.fileName ?? input.fileName,
        format,
        status,
        baseVersionId: file?.currentVersionId,
        checksum: `mock-cand-${uploadCounter}`,
        sizeBytes: bytes.byteLength,
        diagnostics,
        impact: {
          textDiff: `--- active\n+++ candidate\n+uploaded`,
          structuralDiff: [],
          diagnostics,
          blockers: [],
          conflicts: [],
          coverage: {
            matchedRegistered: [],
            newUnregistered: [],
            matchedRegisteredCount: 0,
            newUnregisteredCount: 0
          }
        },
        blockers: [],
        createdAt: MOCK_NOW,
        updatedAt: MOCK_NOW
      };
      const list = store.candidatesByProject.get(projectId) ?? [];
      list.unshift(candidate);
      store.candidatesByProject.set(projectId, list);
      store.contentByCandidate.set(candidate.id, bytes);
      return { ...candidate, diagnostics: [...diagnostics], impact: { ...candidate.impact } };
    },

    async getCandidate(projectId, candidateId) {
      const candidate = (store.candidatesByProject.get(projectId) ?? []).find((item) => item.id === candidateId);
      if (!candidate) throw new Error(`Candidate not found: ${candidateId}`);
      return { ...candidate, diagnostics: [...candidate.diagnostics], impact: { ...candidate.impact } };
    },

    async getCandidateImpact(projectId, candidateId) {
      const candidate = (store.candidatesByProject.get(projectId) ?? []).find((item) => item.id === candidateId);
      if (!candidate) throw new Error(`Candidate not found: ${candidateId}`);
      const item = { ...candidate, diagnostics: [...candidate.diagnostics], impact: { ...candidate.impact } };
      return { item, impact: { ...item.impact } };
    },

    async downloadCandidate(projectId, candidateId): Promise<DownloadParameterFileCandidateResult> {
      const candidate = (store.candidatesByProject.get(projectId) ?? []).find((item) => item.id === candidateId);
      if (!candidate) throw new Error(`Candidate not found: ${candidateId}`);
      const bytes = store.contentByCandidate.get(candidateId) ?? new Uint8Array();
      return {
        contentType: "application/octet-stream",
        fileName: candidate.fileName,
        bytes: new Uint8Array(bytes)
      };
    },

    async abandonCandidate(projectId, candidateId) {
      const list = store.candidatesByProject.get(projectId) ?? [];
      const candidate = list.find((item) => item.id === candidateId);
      if (!candidate) throw new Error(`Candidate not found: ${candidateId}`);
      if (!["ready", "blocked", "failed", "stale"].includes(candidate.status)) {
        throw new Error(`Cannot abandon candidate in status ${candidate.status}`);
      }
      candidate.status = "abandoned";
      candidate.abandonedAt = MOCK_NOW;
      candidate.updatedAt = MOCK_NOW;
      return { ...candidate };
    },

    async recomputeCandidate(projectId, candidateId) {
      const list = store.candidatesByProject.get(projectId) ?? [];
      const candidate = list.find((item) => item.id === candidateId);
      if (!candidate) throw new Error(`Candidate not found: ${candidateId}`);
      if (!["ready", "blocked", "failed", "stale"].includes(candidate.status)) {
        throw new Error(`Cannot recompute candidate in status ${candidate.status}`);
      }
      const files = ensureProjectFiles(store, projectId);
      const file = candidate.fileId ? files.find((item) => item.id === candidate.fileId) : undefined;
      if (file?.currentVersionId) {
        candidate.baseVersionId = file.currentVersionId;
      }
      candidate.updatedAt = MOCK_NOW;
      if (candidate.status === "stale" || (candidate.status === "blocked" && (candidate.blockers?.length ?? 0) === 0)) {
        candidate.status = "ready";
        candidate.blockers = [];
      }
      return { ...candidate };
    },

    async activateCandidate(
      projectId,
      candidateId,
      input: ActivateParameterFileCandidateInput
    ): Promise<ActivateParameterFileCandidateResult> {
      const list = store.candidatesByProject.get(projectId) ?? [];
      const candidate = list.find((item) => item.id === candidateId);
      if (!candidate) throw new Error(`Candidate not found: ${candidateId}`);
      if (candidate.status !== "ready") {
        throw new Error(`Cannot activate candidate in status ${candidate.status}`);
      }
      const files = ensureProjectFiles(store, projectId);
      let file = candidate.fileId ? files.find((item) => item.id === candidate.fileId) : undefined;
      const expected = input.expectedCurrentVersionId ?? null;
      const actual = file?.currentVersionId ?? null;
      if (actual !== expected || (candidate.baseVersionId ?? null) !== expected) {
        candidate.status = "stale";
        candidate.updatedAt = MOCK_NOW;
        throw new Error("Candidate base is stale");
      }
      if (!file) {
        if (!input.configSetId || !input.role) {
          throw new Error("New file activation requires configSetId and role");
        }
        uploadCounter += 1;
        file = {
          id: `file-mock-cand-${uploadCounter}`,
          projectId,
          fileName: candidate.fileName,
          format: candidate.format,
          enabled: true,
          currentVersionId: undefined,
          currentVersionNumber: 0,
          updatedAt: MOCK_NOW
        };
        files.push(file);
      }
      uploadCounter += 1;
      const version: ProjectParameterFileVersion = {
        id: `version-mock-cand-${uploadCounter}`,
        fileId: file.id,
        versionNumber: (file.currentVersionNumber ?? 0) + 1,
        checksum: candidate.checksum ?? `mock-act-${uploadCounter}`,
        sizeBytes: candidate.sizeBytes ?? 0,
        parsedIndex: {},
        origin: "upload",
        createdAt: MOCK_NOW
      };
      const versions = store.versionsByFile.get(file.id) ?? [];
      versions.push(version);
      store.versionsByFile.set(file.id, versions);
      const bytes = store.contentByCandidate.get(candidateId) ?? new Uint8Array();
      store.contentByVersion.set(version.id, new Uint8Array(bytes));
      file.currentVersionId = version.id;
      file.currentVersionNumber = version.versionNumber;
      file.updatedAt = MOCK_NOW;
      candidate.status = "active";
      candidate.fileId = file.id;
      candidate.activatedAt = MOCK_NOW;
      candidate.activatedVersionId = version.id;
      candidate.updatedAt = MOCK_NOW;
      return { item: { ...candidate }, file: { ...file }, version: { ...version } };
    }
  };
}
