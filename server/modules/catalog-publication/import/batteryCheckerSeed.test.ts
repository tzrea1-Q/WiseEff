import path from "node:path";
import { expect, it } from "vitest";
import { firstAcmePredecessor } from "../builder/predecessorHarness";
import { importVendorCatalog } from "./vendorAdapter";
import { childOwnerDeclarations } from "../../../../scripts/catalog-claim-child-owners";
import { compileOwnedVendorCatalogSuccessor, VENDOR_OWNED_AGGREGATE_DIGEST } from "../../../../scripts/compile-owned-vendor-catalog-release";
import { compileLocalizedVendorCatalogSuccessor } from "../../../../scripts/compile-vendor-catalog-release";

it("publishes the battery checker once under its authentication driver with shared definitions", async () => {
  const predecessor = firstAcmePredecessor();
  const schemasRoot = path.join(process.cwd(), "schemas/dts");
  let nextId = 0;
  const result = await importVendorCatalog({
    predecessorArtifact: { digest: predecessor.digest, bytes: predecessor.bytes }, schemasRoot,
    authorPrincipalId: "battery-checker-seed-author",
    identity: { candidateId: "ccand_battery_checker_seed", artifactId: "cart_battery_checker_seed",
      releaseId: "crel_battery_checker_seed", releaseVersion: "1.3.0", publishedAt: "2026-11-03T00:00:00Z",
      allocateId: (kind) => `${kind}_battery_checker_seed_${++nextId}` },
  });
  if (!result.ok || result.value.kind !== "successor" || result.value.built.kind !== "successor") {
    throw new Error(JSON.stringify(result));
  }
  const documents = result.value.built.artifact.bundle.releases.at(-1)!.documents;
  const driver = documents.find((item) => item.kind === "subject" && item.content.canonicalKey === "driver:huawei,batt_info");
  const children = documents.filter((item) => item.kind === "subject" && item.content.canonicalKey === "node-type:battery_checker");
  expect(driver).toBeDefined();
  expect(children).toHaveLength(1);
  expect(children[0]!.content).toMatchObject({ ownerSubjectId: driver!.content.id });
  const definitions = documents.flatMap((item) => item.kind === "definition" && item.content.subjectId === children[0]!.content.id
    ? [item.content.propertyKey] : []);
  expect(definitions.sort()).toEqual(["matchable", "spare-cycles"]);
  expect(childOwnerDeclarations(schemasRoot)).toContainEqual({ name: "battery_checker", compatibles: ["huawei,batt_info"] });
});

it("adds ownership to the demo lineage without changing historical releases or any Definition", async () => {
  const previous = compileLocalizedVendorCatalogSuccessor();
  const current = await compileOwnedVendorCatalogSuccessor();
  expect(current.compiled.aggregateDigest).toBe(VENDOR_OWNED_AGGREGATE_DIGEST);
  expect(current.bundle.releases.slice(0, -1)).toEqual(previous.bundle.releases);
  const before = previous.bundle.releases.at(-1)!.documents;
  const after = current.bundle.releases.at(-1)!.documents;
  const definitions = (documents: typeof after) => documents.filter((item) => item.kind === "definition")
    .map((item) => ({ content: item.content, digest: item.normalizedDigest }))
    .sort((left, right) => left.content.id.localeCompare(right.content.id));
  expect(definitions(after)).toEqual(definitions(before));
  expect(after.filter((item) => item.kind === "subject").map((item) => item.content.id).sort())
    .toEqual(before.filter((item) => item.kind === "subject").map((item) => item.content.id).sort());
  expect(after.find((item) => item.kind === "subject" && item.content.id === "csub_nt_battery_checker")?.content)
    .toMatchObject({ ownerSubjectId: "csub_drv_huawei_batt_info" });
});
