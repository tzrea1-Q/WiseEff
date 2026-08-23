import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  captureExactOwnedDirectoryChain,
  removeExactlyOwnedObjectRoot,
} from "./exact-owned-object-root";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("exact owned object-root removal", () => {
  it("revalidates the container identity after the final marker read", () => {
    const trustedRoot = mkdtempSync(path.join(tmpdir(), "wiseeff-exact-object-remove-"));
    roots.push(trustedRoot);
    const container = path.join(trustedRoot, "container");
    const objectRoot = path.join(container, "owned");
    const markerName = ".owner.json";
    mkdirSync(objectRoot, { recursive: true });
    writeFileSync(path.join(objectRoot, markerName), "owned\n", "utf8");
    const directoryChain = captureExactOwnedDirectoryChain(trustedRoot, objectRoot);
    const displacedContainer = `${container}.displaced`;
    let foreignSentinel = "";
    let markerReads = 0;

    expect(() => removeExactlyOwnedObjectRoot({
      directoryChain,
      verifyMarker(rootPath) {
        expect(readFileSync(path.join(rootPath, markerName), "utf8")).toBe("owned\n");
        markerReads += 1;
        if (markerReads !== 2) return;
        const quarantineName = path.basename(rootPath);
        renameSync(container, displacedContainer);
        const foreignQuarantine = path.join(container, quarantineName);
        mkdirSync(foreignQuarantine, { recursive: true });
        writeFileSync(path.join(foreignQuarantine, markerName), "owned\n", "utf8");
        foreignSentinel = path.join(foreignQuarantine, "must-retain.txt");
        writeFileSync(foreignSentinel, "external\n", "utf8");
      },
    })).toThrow(/directory identity|owned object/i);

    expect(foreignSentinel).not.toBe("");
    expect(existsSync(foreignSentinel)).toBe(true);
    expect(existsSync(path.join(displacedContainer, path.basename(objectRoot)))).toBe(false);
  });
});
