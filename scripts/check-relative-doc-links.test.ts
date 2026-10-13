import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { checkRelativeMarkdownLinks, collectMarkdownFiles } from "./check-relative-doc-links";
import { validateMarkdownLinks } from "./check-doc-governance";

const tempRoots: string[] = [];

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "wiseeff-doc-links-"));
  tempRoots.push(root);
  for (const [file, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), content);
  }
  return root;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("accepts existing relative files and names the source and target of missing files", async () => {
  const root = await fixture({
    "docs/guide.md": "[Home](../README.md)\n[Missing](missing.md)",
    "README.md": "# Home"
  });
  expect(await checkRelativeMarkdownLinks(root, ["docs/guide.md"])).toEqual([
    { source: "docs/guide.md", target: "missing.md" }
  ]);
});

it("ignores any URL scheme and in-page anchors, and checks file fragments by existence only", async () => {
  const root = await fixture({
    "README.md": [
      "[Web](https://example.com)", "[Mail](mailto:team@example.com)",
      "[Custom](wiseeff+test:example)", "[Remote](//example.com/doc)", "[Anchor](#heading)",
      "[File](docs/guide.md#nonexistent-heading)", "[Missing](missing.md#heading)"
    ].join("\n"),
    "docs/guide.md": "# Guide"
  });
  expect(await checkRelativeMarkdownLinks(root, ["README.md"])).toEqual([
    { source: "README.md", target: "missing.md#heading" }
  ]);
});

it("ignores fenced examples while still checking links after matching fences", async () => {
  const root = await fixture({
    "README.md": [
      "````markdown", "[Example](missing-example.md)", "```", "~~~", "````",
      "~~~md", "[Example](missing-tilde.md)", "~~~",
      "[Missing](missing.md)"
    ].join("\n")
  });
  expect(await checkRelativeMarkdownLinks(root, ["README.md"])).toEqual([
    { source: "README.md", target: "missing.md" }
  ]);
});

it("checks every Markdown tree including plans and generated docs, excluding only the original ignored directories", async () => {
  const root = await fixture({
    "README.md": "[Directory](docs/)\n[Plan](docs/exec-plans/active/plan.md)",
    "docs/guide.md": "[Missing](missing.md)",
    "docs/zh-CN/user-guide/README.md": "[Missing](missing-zh.md)",
    "docs/exec-plans/active/plan.md": "[Checked](missing.md)",
    "docs/exec-plans/completed/plan.md": "[Checked](missing.md)",
    "docs/zh-CN/exec-plans/active/plan.md": "[Checked](missing.md)",
    "docs/generated/schema.md": "[Checked](missing.md)",
    "docs/zh-CN/generated/schema.md": "[Checked](missing.md)",
    "src/README.md": "[Checked](missing.md)",
    "docs/example.txt": "[Excluded](missing.md)",
    ...Object.fromEntries(
      [".git", ".worktrees", "node_modules", "dist", "coverage", "playwright-report"]
        .flatMap((directory) => [
          [`${directory}/README.md`, "[Excluded](missing.md)"],
          [`docs/${directory}/README.md`, "[Excluded](missing.md)"]
        ])
    )
  });
  const files = await collectMarkdownFiles(root);
  expect(await checkRelativeMarkdownLinks(root, files)).toEqual([
    { source: "docs/exec-plans/active/plan.md", target: "missing.md" },
    { source: "docs/exec-plans/completed/plan.md", target: "missing.md" },
    { source: "docs/generated/schema.md", target: "missing.md" },
    { source: "docs/guide.md", target: "missing.md" },
    { source: "docs/zh-CN/exec-plans/active/plan.md", target: "missing.md" },
    { source: "docs/zh-CN/generated/schema.md", target: "missing.md" },
    { source: "docs/zh-CN/user-guide/README.md", target: "missing-zh.md" },
    { source: "src/README.md", target: "missing.md" }
  ]);
});

it("accepts directories, titled links, angle brackets and URL-encoded filenames", async () => {
  const root = await fixture({
    "README.md": '[Directory](docs/)\n[Guide](docs/guide.md "Read this")\n[Space](<docs/a b.md#intro>)\n[Encoded](docs/a%20b.md)',
    "docs/guide.md": "# Guide",
    "docs/a b.md": "# Space"
  });
  expect(await checkRelativeMarkdownLinks(root, ["README.md"])).toEqual([]);
});

it("reports one readable source-to-target line per broken link through the governance gate", async () => {
  const root = await fixture({
    "README.md": "[Missing](missing.md)",
    "docs/guide.md": "[Missing](other.md#intro)",
    "docs/exec-plans/active/plan.md": "[Checked](missing.md)"
  });
  expect(await validateMarkdownLinks(root)).toEqual([
    "Broken local markdown link: README.md → missing.md",
    "Broken local markdown link: docs/exec-plans/active/plan.md → missing.md",
    "Broken local markdown link: docs/guide.md → other.md#intro"
  ]);
});

it("checks reference links and parenthesized paths without treating inline code as links", async () => {
  const root = await fixture({
    "README.md": [
      "[Guide](docs/guide(v1).md)", "[Missing][missing]", "[Home][]", "[Guide]",
      "`[Example](missing-code.md)`", "[unused]: missing-unused.md",
      "[missing]: missing-reference.md", "[Home]: docs/guide(v1).md",
      "[Guide]: missing-shortcut.md"
    ].join("\n"),
    "docs/guide(v1).md": "# Guide"
  });
  expect(await checkRelativeMarkdownLinks(root, ["README.md"])).toEqual([
    { source: "README.md", target: "missing-reference.md" },
    { source: "README.md", target: "missing-shortcut.md" }
  ]);
});

it("checks image links with empty alt text", async () => {
  const root = await fixture({ "README.md": "![](missing.png)" });
  expect(await checkRelativeMarkdownLinks(root, ["README.md"])).toEqual([
    { source: "README.md", target: "missing.png" }
  ]);
});

it("reports malformed percent escapes as broken links and continues checking", async () => {
  const root = await fixture({
    "README.md": "[Bad](docs/bad%.md)\n[Short](bad%2.md)\n[Hex](bad%GG.md)\n[UTF8](bad%E0%A4.md)\n[Missing](missing.md)",
    "docs/bad%.md": "# Literal percent"
  });
  expect(await checkRelativeMarkdownLinks(root, ["README.md"])).toEqual([
    { source: "README.md", target: "docs/bad%.md" },
    { source: "README.md", target: "bad%2.md" },
    { source: "README.md", target: "bad%GG.md" },
    { source: "README.md", target: "bad%E0%A4.md" },
    { source: "README.md", target: "missing.md" }
  ]);
});
