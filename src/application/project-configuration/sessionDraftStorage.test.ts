import { describe, expect, it } from "vitest";

import type { SessionPropertyDraft } from "./sessionDrafts";
import {
  classifySessionDraftRecovery,
  clearSessionDraftsForLogout,
  clearSharedSwitchTasksForLogout,
  findRecoverableSessionDraft,
  readSessionDraftStore,
  removeSessionDraftBucket,
  upsertSessionDraftBucket,
  SESSION_DRAFT_STORAGE_KEY,
  type SessionDraftScope
} from "./sessionDraftStorage";

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

const scope: SessionDraftScope = {
  userId: "user-a",
  organizationId: "org-1",
  projectId: "project-1",
  configSetId: "cs-default",
  fileId: "file-board",
  baseVersionId: "version-board-12"
};

const draft: SessionPropertyDraft = {
  rawText: '"Aurora-X"',
  normalizedValue: "Aurora-X",
  valid: true
};

describe("sessionDraftStorage", () => {
  it("persists patches, reason, and selected identities scoped by user/org/project/config/file/base", () => {
    const storage = createMemoryStorage();
    upsertSessionDraftBucket(
      {
        scope,
        drafts: { "file-board::board::model": draft },
        selectedKeys: ["file-board::board::model"],
        reason: "tune board model",
        updatedAt: "2026-08-07T10:00:00.000Z"
      },
      storage
    );

    const store = readSessionDraftStore(storage);
    expect(store.buckets).toHaveLength(1);
    expect(store.buckets[0]).toEqual(
      expect.objectContaining({
        scope,
        reason: "tune board model",
        selectedKeys: ["file-board::board::model"],
        drafts: { "file-board::board::model": draft }
      })
    );
    expect(JSON.stringify(store)).not.toMatch(/\/dts|sourceText|fullSource/);
  });

  it("restores a compatible bucket for the same scope and classifies matching base as compatible", () => {
    const storage = createMemoryStorage();
    upsertSessionDraftBucket(
      {
        scope,
        drafts: { "file-board::board::model": draft },
        selectedKeys: ["file-board::board::model"],
        reason: "tune board model",
        updatedAt: "2026-08-07T10:00:00.000Z"
      },
      storage
    );

    const recovered = findRecoverableSessionDraft(scope, storage);
    expect(recovered?.classification).toBe("compatible");
    expect(recovered?.bucket.drafts["file-board::board::model"]).toEqual(draft);
    expect(classifySessionDraftRecovery(scope, scope)).toBe("compatible");
  });

  it("marks a matching identity with a changed base version as stale-base", () => {
    const storage = createMemoryStorage();
    upsertSessionDraftBucket(
      {
        scope,
        drafts: { "file-board::board::model": draft },
        selectedKeys: ["file-board::board::model"],
        reason: "tune board model",
        updatedAt: "2026-08-07T10:00:00.000Z"
      },
      storage
    );

    const current = { ...scope, baseVersionId: "version-board-13" };
    const recovered = findRecoverableSessionDraft(current, storage);
    expect(recovered?.classification).toBe("stale-base");
    expect(recovered?.bucket.drafts["file-board::board::model"]).toEqual(draft);
    expect(classifySessionDraftRecovery(scope, current)).toBe("stale-base");
  });

  it("does not restore across users, organizations, projects, or config sets", () => {
    const storage = createMemoryStorage();
    upsertSessionDraftBucket(
      {
        scope,
        drafts: { "file-board::board::model": draft },
        selectedKeys: ["file-board::board::model"],
        reason: "tune board model",
        updatedAt: "2026-08-07T10:00:00.000Z"
      },
      storage
    );

    expect(findRecoverableSessionDraft({ ...scope, userId: "user-b" }, storage)).toBeNull();
    expect(findRecoverableSessionDraft({ ...scope, organizationId: "org-2" }, storage)).toBeNull();
    expect(findRecoverableSessionDraft({ ...scope, projectId: "project-2" }, storage)).toBeNull();
    expect(findRecoverableSessionDraft({ ...scope, configSetId: "cs-other" }, storage)).toBeNull();
    expect(findRecoverableSessionDraft({ ...scope, fileId: "file-other" }, storage)).toBeNull();
  });

  it("clears all recoverable drafts on logout and removes emptied buckets", () => {
    const storage = createMemoryStorage();
    upsertSessionDraftBucket(
      {
        scope,
        drafts: { "file-board::board::model": draft },
        selectedKeys: ["file-board::board::model"],
        reason: "tune board model",
        updatedAt: "2026-08-07T10:00:00.000Z"
      },
      storage
    );
    clearSessionDraftsForLogout(storage);
    expect(readSessionDraftStore(storage).buckets).toEqual([]);
    expect(findRecoverableSessionDraft(scope, storage)).toBeNull();
  });

  it("removes only shared switch drafts when logging out",()=>{
    const storage=createMemoryStorage({"wiseeff.shared-switch:user:org:project:config":"reason", "other-session-value":"keep"});
    clearSharedSwitchTasksForLogout(storage);
    expect(storage.getItem("wiseeff.shared-switch:user:org:project:config")).toBeNull();
    expect(storage.getItem("other-session-value")).toBe("keep");
  });

  it("removes a bucket when drafts are discarded or submitted empty", () => {
    const storage = createMemoryStorage();
    upsertSessionDraftBucket(
      {
        scope,
        drafts: { "file-board::board::model": draft },
        selectedKeys: ["file-board::board::model"],
        reason: "tune board model",
        updatedAt: "2026-08-07T10:00:00.000Z"
      },
      storage
    );
    removeSessionDraftBucket(scope, storage);
    expect(findRecoverableSessionDraft(scope, storage)).toBeNull();
  });

  it("persists incomplete cell positions alongside v1 patches", () => {
    const storage = createMemoryStorage();
    const pending: SessionPropertyDraft = {
      rawText: "< 0>, <- 0x>", normalizedValue: "pending", valid: false,
      editorState: { kind: "cells", bits: 32, groups: [["", "0"], ["-", "0x"]] }
    };
    expect(upsertSessionDraftBucket({ scope, drafts: { "file-board::board::values": pending },
      selectedKeys: [], reason: "pending", updatedAt: "2026-10-19T00:00:00.000Z" }, storage)).toBe(true);
    expect(findRecoverableSessionDraft(scope, storage)?.bucket.drafts["file-board::board::values"]).toEqual(pending);
  });

  it("rejects an invalid editor-state shape without trusting stored validity", () => {
    const storage = createMemoryStorage({ [SESSION_DRAFT_STORAGE_KEY]: JSON.stringify({ version: 1, buckets: [{
      scope, drafts: { "board::values": { ...draft, valid: true,
        editorState: { kind: "cells", bits: 32, groups: [[null]] } } },
      selectedKeys: [], reason: "pending", updatedAt: "2026-10-19T00:00:00.000Z"
    }] }) });
    expect(findRecoverableSessionDraft(scope, storage)).toBeNull();
  });

  it("reports write/remove failures and does not overwrite buckets when reading fails", () => {
    const storage = createMemoryStorage();
    const bucket = { scope, drafts: { "board::model": draft }, selectedKeys: [], reason: "pending", updatedAt: "now" };
    const unavailable = { ...storage, getItem() { throw new Error("denied"); } };
    expect(upsertSessionDraftBucket(bucket, unavailable)).toBe(false);
    expect(storage.getItem(SESSION_DRAFT_STORAGE_KEY)).toBeNull();
    expect(upsertSessionDraftBucket(bucket, { ...storage, setItem() { throw new Error("full"); } })).toBe(false);
    expect(removeSessionDraftBucket(scope, { ...storage, removeItem() { throw new Error("denied"); } })).toBe(false);
  });
});
