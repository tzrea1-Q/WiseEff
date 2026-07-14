import { describe, expect, it } from "vitest";
import { diffResolvedDts } from "./baselineDiff";

describe("diffResolvedDts", () => {
  it("locates a changed property value to its nodePath and prop name", () => {
    const baseline = `
&demo_integer {
	single_value = <42>;
};
`;
    const current = `
&demo_integer {
	single_value = <43>;
};
`;

    const changes = diffResolvedDts(baseline, current);

    expect(changes).toEqual([
      {
        kind: "prop_changed",
        nodePath: "demo_integer",
        prop: "single_value",
        before: "<42>",
        after: "<43>"
      }
    ]);
  });

  it("does not report a diff when hex case is the only difference", () => {
    const baseline = `
&demo_byte_array {
	reg_config = /bits/ 8 <0x19 0x32 0x4B 0x64 0x7D>;
};
`;
    const current = `
&demo_byte_array {
	reg_config = /bits/ 8 <0x19 0x32 0x4b 0x64 0x7d>;
};
`;

    expect(diffResolvedDts(baseline, current)).toEqual([]);
  });

  it("does not report a diff when multi-group <>,<> flattening is equivalent", () => {
    const baseline = `
&demo_multi_group {
	combined_para = <1 2600>,<2 2800>;
};
`;
    const current = `
&demo_multi_group {
	combined_para = <1 2600 2 2800>;
};
`;

    expect(diffResolvedDts(baseline, current)).toEqual([]);
  });

  it("reports node_added for a node only present in the current source", () => {
    const baseline = `
&demo_bool {
	weak_source_sleep_enabled;
};
`;
    const current = `
&demo_bool {
	weak_source_sleep_enabled;
	sub_module {
		status = "ok";
	};
};
`;

    const changes = diffResolvedDts(baseline, current);

    expect(changes).toEqual([{ kind: "node_added", nodePath: "demo_bool/sub_module" }]);
  });

  it("reports node_removed for a node only present in the baseline source", () => {
    const baseline = `
&demo_bool {
	weak_source_sleep_enabled;
	sub_module {
		status = "ok";
	};
};
`;
    const current = `
&demo_bool {
	weak_source_sleep_enabled;
};
`;

    const changes = diffResolvedDts(baseline, current);

    expect(changes).toEqual([{ kind: "node_removed", nodePath: "demo_bool/sub_module" }]);
  });

  it("reports prop_added and prop_removed within the same node", () => {
    const baseline = `
&demo_string {
	status = "ok";
	string_array = "buck", "0", "1", "1";
};
`;
    const current = `
&demo_string {
	status = "ok";
	multi_line_table = "scp", "lvc", "2000";
};
`;

    const changes = diffResolvedDts(baseline, current);

    expect(changes).toEqual(
      expect.arrayContaining([
        { kind: "prop_removed", nodePath: "demo_string", prop: "string_array", before: '"buck", "0", "1", "1"' },
        { kind: "prop_added", nodePath: "demo_string", prop: "multi_line_table", after: '"scp", "lvc", "2000"' }
      ])
    );
    expect(changes).toHaveLength(2);
  });

  it("returns no changes for identical sources", () => {
    const source = `
&demo_phandle_list {
	matchable = <&demo_ic_a &demo_ic_b>;
};
`;

    expect(diffResolvedDts(source, source)).toEqual([]);
  });
});
