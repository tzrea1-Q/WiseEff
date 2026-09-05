import { describe, expect, it } from "vitest";

import {
  CATALOG_PAGE_PATH,
  buildCatalogHref,
  parseCatalogUrlAnchor,
  readLegacyCatalogBookmark,
  serializeCatalogUrlAnchor
} from "./urlAnchor";
import { CATALOG_DEFINITION_ID, CATALOG_RELEASE_ID, CATALOG_REVIEW_ITEM_ID, CATALOG_SUBJECT_ID } from "./fixtures";

describe("catalog URL and release anchors", () => {
  it("round-trips opaque subject, definition, review, and catalog release ids", () => {
    const search = serializeCatalogUrlAnchor({
      subjectId: CATALOG_SUBJECT_ID,
      definitionId: CATALOG_DEFINITION_ID,
      catalogReleaseId: CATALOG_RELEASE_ID,
      reviewItemId: CATALOG_REVIEW_ITEM_ID
    });
    expect(search).toBe(
      `?subjectId=${CATALOG_SUBJECT_ID}&definitionId=${CATALOG_DEFINITION_ID}&catalogReleaseId=${CATALOG_RELEASE_ID}&reviewItemId=${CATALOG_REVIEW_ITEM_ID}`
    );
    expect(parseCatalogUrlAnchor(search)).toEqual({
      subjectId: CATALOG_SUBJECT_ID,
      definitionId: CATALOG_DEFINITION_ID,
      catalogReleaseId: CATALOG_RELEASE_ID,
      reviewItemId: CATALOG_REVIEW_ITEM_ID
    });
    expect(buildCatalogHref(parseCatalogUrlAnchor(search)).startsWith(CATALOG_PAGE_PATH)).toBe(true);
  });

  it("drops Effective/Governance peer query keys and never re-emits them", () => {
    const parsed = parseCatalogUrlAnchor(
      "?catalogView=governance&view=effective&spec=spec-1&parameterSpecId=spec-1&subjectId=csub_01KSC8562&catalogReleaseId=crel_01K42"
    );
    expect(parsed).toEqual({
      subjectId: "csub_01KSC8562",
      definitionId: null,
      catalogReleaseId: "crel_01K42",
      reviewItemId: null
    });
    expect(parsed).not.toHaveProperty("catalogView");
    const href = buildCatalogHref(parsed);
    expect(href).toBe("/parameter-admin/specs?subjectId=csub_01KSC8562&catalogReleaseId=crel_01K42");
    expect(href).not.toMatch(/catalogView|view=effective|view=governance|parameterSpecId|(^|[?&])spec=/);
  });

  it("treats blank opaque ids as absent instead of inventing a current release", () => {
    expect(parseCatalogUrlAnchor("?subjectId=&catalogReleaseId=")).toEqual({
      subjectId: null,
      definitionId: null,
      catalogReleaseId: null,
      reviewItemId: null
    });
    expect(serializeCatalogUrlAnchor(parseCatalogUrlAnchor(""))).toBe("");
  });

  it("reads leftover spec-library keys as official legacy bookmarks, not search text", () => {
    expect(readLegacyCatalogBookmark("?spec=spec-sc8562-gpio-int&q=gpio")).toEqual({
      legacyType: "parameter-spec",
      legacyId: "spec-sc8562-gpio-int"
    });
    expect(readLegacyCatalogBookmark("?parameterSpecId=spec-sc8562-gpio-int")).toEqual({
      legacyType: "parameter-spec",
      legacyId: "spec-sc8562-gpio-int"
    });
    expect(readLegacyCatalogBookmark("?q=gpio&subjectId=csub_01KSC8562")).toBeNull();
  });
});
