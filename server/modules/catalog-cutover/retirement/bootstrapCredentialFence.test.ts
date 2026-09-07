import { mkdtemp, mkdir, chmod, readFile, readdir, realpath, rm, stat, writeFile, symlink, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { prepareBootstrapCredentialCustody, reopenBootstrapCredentialCustody } from "./bootstrapCredentialFence";

it("durably prepares an opaque private credential version without putting either password in its public receipt", async () => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), "bootstrap-custody-")));
  await chmod(directory, 0o700);
  const oldSecret = "synthetic-old-private-password";
  try {
    const custody = await prepareBootstrapCredentialCustody({ directory, custodianUid: process.getuid!(), oldSecret });
    try {
      const receipt = custody.receipt;
      expect(receipt.version).toMatch(/^[a-f0-9]{32}$/);
      expect(Object.keys(receipt).sort()).toEqual(["directory", "newFile", "oldFile", "version"]);
      const files = await readdir(directory);
      expect(files.sort()).toEqual([`${receipt.version}.new`, `${receipt.version}.old`]);
      const oldFile = path.join(directory, `${receipt.version}.old`), newFile = path.join(directory, `${receipt.version}.new`);
      const newSecret = await readFile(newFile, "utf8");
      expect(/^[a-f0-9]{64}$/.test(newSecret)).toBe(true);
      expect(await readFile(oldFile, "utf8") === oldSecret).toBe(true);
      expect((await stat(oldFile)).mode & 0o777).toBe(0o600);
      expect((await stat(newFile)).mode & 0o777).toBe(0o600);
      expect(JSON.stringify(receipt).includes(oldSecret)).toBe(false);
      expect(JSON.stringify(receipt).includes(newSecret)).toBe(false);
    } finally { await custody.close(); }
  } finally { await rm(directory, { recursive: true }); }
});

it.each(["mode", "file-symlink", "directory-alias", "wrong-version"])("does not reopen %s as the original private credential version", async fault => {
  const parent = await realpath(await mkdtemp(path.join(tmpdir(), "bootstrap-negative-")));
  const directory = path.join(parent, "custody");
  await mkdir(directory, { mode: 0o700 });
  try {
    const first = await prepareBootstrapCredentialCustody({ directory, custodianUid: process.getuid!(), oldSecret: "synthetic-old-secret" });
    const receipt = first.receipt;
    await first.close();
    let selectedDirectory = directory;
    const filename = path.join(directory, `${receipt.version}.new`);
    if (fault === "mode") await chmod(filename, 0o644);
    if (fault === "file-symlink") { await rename(filename, `${filename}.saved`); await symlink(`${filename}.saved`, filename); }
    if (fault === "directory-alias") { selectedDirectory = path.join(parent, "alias"); await symlink(directory, selectedDirectory); }
    if (fault === "wrong-version") receipt.version = "f".repeat(32);
    await expect(reopenBootstrapCredentialCustody({ directory: selectedDirectory, custodianUid: process.getuid!(), receipt })).rejects.toThrow("bootstrap-credential-custody-unavailable");
  } finally { await rm(parent, { recursive: true }); }
});

it("reopens only the original persisted version and rejects same-inode password drift", async () => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), "bootstrap-reopen-")));
  await chmod(directory, 0o700);
  try {
    const first = await prepareBootstrapCredentialCustody({ directory, custodianUid: process.getuid!(), oldSecret: "synthetic-old-secret" });
    const receipt = first.receipt;
    await first.close();
    const reopened = await reopenBootstrapCredentialCustody({ directory, custodianUid: process.getuid!(), receipt });
    expect(reopened.receipt).toEqual(receipt);
    await reopened.close();
    const filename = path.join(directory, `${receipt.version}.new`);
    const inode = (await stat(filename)).ino;
    await writeFile(filename, "c".repeat(64));
    expect((await stat(filename)).ino).toBe(inode);
    await expect(reopenBootstrapCredentialCustody({ directory, custodianUid: process.getuid!(), receipt })).rejects.toThrow("bootstrap-credential-custody-unavailable");
  } finally { await rm(directory, { recursive: true }); }
});
