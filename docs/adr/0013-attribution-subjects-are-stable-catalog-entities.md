# Attribution subjects are stable catalog entities

ADR-0007 made the driver registry a read view over curated driver-group modules so that registering a driver and attributing parameters stayed one act. ADR-0010 then made the module tree taxonomy-only: bindings hang from driver groups and node-type units, while project instances live only in `logical_node_id`. That was the right separation of taxonomy from topology, but it left two product facts without a durable home:

1. A driver registration needs a stable identity that survives moving or renaming its placement node in the business tree, and that can exist at the platform tier as well as the organization tier.
2. Physical-device drivers (for example `hl7603`, many instances per project) and logical-service drivers (for example `wireless_charger`, at most one instance per project) are orthogonal to the taxonomy `kind`. Putting those facts into `parameter_modules.kind` either revives per-instance modules or mislabels node-type units as "logical drivers".

We decided that **attribution subjects are first-class catalog entities**, and that the module tree only places them:

- `AttributionSubject` is the stable identity a `ParameterSpec` may declare against.
- Its discriminants are `DriverRegistration` and `NodeTypeDefinition`.
- `ParameterModule` rows of kind `driver-group` / `node-type` reference a subject; business categories and the unclassified root do not.
- `DriverRegistration` carries `driverNature` (`physical-device` | `logical-service`) and `instanceCardinality` (`multiple` | `singleton-per-project`).
- Platform subjects use `organization_id IS NULL`; organization subjects may shadow a platform subject by the same `source_key` without mutating it.

### Supersedes (partial)

| Prior ADR | Superseded claim | Replacement |
| --- | --- | --- |
| ADR-0007 | Driver registration is not a separate entity; it is only a curated driver-group plus mappings | Registration is a stable `DriverRegistration` subject; the driver-group module remains its placement / display node in the org taxonomy |
| ADR-0010 | Bindings attach to driver groups and node-type units identified only by `parameter_modules.id` | Bindings still attach through modules for tree navigation, but the durable catalog identity is `attribution_subject_id` |

## Considered Options

- **Keep ADR-0007 and add nature/cardinality columns on `parameter_modules`** — rejected because business nodes would carry meaningless columns, platform-tier registrations would have no home without inventing platform modules, and moving a driver-group would look like changing the registration identity.
- **Revive `instance` modules for physical multi-instance drivers** — rejected by ADR-0010; instance identity already has a true source in `logical_node_id`.
- **Treat every logical service as a `node-type`** — rejected because vendor schemas may declare a compatible for the same service, so classification by input shape is unstable; nature must be an explicit declaration.

## Consequences

- Migration `0082` introduces `attribution_subjects`, `driver_registrations`, and `node_type_definitions`, backfills one subject per existing driver-group / node-type module, and links those modules through `parameter_modules.attribution_subject_id`.
- Existing driver-groups default to `physical-device` + `multiple`. Logical-service + singleton cardinality is a curated correction, not an ingest guess.
- Parent kind rules align with ADR-0010 nesting: business may contain business / driver-group / node-type; driver-group may contain node-type; node-type may nest under node-type. Instances still never appear as modules.
- Parameter definition identity in later work becomes `(owner scope, attribution_subject_id, property_key)` rather than a free-floating `driverModule` string.
- Org overlays and vendor schemas continue to match on compatible evidence; they do not become the catalog identity.

## Follow-up

- Versioned `ParameterSpec` content and staged binding cutover (next ADR / plan batches).
- Config-revision validation that enforces `singleton-per-project` as a semantic gate.
- Promoting organization registrations into the platform catalog (parallel to overlay promotion).
