# ADR-0052: Shared source versions pin complete project dependency closures

> Chinese companion: [Chinese](../zh-CN/design-docs/adr-0052-shared-source-versions-pin-project-dependency-closures.md)

Date: 2026-10-25

## Status

Accepted implementation architecture for [#1410](https://github.com/tzrea1-Q/WiseEff/issues/1410), extended by #1417. This records the approved shared-source boundary without changing ADR-0040, ADR-0043 or ADR-0046.

An Organization owns stable shared-source resources and immutable published revisions. Each revision preserves its own original members and pins exact dependency revision IDs and relative mount directories. Publication validates and freezes the complete bounded acyclic closure, original checksums and include graph; it never resolves a version range or fetches network source. Two paths selecting different versions or mounts of one resource, colliding source paths or labels, and unresolved required files block publication or project composition. An incomplete draft remains editable.

Project composition consumes the complete authorized closure through the existing canonical member-addition preview/application transaction. Each project derives its own immutable source rows, while exact repeated dependencies within that project may reuse an already matching fixed reference. Reference identity comes from resource/revision/member IDs, never a filename or hash. Existing include search and overlay order are frozen; shared includes follow existing shared includes and precede private declarations. All derived source versions and the private-root edit require one exact frozen receipt, retaining private JSON, source occurrences, Binding continuity and history. Ordinary source writers cannot edit or disconnect shared snapshots.

Account deletion detaches live actor references while preserving approved composition and conversion receipts. Historical rechecks use the exact applied revision manifest, upstream member bytes and original import evidence after references are replaced or private ownership is restored. Initial application still requires the current references; retained receipts and source remain immutable.

Separate configurations in one project may reference identical logical source paths. Derived shared files use the existing configuration-specific physical filename namespace, while manifests, includes, exports and public file labels retain the original mounted paths. The project-wide legacy filename uniqueness and lookup contract remain intact. Version uploads addressed by file ID retain that exact authorized target instead of resolving a displayed logical name again; occupied physical identities refuse the complete composition without replacing another file.

Shared publication changes no project and writes no Catalog definitions. The unique Catalog synchronizer remains the owner under [ADR-0040](0040-canonical-parameter-catalog-relational-model.md) and [ADR-0043](0043-catalog-authoring-and-online-publication.md); source occurrence identity and proven origin transfer retain [ADR-0046](0046-source-occurrence-identity-spans-dts-and-software-configuration.md). Direct and indirect project usage reads filter both rows and totals by current authorization. Headers are original build inputs, not standalone DTS declarations; deterministic preprocessing owns their interpretation. Reference version changes and full snapshot restoration remain distinct governed operations.
