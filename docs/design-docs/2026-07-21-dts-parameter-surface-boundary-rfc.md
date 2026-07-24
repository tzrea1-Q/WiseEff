# RFC: DTS Parameter Surface Boundary

> Chinese: [Chinese](../zh-CN/design-docs/2026-07-21-dts-parameter-surface-boundary-rfc.md)

- Date: 2026-07-21
- Status: **Accepted for planning** (product-boundary decision; not yet implemented)
- Supersedes / revises: locked decisions §2.2–2.5 in [`2026-07-14-dts-parameter-management-assessment.md`](2026-07-14-dts-parameter-management-assessment.md) where they conflict (see §6)
- Companion: capability cut matrix [`2026-07-21-dts-capability-cut-matrix.md`](2026-07-21-dts-capability-cut-matrix.md); project-primary DTS / retire platform base [`2026-07-21-project-primary-dts-contract-rfc.md`](2026-07-21-project-primary-dts-contract-rfc.md)
- Implementation plan: [`../exec-plans/active/2026-07-21-dts-parameter-surface-mvp.md`](../exec-plans/active/2026-07-21-dts-parameter-surface-mvp.md)

## 1. Problem statement

WiseEff’s original intent for parameter management is a **standardized, digital, human-governed parameter platform**:

- Hardware engineers edit and understand project parameters without emailing software engineers.
- Software engineers receive an authoritative, maintained DTS text from WiseEff instead of reconciling ad-hoc attachments.
- Users organize work by **business module / submodule → adjustable parameters**, not by Device Tree expertise.

After the 2026-07 DTS topology / schema / toolchain program, the product accumulated a **full config-set semantic compiler subset**: multi-file resolve, logical-node continuity, schema matching, binding identity tuples, and fail-closed `dtc` / `fdtoverlay` / `dt-validate` on the edit path. Module-first navigation was added later as a skin on that stack, without defining a first-class **manageable parameter surface**.

Result: the system manages the whole effective tree (including bus scaffolding such as `&spmi`, `pmic@0`, `#address-cells`) while the user only needs the business interior of nodes such as `hi6xxx_coul` / `batt`.

## 2. Decision summary

| # | Decision | Choice |
| --- | --- | --- |
| D1 | Primary user object | **Manageable parameter surface** (filtered parameter ledger), not the full Device Tree |
| D2 | Primary UX dimension | **Module / submodule → parameters**; driver is classification input only |
| D3 | DTS role | Project **authoritative DTS text(s)** maintained on parameter change; exportable for Git by humans |
| D4 | Toolchain | **Optional / deferred gate** (export or publish assist); **not** a hard blocker on everyday edit → draft → submit **or semantic merge/writeback** |
| D5 | Config Set / base+overlay | **Internal implementation detail** when needed; not the default user mental model for “upload my project DTS” |
| D6 | Schema / vendor YAML | Assist typing & docs; **missing schema must not hide** surface parameters from the ledger |
| D7 | Logical-node continuity / identity mapping | Keep as **backend continuity** where useful; never a browse/edit prerequisite for surface parameters |

## 3. Manageable parameter surface

### 3.1 Definition

A **parameter surface entry** is a user-visible, editable ledger row derived from DTS that satisfies **all** of:

1. **Business relevance**: the owning node is a *managed node* (see §3.2), not pure bus/infrastructure scaffolding.
2. **Property relevance**: the property is a *managed property* (see §3.3), not structural Device Tree machinery.
3. **Stable enough identity for ledger + writeback**: enough information to locate the property in the project’s maintained DTS text and to round-trip an edit.

Surface entries are what `/parameters` lists by default. Non-surface tree content may still be parsed for writeback / resolve correctness, but **must not** appear as first-class workbench rows or module-nav leaves unless the user explicitly opens a technical diagnostics view.

### 3.2 Managed nodes (v1 rules)

A node is **managed** when **any** of the following holds:

- It has a `compatible` that is mapped (or mappable) to a business module via driver/compatible/instance mappings; **or**
- It is a descendant of such a node and carries business properties (e.g. `batt` under `hi6xxx_coul`); **or**
- Admin marks the node (by locator or label) as managed.

A node is **not managed** (v1 defaults) when it is only scaffolding, including but not limited to:

- Address/size cell declarations (`#address-cells`, `#size-cells`)
- Pure bus / interconnect containers whose only role is hierarchy (`amba`, `spmi`, bare `i2c@…` without business props of interest)
- Interrupt controllers / GPIO controllers used only as phandle targets, unless Admin opts them into a module
- Properties that exist solely to make phandle cells well-formed

Example (from seed overlay shape):

```dts
&spmi {                    /* scaffolding — not a surface node */
  pmic@0 {                 /* scaffolding — not a surface node */
    #address-cells = <1>;  /* structural — not a surface property */
    hi6xxx_coul {          /* managed driver node */
      batt: batt {         /* managed child */
        r_pcb = <11920>;   /* surface parameter */
      };
    };
  };
};
```

### 3.3 Managed properties (v1 rules)

**Exclude from surface by default:**

- `compatible`, `reg`, `status` (unless Admin policy says otherwise for a module)
- `#*-cells`, `ranges`, `interrupt-controller`, `gpio-controller`
- Empty / boolean presence markers that are structural only

**Include by default:** all other properties on managed nodes (scalars, tables, phandle lists that encode business config such as `gpio_int`, `onewire-gpio`, `r_pcb`, …).

Admin may maintain an org-level **deny/allow list** by property name or schema namespace later; v1 ships the rule table above.

### 3.4 Extraction vs binding

v1 implementation may still use today’s parser / resolve / binding pipeline **internally**, then **filter** to the surface for browse/edit APIs and UI. The long-term model should treat “surface extraction” as an explicit step with tests, not an accidental UI filter.

## 4. DTS maintenance contract

### 4.1 Authoritative artifact

For each project, WiseEff maintains **one or more named DTS source files** that together are the **project parameter DTS delivery** (the text humans hand to Git). Defaults:

- Prefer a **single project overlay / board file** as the user-facing “project DTS” when that matches how teams work.
- Multi-file sets remain supported as storage, but the product copy speaks of “project DTS”, not “config revision toolchain”.

### 4.2 On parameter change

When a user changes a surface parameter and the change is accepted into the governed workflow:

1. Persist ledger + draft/review/audit as today (workflow unchanged in intent).
2. **Write the new value into the project’s maintained DTS text** at the correct property site (precise textual / CST writeback).
3. Publish a new file version so export always yields the latest authoritative text.

### 4.3 What “maintain DTS” does **not** require on the hot path

- Re-running full `dtc` + `fdtoverlay` + `dt-validate` before a draft can be created
- Forcing every project to supply a synthetic shared base tree for demo completeness
- Blocking browse because a vendor schema YAML is missing

### 4.4 Optional validation levels

| Level | When | Behavior |
| --- | --- | --- |
| L0 Syntax-ish | On writeback | Parser round-trip / CST integrity; fail if write would corrupt structure |
| L1 Resolve | On demand / export | Multi-file resolve diagnostics (includes, overlays) |
| L2 Toolchain | Export / publish / Admin “validate release” | `dtc` / `fdtoverlay` / `dt-validate` as **assistive** gate |

Everyday edit → draft → submit and **governed merge/writeback** use **L0** (and soft L1 warnings). **L2 is not fail-closed on the edit or merge hot path.** The product does **not** treat `dtc` / `fdtoverlay` / `dt-validate` rules as parameter-maintenance gates; toolchain output is Admin / baseline-release assist only. The `/parameters` workbench must **not** surface toolchain compile noise (for example `ranges_format`, `unit_address_vs_reg`, empty `ranges` / `#address-cells` mismatch warnings) as primary governance errors — only product blockers (topology not ready, binding/schema/mapping gates, incomplete base when still relevant) belong in default UI.

## 5. Modules vs drivers

### 5.1 User model

```
Module / submodule
  └── Parameter (name + current value + governance)
```

Drivers (`compatible` / driverModule / instance) are **not** a required navigation tier. They may appear in Admin mapping UI and in detail drawers as “classification evidence”.

### 5.2 Driver role

- Each driver (or instance) **belongs to** exactly one module/submodule via existing `parameter_module_mappings` (instance > compatible > driver).
- Users never need to “manage drivers” as devices; they manage **parameters under modules**.
- Unmapped surface parameters land under **未分类** with an Admin queue — same as today, but only for surface rows.

### 5.3 Identity (planning constraint)

- **User-facing identity**: `(project, module, parameter key)` where parameter key is stable for writeback (spec key or equivalent).
- **Storage** may keep richer keys (`logical_node`, `parameter_spec`, `module_id`) as long as the UI and APIs for the workbench default to the user model.
- Phase-2 four-tuple identity remains an internal continuity tool until a dedicated migration revisits uniqueness; this RFC does **not** require immediately dropping `module_id` from the DB key, but forbids growing more user-visible identity layers.

## 6. Revisions to 2026-07-14 locked decisions

| 2026-07-14 lock | Revision (2026-07-21) |
| --- | --- |
| Fact source: WiseEff authoritative; Git manual | **Kept** |
| Merge requires fail-closed dtc/schema | **Revised** → L2 optional on export/publish and Admin validate; **not** edit or merge/writeback hot path |
| Top granularity = board config set + baseline | **Revised** → user granularity = project + maintained DTS text(s); config set internal |
| Full structured modeling as product center | **Revised** → structured parse/writeback remains engine; **product center = parameter surface + modules** |
| include unsupported (explicit reject) | **Unchanged** until a later plan |

## 7. Non-goals (this RFC)

- Replacing the entire topology DB schema in one change
- Building a full Device Tree IDE
- Automatic Git push / PR from WiseEff
- Perfect Linux dtschema coverage for every SoC vendor

## 8. Success criteria

- Hardware user can open a project, pick a module, see only adjustable business parameters, edit, submit — without learning Config Set / base / overlay / toolchain vocabulary.
- After merge (or governed accept), exported DTS contains the new values.
- Bus scaffolding properties do not appear as workbench rows by default.
- Toolchain failure does not block draft creation; it may block “release validate” / export-with-L2.

## 9. References

- Overweight assessment (planning input): Cursor plan `dts架构过重评估`
- Prior assessment: [`2026-07-14-dts-parameter-management-assessment.md`](2026-07-14-dts-parameter-management-assessment.md)
- Module-first UX: [`../superpowers/specs/2026-07-20-dts-workbench-module-refocus-design.md`](../superpowers/specs/2026-07-20-dts-workbench-module-refocus-design.md)
- Cut matrix: [`2026-07-21-dts-capability-cut-matrix.md`](2026-07-21-dts-capability-cut-matrix.md)
