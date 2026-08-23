import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  openSync,
  realpathSync,
  renameSync,
  rmSync,
} from "node:fs";
import path from "node:path";

export type ExactOwnedDirectoryIdentity = {
  path: string;
  realPath: string;
  device: number;
  inode: number;
};

export function captureExactOwnedDirectoryChain(
  trustedAnchor: string,
  targetRoot: string,
): ExactOwnedDirectoryIdentity[] {
  const anchor = path.resolve(trustedAnchor);
  const target = path.resolve(targetRoot);
  const relative = path.relative(anchor, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Owned object root must be a strict descendant of its trusted anchor.");
  }
  const identities = [captureDirectoryIdentity(anchor)];
  let current = anchor;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    identities.push(captureDirectoryIdentity(current));
  }
  const anchorRealPath = identities[0]!.realPath;
  for (const identity of identities.slice(1)) {
    const actualRelative = path.relative(anchorRealPath, identity.realPath);
    if (!actualRelative || actualRelative.startsWith("..") || path.isAbsolute(actualRelative)) {
      throw new Error("Owned object directory chain resolves outside its trusted anchor.");
    }
  }
  return identities;
}

export function assertExactOwnedDirectoryChain(
  identities: readonly ExactOwnedDirectoryIdentity[],
) {
  if (identities.length < 2) throw new Error("Owned object directory chain is incomplete.");
  assertDirectoryIdentities(identities);
}

function assertDirectoryIdentities(identities: readonly ExactOwnedDirectoryIdentity[]) {
  for (const identity of identities) assertDirectoryIdentity(identity.path, identity, true);
}

export function removeExactlyOwnedObjectRoot(input: {
  directoryChain: readonly ExactOwnedDirectoryIdentity[];
  verifyMarker(rootPath: string): void;
}) {
  assertExactOwnedDirectoryChain(input.directoryChain);
  const rootIdentity = input.directoryChain.at(-1)!;
  const containerIdentity = input.directoryChain.at(-2)!;
  if (path.dirname(rootIdentity.path) !== containerIdentity.path) {
    throw new Error("Owned object root is not directly contained by its recorded parent.");
  }
  input.verifyMarker(rootIdentity.path);
  const quarantine = path.join(
    containerIdentity.path,
    `.wiseeff-owned-object-removal-${randomUUID()}`,
  );
  if (existsSync(quarantine)) throw new Error("Owned object removal quarantine already exists.");
  renameSync(rootIdentity.path, quarantine);
  fsyncDirectory(containerIdentity.path);

  // The recursive operation is allowed only after the moved inode and every
  // surviving ancestor are re-proved at the destructive boundary.
  assertDirectoryIdentities(input.directoryChain.slice(0, -1));
  assertDirectoryIdentity(quarantine, rootIdentity, false);
  const quarantineRealPath = realpathSync(quarantine);
  if (path.dirname(quarantineRealPath) !== containerIdentity.realPath) {
    throw new Error("Owned object removal quarantine escaped its recorded container.");
  }
  input.verifyMarker(quarantine);
  // Marker verification itself performs path-based I/O. Re-prove the entire
  // chain once more immediately before the only recursive operation so a
  // same-name replacement cannot become the rm target during that check.
  assertDirectoryIdentities(input.directoryChain.slice(0, -1));
  assertDirectoryIdentity(quarantine, rootIdentity, false);
  rmSync(quarantine, { recursive: true, force: false });
  fsyncDirectory(containerIdentity.path);
  if (existsSync(quarantine)) throw new Error("Owned object removal quarantine still exists.");
}

function captureDirectoryIdentity(directory: string): ExactOwnedDirectoryIdentity {
  const resolved = path.resolve(directory);
  const stat = lstatSync(resolved);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error("Owned object directory chain contains a symbolic link or non-directory.");
  }
  return {
    path: resolved,
    realPath: realpathSync(resolved),
    device: stat.dev,
    inode: stat.ino,
  };
}

function assertDirectoryIdentity(
  directory: string,
  expected: ExactOwnedDirectoryIdentity,
  requireRealPath: boolean,
) {
  const stat = lstatSync(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error("Owned object directory chain contains a symbolic link or non-directory.");
  }
  if (stat.dev !== expected.device || stat.ino !== expected.inode) {
    throw new Error("Owned object directory identity changed before recursive removal.");
  }
  if (requireRealPath && realpathSync(directory) !== expected.realPath) {
    throw new Error("Owned object directory real path changed before recursive removal.");
  }
}

function fsyncDirectory(directory: string) {
  if (process.platform === "win32") return;
  const descriptor = openSync(directory, "r");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}
