import { afterEach, describe, expect, it } from "vitest";

import { emptyPublicationDraft } from "./publicationState";
import {
  clearStoredPublicationJob,
  PUBLICATION_JOB_STORAGE_KEY,
  readStoredPublicationJob,
  writeStoredPublicationJob
} from "./publicationJobStorage";

describe("publication job restore", () => {
  afterEach(() => {
    window.localStorage.removeItem(PUBLICATION_JOB_STORAGE_KEY);
  });

  it("restores a saved job for the same user and keeps the draft", () => {
    const draft = { ...emptyPublicationDraft(), propertyKey: "iin_hold", displayName: "保持电流" };
    writeStoredPublicationJob({
      jobId: "cjob_01KPAGE_1",
      candidateId: "ccand_01KPAGE_1",
      catalogReleaseId: "crel_01K42",
      userId: "user_author",
      organizationId: "org_acme",
      draft,
      idempotencyKey: "pub-1"
    });
    expect(readStoredPublicationJob({ userId: "user_author", organizationId: "org_acme" })).toMatchObject({
      jobId: "cjob_01KPAGE_1",
      draft: { propertyKey: "iin_hold" }
    });
    expect(readStoredPublicationJob({ userId: "other", organizationId: "org_acme" })).toBeNull();
    clearStoredPublicationJob();
    expect(readStoredPublicationJob({ userId: "user_author", organizationId: "org_acme" })).toBeNull();
  });
});
