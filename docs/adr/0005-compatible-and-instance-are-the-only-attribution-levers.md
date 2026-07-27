# Compatible and instance are the only attribution levers

`parameter_module_mappings.match_kind` has always accepted three values — `driver`, `compatible`, `instance` — and the admin surface presented them as three equal ways to attribute parameters, with the largest queue on the page dedicated to unmapped drivers. Only two of them work. Every binding write goes through `resolveBindingInstanceModuleId`, which consults an instance mapping, then a compatible mapping, and otherwise parks the binding in a `未分类 · {label}` bucket; a driver mapping is only ever read by the `resolveModuleIdForBinding` fallback, which is reached only when the binding has neither an instance name nor a compatible. Bindings parsed from DTS essentially always have an instance name, so driver mappings decide nothing. Creating one still made the driver disappear from the queue and added a row to the rules list, so the product reported work as done that had no effect on a single parameter.

We decided to retire `driver` as a match kind rather than repair it: attribution is expressed by compatible (which device model this is) and by instance (which specific device on this board), and the driver module name stays as displayed provenance only.

## Considered Options

- **Make driver mappings work as a last-resort catch-all** — consult a driver mapping just before falling back to `未分类`, so one rule could sweep up every parameter of a driver. Rejected because it makes the priority story harder to explain for a lever nobody needs: a compatible already identifies the device model more precisely than the driver name does, and the only bindings a driver rule would newly catch are the ones a compatible rule catches better.
- **Keep the kind and label it accurately in the UI** — annotate driver rules as "only applies when instance and compatible are both missing". Rejected because it preserves a queue that can never be productively worked, on the page whose entire purpose is now to be worked to empty.

## Consequences

- The migration deletes existing `driver` rows from `parameter_module_mappings` and drops `driver` from the `match_kind` check constraint. The row count is recorded before deletion; the rules were inert, so no parameter attribution changes as a result.
- The `待归类驱动（driver）` queue disappears, and with it the frontend aggregation over `listSpecs()` that fed it — a second, spec-library-scoped definition of "observed driver" that never agreed with the server's binding-scoped compatible hints.
- `deriveModuleAssignment` in `src/domain/parameter-topology/moduleRegistry.ts` loses its driver arm. It survives only as the parameter-spec library's prediction of where a spec's parameters would land, and is narrowed to compatible and instance.
- The page can no longer honestly be called 驱动归属配置; the surface is renamed around modules rather than drivers.
