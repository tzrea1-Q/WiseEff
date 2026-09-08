# Provider classification without inferred dispositions

[中文](provider-classification-safety.zh-CN.md)

The existing P11 contract requires a complete immutable-plan rule and actual
per-identity mapping evidence for a declared difference. A different DTO,
retired route, typed block or absent report does not supply that evidence.

The eleven production comparison providers previously constructed R1/R2/R9
dispositions from a comparison ID or fallback, sometimes using the shared
mapping-head ID as a Definition/Archive ID. This repair removes that inference:

- Both value observations equal after the existing canonical key ordering:
  `exact-equivalent`, no expected-difference evidence.
- Either observation is a query failure, including an unfamiliar failure code:
  `unqueryable/protected-reference-missing`, with the original observation
  retained and no invented disposition.
- Otherwise: `unexplained-difference`, no expected-difference evidence.

PRJ and DBG now return that existing typed blocking result like the other nine
families, so complete inventories and checksums remain inspectable. The actual
`generateComparisonReport` still refuses every unexplained or unqueryable case.
A fulfilled provider/aggregate promise is not verification success. The actual
PRJ/DBG consumers are the production provider registry and its aggregate; the
release integration must continue through the existing report generator and
applicable approval gates. No verifier, parser, codec, gate ID, grant, migration,
approved rule or frozen expected-difference format changes here.

## Scope and threat matrix

| Boundary | Permanent regression |
| --- | --- |
| Each of CGH/TOP/PRJ/FIL/AGT/LOG/DBG/DTS/KNW/MOD/OPS invents a disposition | Actual `provide*` entrypoints receive unequal synthetic domain/database observations; each case is unexplained with null evidence |
| Unknown query status becomes a made-up R class | HTTP 503 and unfamiliar PRJ query-failure code remain blocking; other families exercise their real query-failure wrapping |
| Legitimate equality is accidentally disabled | PRJ exact values including null and revision-selection fields, and CGH equal legacy-route outcomes remain exact |
| Returned contribution is mistaken for passed evidence | Actual eleven-provider aggregate retains unexplained cases; the actual report generator refuses them |
| Inventory failure looks like an empty source | Every provider propagates the explicit inventory failure |

`providerClassificationSafety.test.ts` mocks only existing I/O/domain ports;
it does not extract private classifier functions, replace providers, or supply
a passed report. These are pure classification regressions, not authenticated
PostgreSQL, conversion, P12/P13, application startup or full-upgrade evidence.
The ordinary server suite collects the new test. A temporary no-database config
may run it independently during development without starting shared databases.

The existing eleven real-PG provider tests retain inventory, ordering, history
of independent pre/post captures, checksum and uniqueness checks. DBG's old
assertion that its unbound synthetic fixture must never be unexplained is
replaced by an explicit prohibition on invented declared differences and a null
evidence assertion. It is not replaced by a skip or a passing release report.

The real-PG integration test retains both phases' complete old CGH source
enumeration and the other ten families' inventory counts, checksums, case order
and references. CGH now uses the actual public production router; see the
[routing contract](../../parameter-specs/parameterCatalogComparisonRouting.md).
Unavailable canonical queries throw the original typed blocking observation,
including when the old inventory is empty. The test does not invent an eleventh
contribution or claim that unavailable canonical inventory was collected. Direct
aggregation of only ten families fails missing-family, and actual eleven-family
collection fails on the real CGH query. No code or parser rule is rewritten to
issue a report. The separate classification transport fixture retains equality,
serialization, uniqueness and phase checksum checks for queryable observations.

The shared checksum-locked populated fixture contains no Review tasks. The local
integration test supplements only its disposable database through the existing
Review repository with one open and one dismissed old-schema task, both linked
to its real synthetic organization, project and config revision. Both phases
must enumerate both old Review identities and preserve their distinct statuses
and source evidence. All nine comparison IDs remain registered; missing canonical
Review inventory is not a successful D06 case or passed coverage. It changes no
shared seed, historical counts, source fixture checksum or review approval flow.

The former synthetic readiness port has been removed. Remaining controlled
identity, full semantic observations and legitimate persisted Review query
capabilities are internal integration work, independent of production backup
availability and the separate per-identity evidence format and S6 decisions.

This is the safety repair only. The separately recorded per-identity evidence
format/producer work remains necessary for legitimate declared differences and
a complete populated positive chain. Neither all-refused results nor existing
fresh/query-failure component tests close that work. #815 is unchanged.

Documentation impact is this maintained English/Chinese pair. The parent owns
the overall plan/evidence, independent review and final integration validation.
