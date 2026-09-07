# CGH comparison through the production Catalog reader

[中文](parameterCatalogComparisonRouting.zh-CN.md)

The CGH comparison provider now registers the public `registerParameterCatalogApi`
composition on a private `createRouter` instance and dispatches three fixed GETs:
definitions, organization registrations and organization review items. It no longer
constructs its own `SELECT 1` readiness, unregistered projection, zero usage
projection or empty governance query ports. The production composition owns the
actual pointer/Kernel, registration and usage queries and their refusal semantics.

Before any inventory query, the provider requires the database's actual registered
root pool to be the supplied pool. A facade, transaction handle or different pool
is refused. The request fields are copied before asynchronous work. The router is
registered with `requireSeparateGovernancePool: true` and no `governanceDb`.
Neither management credentials nor a command-pool fallback are introduced.

An unsuccessful canonical read is not zero inventory. The provider throws
`CghComparisonQueryError`, with the existing
`PCAT-CMP-UNQUERYABLE-PROTECTED-REFERENCE` code, the observed HTTP code and a fixed
operation label. It does not copy response bodies or database diagnostics into
that error. No contribution or passing report is produced from failed collection.
Unknown thrown errors still fail; they are not converted into absent/value results.
The existing v1 comparison format and no-inferred-disposition classification stay
unchanged for successfully queryable observations.

## Boundaries and regression matrix

| Risk | Regression |
| --- | --- |
| Wrong/facade pool or caller changes the request while awaiting a query | Refusal before target queries, or continued use of the pinned root |
| Unready canonical schema mistaken for fresh zero | Actual router current-pointer reads refuse, even when complete old inventory is zero |
| Query pool accidentally gains governance writes | Separate-command requirement, no governance DB, and Review GET cannot activate the lazy writer |
| Definition reads use fake empty registration/usage | Formal production adapters; restricted reader's missing domain privileges remain unavailable |
| Safety repair removes legitimate equality/checksum checks | The 36 classification cases keep all families, actual provider/aggregate/generator entrypoints, and CGH serialization/order/phase checks |
| Refusal silently discards old-source test coverage | Independent test-only complete old-source enumeration, full Review pagination, stable IDs/counts/checksums and unchanged Review states; other ten contributions retain their full checks |

The dedicated pure routing tests use actual issued root objects and the real
production router. The separate classification suite mocks the public CGH GET
transport and domain I/O solely to test classification; it is not authentication,
database or runtime-admission evidence. The dedicated PG test uses the existing
owned PG16 receipt/identity fixture, the real compiler/installer chain and actual
restricted LOGIN connections. Its success claim is the Catalog document only;
definition-domain failures and Review refusal are separate checks. The parent
registers and runs that file in the mandatory owned component lane. No ambient
database, local default port or unverified Docker target is accepted by its fixture.

The new integration test is owned by the formal API composition:
`parameter-catalog-api/cghReadProjection.integration.test.ts`. Its installer
fixture and raw negative permission assertions follow the existing production
composition tests' ownership. An unsealed draft placed those tests in the CGH
consumer directory and triggered three boundary findings: one private Kernel
fixture import and two Catalog raw-access statements. The test was assigned to
its actual composition owner with all SQL and denial assertions preserved.
The CGH production module stays in place and imports only public interfaces.
Boundary scanning remains enabled; no allowance or trusted inventory changes.

## Remaining integration work

At the pinned dependency, the production Review list/get reader performs a lazy
`INSERT` inside its read operation. GET is therefore not proof of physical read-only
behavior. With no command pool, production composition refuses Review access.
This change preserves that protection; a persisted-only read projection needs its
own domain-owned implementation. It does not reuse the lazy writer or add grants.

The existing synthetic `inventoryAuth`, first-organization selection, definition
item-count observation and incomplete pagination/semantic comparison remain
outside this bounded wiring change. Policy usage's fixed zero does not close #815.
A valid document is not a successful D01 comparison, approved runtime pin, P12/P13,
or full populated upgrade. No production access or release approval is provided.

Documentation impact is this English/Chinese pair and the parent comparison
evidence record. The source and test-only dependencies are pinned separately from
the implementation commits; no migration, permission manifest, parser, allowance,
trusted baseline or shared production composition is changed by this unit.
