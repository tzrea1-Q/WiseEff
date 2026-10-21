export type ProjectDeletionPreview = {
  organizationId: string;
  projectId: string;
  projectName: string;
  generatedAt: string;
  /** A snapshot fingerprint, never an authorization to execute deletion. */
  stateDigest: string;
  executionAvailable: false;
  inventory: { key: string; label: string; count: number; disposition: "delete" | "detach" | "retain" }[];
  storage: { exclusiveObjects: number; sharedObjects: number; totalBytes: number };
  blockers: { code: string; count: number; message: string; action: string }[];
  notes: string[];
};
