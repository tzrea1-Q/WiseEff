import { createHash } from "node:crypto";

import { SEED_SOURCE_FILE_NAMES } from "./powerConfig";

export type SeedDigestFile = {
  readonly projectId: string;
  readonly name: (typeof SEED_SOURCE_FILE_NAMES)[number];
  readonly content: string;
};

const sha256Hex = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");

/**
 * Exact T1.3 seed digest payload. Omitting power-config.json changes the digest,
 * so a DTS-only hash cannot already-complete skip JSON.
 */
export const canonicalSeedInitializationDigest = (input: {
  readonly organizationId: string;
  readonly files: readonly SeedDigestFile[];
}): string => {
  const byProject = new Map<string, Map<string, string>>();
  for (const file of input.files) {
    const project = byProject.get(file.projectId) ?? new Map<string, string>();
    project.set(file.name, sha256Hex(file.content));
    byProject.set(file.projectId, project);
  }
  const targets = [...byProject.keys()].sort();
  const lines = [
    "wiseeff.seed-initialization.digest.v1",
    `organization=${input.organizationId}`,
    `targets=${targets.join(",")}`,
  ];
  for (const projectId of targets) {
    const files = byProject.get(projectId)!;
    for (const name of SEED_SOURCE_FILE_NAMES) {
      const digest = files.get(name);
      if (!digest) {
        throw new Error(`Seed digest is missing ${projectId}/${name}`);
      }
      lines.push(`${projectId}/${name}=${digest}`);
    }
  }
  return `sha256:${sha256Hex(`${lines.join("\n")}\n`)}`;
};
