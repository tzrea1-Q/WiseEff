import type {
  DownloadParameterFileVersionResult,
  FileSyncSummary,
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
const DEFAULT_FILE_NAME = "teaching-sample.dts";
const DEFAULT_VERSION_ID = "version-teaching-1";
const DEFAULT_ORG_ID = "org-teaching";
const DEFAULT_CONFLICT_ID = "conflict-teaching-1";

type Store = {
  filesByProject: Map<string, ProjectParameterFile[]>;
  versionsByFile: Map<string, ProjectParameterFileVersion[]>;
  contentByVersion: Map<string, Uint8Array>;
  conflictsByProject: Map<string, ParameterFileSyncConflict[]>;
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
    conflictsByProject: new Map([[DEFAULT_PROJECT_ID, [conflict]]])
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
      return { ...version };
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
    }
  };
}
