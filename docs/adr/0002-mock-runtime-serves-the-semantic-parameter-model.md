# Mock runtime serves the semantic parameter model through the same ports

`ParameterTopologyRepository` was the only parameter port without a mock adapter, and the topology runtime seam explicitly refused any runtime mode other than `api`. Parameter admin therefore rendered two different products in one shell: the semantic spec/binding model in API mode, and the flat parameter library the identity cutover had already retired in mock mode. We decided mock mode must serve the **same semantic model through the same ports**, so the admin has one set of concepts, one component tree, and one set of tests.

## Consequences

- The mode guard is removed from the topology runtime seam, and a mock topology adapter with fixtures is added alongside the existing mock adapters for parameters, parameter files, structured DTS, and the parameter dashboard.
- Mock mode is a **data-source substitution** for demos and tests, not a product variant. New admin capabilities are implemented once, not twice.
- `configDraft.parameterLibrary` stays in the mock state because the project initialization wizard, power-management config, mock parameter repository, and project value matrix all read it. It is no longer a parameter-admin data source.
- Admin-exclusive reducer actions and their direct reducer tests retire with the old admin, since route-level tests against the port seam cover the same behavior without asserting on implementation details.
