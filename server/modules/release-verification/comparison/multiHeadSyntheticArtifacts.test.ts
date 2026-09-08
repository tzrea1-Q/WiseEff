import { expect, it } from "vitest";
import { compileCatalogRelease } from "../../catalog-kernel/compiler";
import {
  reviewedSyntheticBundle,
  syntheticIinArrayValueSchema,
  syntheticTarget,
} from "./__fixtures__/multiHeadSyntheticArtifacts";

it("compiles the reviewed multi-head artifact with the authored array target", () => {
  const bundle = reviewedSyntheticBundle();
  expect(bundle.releases).toHaveLength(1);
  expect(bundle.targetReleaseId).toBe(bundle.releases[0]!.manifest.release.id);
  expect(bundle.releases[0]!.manifest.release.predecessor).toBeNull();

  const target = bundle.releases[0]!;
  const iinMax = target.documents.find((document) => document.kind === "definition"
    && document.content.id === syntheticTarget.definitions.iin_max.id);
  expect(iinMax).toMatchObject({
    kind: "definition",
    content: {
      revision: {
        id: syntheticTarget.definitions.iin_max.revisionId,
        valueSchema: syntheticIinArrayValueSchema,
      },
    },
  });

  const compiled = compileCatalogRelease(bundle);
  expect(compiled).toMatchObject({ ok: true });
});
