import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { assertOwnedUpgradeTestTarget } from "./upgrade-test-target";

it("refuses ambient URLs before even inspecting Docker", () => {
  for (const env of [{}, { DATABASE_URL: "postgres://ambient" }, { TEST_DATABASE_URL: "postgres://ambient" }]) {
    let opened = false;
    expect(() => assertOwnedUpgradeTestTarget(env, () => { opened = true; throw new Error("must-not-open-docker"); }))
      .toThrow("upgrade-tests-require-explicit-owned-postgres-receipt");
    expect(opened).toBe(false);
  }
});
it("binds the explicit URL to the owned daemon, container, network and published port", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "upgrade-target-"));
  const filename = path.join(directory, "receipt.json");
  const receipt = { label: "wiseeff.upgrade.conversion", run: "conversion-ab12", net: "a".repeat(64), id: "b".repeat(64), daemonId: "owned", url: `postgres://test:${randomBytes(16).toString("hex")}@127.0.0.1:57123/db` };
  const network = { Id: receipt.net, Labels: { [receipt.label]: receipt.run } };
  const container = { State: { Running: true }, NetworkSettings: { Networks: { fixture: { NetworkID: receipt.net } }, Ports: { "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "57123" }] } } };
  const open = (() => ({ daemonId: receipt.daemonId,
    assertOwned: (id: string, label: string, run: string) => { expect([id,label,run]).toEqual([receipt.id,receipt.label,receipt.run]); return container; },
    command: () => Buffer.from(JSON.stringify([network])),
  })) as any;
  try {
    writeFileSync(filename, JSON.stringify(receipt), { mode: 0o600 });
    const env = { UPG_TEST_TARGET_RECEIPT: filename, TEST_DATABASE_URL: receipt.url, DATABASE_URL: receipt.url };
    expect(() => assertOwnedUpgradeTestTarget(env, open)).not.toThrow();
    for (const suffix of ["?host=another-target", "?port=5432", "?sslkey=/private/key", "#ignored"]) {
      const changed = { ...receipt, url: receipt.url + suffix };
      writeFileSync(filename, JSON.stringify(changed));
      let opened = false;
      expect(() => assertOwnedUpgradeTestTarget({ ...env, TEST_DATABASE_URL: changed.url, DATABASE_URL: changed.url }, () => { opened = true; throw new Error(); }))
        .toThrow("upgrade-tests-require-explicit-owned-postgres-receipt");
      expect(opened).toBe(false);
    }
    writeFileSync(filename, JSON.stringify(receipt));
    expect(() => assertOwnedUpgradeTestTarget({ ...env, DATABASE_URL: "postgres://other" }, open)).toThrow("upgrade-tests-require-explicit-owned-postgres-receipt");
    container.NetworkSettings.Ports["5432/tcp"][0].HostPort = "57124";
    expect(() => assertOwnedUpgradeTestTarget(env, open)).toThrow("upgrade-tests-require-explicit-owned-postgres-receipt");
    container.NetworkSettings.Ports["5432/tcp"][0].HostPort = "57123";
    network.Labels[receipt.label] = "another-run";
    expect(() => assertOwnedUpgradeTestTarget(env, open)).toThrow("upgrade-tests-require-explicit-owned-postgres-receipt");
  } finally { rmSync(directory, { recursive: true }); }
});
