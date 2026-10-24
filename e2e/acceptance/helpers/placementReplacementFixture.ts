import { firstReleaseBundle, refreshReleaseSource } from "../../../server/modules/catalog-kernel/runtime/catalogChain.fixture";

export const PLACEMENT_PEER_SUBJECT_ID = "csub_placement_peer";
export const PLACEMENT_PEER_COMPATIBLE = "acme,placement-peer";

/** One fresh published release with two compatible active driver identities. */
export function placementReplacementBundle() {
  const bundle = firstReleaseBundle();
  const release = structuredClone(bundle.releases[0]) as Parameters<typeof refreshReleaseSource>[0];
  const subject = release.documents.find((document) => document.kind === "subject");
  const definition = release.documents.find((document) => document.kind === "definition");
  if (subject?.kind !== "subject" || definition?.kind !== "definition") throw new Error("Replacement fixture requires a driver and definition");
  release.documents.push({ ...structuredClone(subject), content: {
    ...structuredClone(subject.content), id: PLACEMENT_PEER_SUBJECT_ID, canonicalKey: `driver:${PLACEMENT_PEER_COMPATIBLE}`,
    selector: { ...structuredClone(subject.content.selector), value: PLACEMENT_PEER_COMPATIBLE }
  } }, { ...structuredClone(definition), content: {
    ...structuredClone(definition.content), id: "pdef_placement_peer_iin_max", subjectId: PLACEMENT_PEER_SUBJECT_ID,
    revision: { ...structuredClone(definition.content.revision), id: "drev_placement_peer_iin_max_1" }
  } });
  refreshReleaseSource(release);
  return { ...bundle, releases: [release] };
}
