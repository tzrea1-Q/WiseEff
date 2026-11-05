import { randomUUID } from "node:crypto";
import pg from "pg";
import { expect, it } from "vitest";
import { createEphemeralTestDatabase } from "../../../testing/testDatabase";
import { compileCatalogRelease } from "../compiler";
import { validCatalogReleaseBundle } from "../compiler/__fixtures__/catalogReleaseBundle";
import type { CatalogReleaseBundle, CatalogReleaseDocument } from "../compiler/types";
import { refreshSuccessorSource } from "../../catalog-publication/builder/bundleCodec";
import { dropLabRuntimeLogins, provisionPublicationRuntimeLogins } from "../../catalog-publication/runtime/provisionRuntimeLogins";
import { createRegistrationService } from "../../parameter-governance/registration/service";
import { createCatalogKernel, jsonCatalogReleaseSource, CatalogSubjectId, DriverCompatible, NormalizedNodeTypeName } from "../interface";
import { loadOrganizationCatalogSnapshot } from "../../parameter-modules/recognitionSettings";
import { CatalogReleaseDigest, CatalogReleaseId } from "../../parameter-catalog-contract";
import { installPublishedRelease } from "./installer";

const driverA = "csub_acme_power", driverB = "publication-owner-b", childA = "publication-child-a", childB = "publication-child-b";
const seedRelease = (): CatalogReleaseBundle => {
  const first = structuredClone(validCatalogReleaseBundle().releases[0]!);
  const driver = first.documents.find(document => document.kind === "subject");
  if (driver?.kind !== "subject") throw new Error("Driver fixture missing");
  const node = (id: string, name: string, owner: string, retired = false): CatalogReleaseDocument => ({
    ...structuredClone(driver), content: { id, kind: "node-type", canonicalKey: `node-type:${name}`, ownerSubjectId: owner,
      lifecycle: retired ? "retired" : "active", selector: { kind: "node-type-name", value: name, provenance: structuredClone(driver.content.selector.provenance) },
      subtype: {}, tombstone: retired ? { reason: "Retained child", withdrawnByReleaseId: first.manifest.release.id, previousSelector: name } : null } });
  const alias = first.documents.find(document => document.kind === "alias");
  if (alias?.kind !== "alias") throw new Error("Alias fixture missing");
  const original = refreshSuccessorSource({ ...first, documents: [...first.documents,
    { ...structuredClone(driver), content: { ...structuredClone(driver.content), id: driverB, canonicalKey: "driver:vendor,publication-b",
      selector: { ...structuredClone(driver.content.selector), value: "vendor,publication-b" } } },
    node(childA, "foo", driverA), node(childB, "bar", driverB),
    { ...structuredClone(alias), content: { ...structuredClone(alias.content), id: "publication-old-alias",
      subjectId: childA, selectorKind: "node-type-name", normalizedSelector: "old_foo" } },
  ] }, first.sources[0]!.path);
  const retainedId = "organization-publication-retained";
  const retained = refreshSuccessorSource({ ...original, manifest: { ...original.manifest, release: { ...original.manifest.release,
    id: retainedId, sequence: 2, version: "2.0.0", predecessor: { id: original.manifest.release.id, digest: original.manifest.release.digest },
  } }, documents: original.documents.map(document => document.kind === "subject" && document.content.id === childB
    ? { ...document, content: { ...document.content, lifecycle: "retired", tombstone: { reason: "Retained child", withdrawnByReleaseId: retainedId, previousSelector: "bar" } } }
    : document.kind === "alias" && document.content.id === "publication-old-alias"
      ? { ...document, content: { ...document.content, lifecycle: "retired", tombstone: { reason: "Retained alias", withdrawnByReleaseId: retainedId, previousSelector: "old_foo" } } }
      : document) }, first.sources[0]!.path);
  return { schemaVersion: "1.0.0", targetReleaseId: retainedId, releases: [original, retained] };
};

const successor = (initial: CatalogReleaseBundle, kind: string): CatalogReleaseBundle => {
  const first = initial.releases.at(-1)!;
  const id = `organization-publication-${kind}`;
  const child = first.documents.find(document => document.kind === "subject" && document.content.id === childB);
  const alias = first.documents.find(document => document.kind === "alias");
  if (child?.kind !== "subject" || alias?.kind !== "alias") throw new Error("Child/alias fixture missing");
  const name = kind === "non-conflicting" ? "unique_child" : kind === "retired-alias" ? "old_foo" : "foo";
  let documents = first.documents;
  if (["canonical", "retired-subject", "retired-alias", "non-conflicting", "no-overrides"].includes(kind)) {
    if (kind === "retired-subject") documents = documents.map(document => document.kind === "subject" && document.content.id === childA
      ? { ...document, content: { ...document.content, lifecycle: "retired", tombstone: { reason: "Retained moved child", withdrawnByReleaseId: id, previousSelector: "foo" } } } : document);
    documents = [...documents, { ...structuredClone(child), content: { ...structuredClone(child.content), id: "publication-new-child",
      canonicalKey: `node-type:${name}`, selector: { ...child.content.selector, value: name },
      lifecycle: "active", tombstone: null } }];
  } else {
    documents = documents.map(document => document === child
      ? { ...child, content: { ...child.content, lifecycle: "active", tombstone: null } } : document);
    documents = [...documents, { ...structuredClone(alias), content: { ...structuredClone(alias.content), id: "publication-new-alias",
      subjectId: childB, selectorKind: "node-type-name", normalizedSelector: "foo", lifecycle: "active", tombstone: null } }];
  }
  const next = refreshSuccessorSource({ ...first, manifest: { ...first.manifest, release: { ...first.manifest.release,
    id, sequence: first.manifest.release.sequence + 1, version: "3.0.0",
    predecessor: { id: first.manifest.release.id, digest: first.manifest.release.digest },
  } }, documents: documents.map(document => structuredClone(document)) }, first.sources[0]!.path);
  return { ...initial, targetReleaseId: next.manifest.release.id, releases: [...initial.releases, next] };
};

it.each(["canonical", "alias", "retired-subject", "retired-alias", "reactivation", "non-conflicting", "no-overrides"])(
  "validates organization ownership when publishing %s without losing the previous Catalog", async kind => {
    const lane = await createEphemeralTestDatabase(`org-owner-publish-${kind}`);
    const admin = new pg.Pool({ connectionString: lane.url });
    let api: pg.Pool | undefined, publisher: pg.Pool | undefined;
    const token = `ownerpub${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    try {
      const initial = seedRelease();
      const compiled = compileCatalogRelease(initial);
      expect(compiled.ok, JSON.stringify(compiled)).toBe(true);
      if (!compiled.ok) return;
      const original = initial.releases[0]!;
      const bootstrap = await installPublishedRelease(admin, { mode: "bootstrap", source: jsonCatalogReleaseSource({ ...initial,
        targetReleaseId: original.manifest.release.id, releases: [original] }), expectedTargetDigest: CatalogReleaseDigest(original.manifest.release.digest) });
      expect(bootstrap.ok, JSON.stringify(bootstrap)).toBe(true);
      const seed = await installPublishedRelease(admin, { mode: "advance", source: jsonCatalogReleaseSource(initial),
        expectedTargetDigest: compiled.value.aggregateDigest,
        expectedCurrent: { id: CatalogReleaseId(original.manifest.release.id), digest: CatalogReleaseDigest(original.manifest.release.digest) } });
      expect(seed.ok, JSON.stringify(seed)).toBe(true);
      const pin = { id: compiled.value.release.id, digest: compiled.value.release.digest };
      const runtime = await provisionPublicationRuntimeLogins(lane.url, { mode: "lab", runToken: token });
      api = new pg.Pool({ connectionString: runtime.apiUrl });
      publisher = new pg.Pool({ connectionString: runtime.managerUrl, options: "-c role=catalog_synchronizer_role" });
      expect((await publisher.query("select current_user,rolsuper from pg_roles where rolname=current_user")).rows[0])
        .toEqual({ current_user: "catalog_synchronizer_role", rolsuper: false });
      await admin.query("insert into organizations(id,name) values ('owner-org-one','One'),('owner-org-two','Two')");
      for (const organizationId of ["owner-org-one", "owner-org-two"]) {
        for (const subjectId of [driverA, driverB]) {
          const moduleId = `${organizationId}-${subjectId}`;
          await admin.query(`insert into parameter_modules(id,organization_id,name,path,depth,kind,origin)
            values ($1,$2,$1,$1,1,'business','curated')`, [moduleId, organizationId]);
          const registered = await createRegistrationService(api).execute({ kind: "register", organizationId, subjectId: CatalogSubjectId(subjectId),
            subjectKind: "driver", expectedRelease: pin, placement: { mode: "use-default" }, destinationModuleId: moduleId,
            method: "explicit", proof: {}, idempotencyKey: randomUUID(), context: { actorKind: "org-admin", principalId: "owner-admin" } });
          if (!registered.ok) throw new Error(JSON.stringify(registered));
        }
      }
      if (kind !== "no-overrides") await api.query(`update parameter_catalog.organization_subject_registrations set owner_subject_id=$1
        where organization_id='owner-org-one' and subject_id=$2`, [driverB, childA]);
      const retained = async () => (await admin.query(`select
        (select to_jsonb(s) from parameter_catalog.catalog_state s) as pointer,
        (select jsonb_agg(to_jsonb(r) order by r.id) from parameter_catalog.catalog_releases r) as releases,
        (select jsonb_agg(to_jsonb(s) order by s.id) from parameter_catalog.catalog_subjects s) as subjects,
        (select jsonb_agg(to_jsonb(a) order by a.id) from parameter_catalog.catalog_subject_aliases a) as aliases,
        (select jsonb_agg(to_jsonb(r) order by r.id) from parameter_catalog.organization_subject_registrations r) as registrations,
        (select jsonb_agg(to_jsonb(m) order by m.release_id) from parameter_catalog.catalog_materializations m) as materializations`)).rows;
      const before = await retained();
      const next = successor(initial, kind);
      const compiledNext = compileCatalogRelease(next);
      expect(compiledNext.ok, JSON.stringify(compiledNext)).toBe(true);
      if (!compiledNext.ok) return;
      const installed = await installPublishedRelease(publisher, { mode: "advance", source: jsonCatalogReleaseSource(next),
        expectedTargetDigest: compiledNext.value.aggregateDigest, expectedCurrent: pin });
      if (kind === "non-conflicting" || kind === "no-overrides") {
        expect(installed.ok, JSON.stringify(installed)).toBe(true);
      } else {
        expect(installed).toMatchObject({ ok: false, error: { kind: "invalid-release", violations: [
          { location: { value: "organization-subject-owners" }, detail: expect.stringContaining("organization driver attribution") },
        ] } });
        expect(await retained()).toEqual(before);
        expect((await api.query("select 1 from parameter_catalog.organization_subject_registrations where subject_id='publication-new-child'")).rows).toEqual([]);
        const loaded = await createCatalogKernel(api).loadCurrentCatalog(pin);
        if (!loaded.ok) throw new Error(JSON.stringify(loaded));
        const selector = { driverCompatibles: [], nodeTypeFallback: { kind: "present" as const, name: NormalizedNodeTypeName("foo") } };
        expect((await loadOrganizationCatalogSnapshot(api, "owner-org-one", loaded.value)).resolveSubject({ ...selector, ownerContext: [DriverCompatible("vendor,publication-b")] }))
          .toMatchObject({ status: "matched", subject: { id: childA } });
        expect((await loadOrganizationCatalogSnapshot(api, "owner-org-two", loaded.value)).resolveSubject({ ...selector, ownerContext: [DriverCompatible("acme,power")] }))
          .toMatchObject({ status: "matched", subject: { id: childA } });
      }
    } finally {
      await api?.end(); await publisher?.end();
      await dropLabRuntimeLogins(lane.url, token);
      await admin.end(); await lane.drop();
    }
  }, 120_000,
);
