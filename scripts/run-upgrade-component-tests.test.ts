import { expect, it } from "vitest";
import { runUpgradeComponentTests } from "./run-upgrade-component-tests";

it.each(["toString", "__proto__", "constructor"])("rejects inherited suite name %s", async suite => {
  expect(await runUpgradeComponentTests(["--expected-daemon-id", "owned", "--suite", suite])).toMatchObject({ exitCode: 2 });
});

it.each([[], ["--suite", "bindings"], ["--expected-daemon-id", "owned", "--suite", "unknown"], ["--expected-daemon-id", "owned", "--suite", "bindings", "--database-url", "forbidden"]].map(args => ({ args })))("refuses incomplete or external component runner input %#", async ({ args }) => {
  expect(await runUpgradeComponentTests(args)).toMatchObject({ exitCode: 2 });
});
