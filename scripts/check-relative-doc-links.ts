import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";

export interface BrokenRelativeMarkdownLink {
  source: string;
  target: string;
}

export async function collectMarkdownFiles(root: string): Promise<string[]> {
  const ignoredDirectories = new Set([".git", ".worktrees", "node_modules", "dist", "coverage", "playwright-report"]);
  const files: string[] = [];

  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });

    await Promise.all(
      entries.map(async (entry) => {
        const entryPath = path.join(directory, entry.name);

        if (entry.isDirectory()) {
          if (!ignoredDirectories.has(entry.name)) {
            await visit(entryPath);
          }
          return;
        }

        if (entry.isFile() && entry.name.endsWith(".md")) {
          files.push(entryPath);
        }
      })
    );
  }

  await visit(root);
  return files;
}

export async function checkRelativeMarkdownLinks(
  root: string,
  files: readonly string[]
): Promise<BrokenRelativeMarkdownLink[]> {
  const broken: BrokenRelativeMarkdownLink[] = [];
  for (const file of [...files].sort()) {
    const filePath = path.resolve(root, file);
    const source = path.relative(root, filePath).replace(/\\/g, "/");
    const content = await readFile(filePath, "utf8");
    let fence = "";
    const lines: string[] = [];
    for (const line of content.split(/\r?\n/)) {
      const marker = line.match(/^\s*(`{3,}|~{3,})(.*)$/);
      if (fence) {
        if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) {
          fence = "";
        }
      } else if (marker) {
        fence = marker[1];
      } else {
        lines.push(line);
      }
    }
    const references = new Map<string, string>();
    const normalizeLabel = (label: string) => label.trim().replace(/\s+/g, " ").toLowerCase();
    const text = lines.join("\n")
      .replace(/(`+)[\s\S]*?\1(?!`)/g, "")
      .replace(/^ {0,3}\[([^\]]+)\]:\s*(<[^>]*>|\S+).*$/gm, (_line, label: string, target: string) => {
        const key = normalizeLabel(label);
        if (!references.has(key)) references.set(key, target.replace(/^<|>$/g, ""));
        return "";
      });
    const linkPattern = /\[([^\]]*)\](?:\[([^\]]*)\])?/g;
    const targets: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = linkPattern.exec(text)) !== null) {
      if (match[2] === undefined && text[linkPattern.lastIndex] === "(") {
        let cursor = linkPattern.lastIndex + 1;
        while (/\s/.test(text[cursor] ?? "") && cursor < text.length) cursor++;
        const start = cursor;
        let depth = 0;
        const angle = text[cursor] === "<";
        if (angle) cursor++;
        for (; cursor < text.length; cursor++) {
          const character = text[cursor];
          if (character === "\\") {
            cursor++;
          } else if (angle) {
            if (character === ">") {
              cursor++;
              break;
            }
          } else if (character === "(") {
            depth++;
          } else if (character === ")") {
            if (depth === 0) break;
            depth--;
          } else if (/\s/.test(character)) {
            break;
          }
        }
        if (!/^\s*(?:"[^"\n]*"|'[^'\n]*'|\([^\n]*?\))?\s*\)/.test(text.slice(cursor))) continue;
        targets.push(text.slice(start, cursor).replace(/^<|>$/g, "").replace(/\\([\\()[\]<> ])/g, "$1"));
        linkPattern.lastIndex = cursor + 1;
      } else {
        const target = references.get(normalizeLabel(match[2] || match[1]));
        if (target !== undefined) targets.push(target);
      }
    }
    for (const target of targets) {
      if (!target || /^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(target)) {
        continue;
      }
      try {
        const decodedTarget = decodeURIComponent(target.split("#")[0]);
        await access(path.resolve(path.dirname(filePath), decodedTarget));
      } catch {
        broken.push({ source, target });
      }
    }
  }
  return broken;
}
