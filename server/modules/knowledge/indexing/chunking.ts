export type KnowledgeChunkDraft = {
  chunkIndex: number;
  text: string;
};

export type ChunkingOptions = {
  /** Soft maximum characters per chunk body (headings/breadcrumbs excluded). */
  maxChars?: number;
  /** Characters of trailing context carried into the next chunk. */
  overlapChars?: number;
};

const DEFAULT_MAX_CHARS = 1200;
const DEFAULT_OVERLAP_CHARS = 200;

function normalizeWhitespace(text: string) {
  return text.replace(/\r\n/g, "\n").replace(/\u0000/g, "").trim();
}

function splitParagraphs(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);
}

/** Hard-splits a single oversized paragraph at sentence-ish boundaries, then raw slices. */
function splitOversizedParagraph(paragraph: string, maxChars: number): string[] {
  if (paragraph.length <= maxChars) {
    return [paragraph];
  }
  const pieces: string[] = [];
  let rest = paragraph;
  while (rest.length > maxChars) {
    const window = rest.slice(0, maxChars);
    const boundary = Math.max(
      window.lastIndexOf("。"),
      window.lastIndexOf("."),
      window.lastIndexOf("！"),
      window.lastIndexOf("!"),
      window.lastIndexOf("？"),
      window.lastIndexOf("?"),
      window.lastIndexOf("\n"),
      window.lastIndexOf(" ")
    );
    const cut = boundary > maxChars / 2 ? boundary + 1 : maxChars;
    pieces.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) {
    pieces.push(rest);
  }
  return pieces;
}

function overlapTail(text: string, overlapChars: number) {
  if (overlapChars <= 0 || text.length <= overlapChars) {
    return text.length <= overlapChars ? text : "";
  }
  const tail = text.slice(-overlapChars);
  const firstBreak = tail.search(/[\s。.!！?？]/);
  return firstBreak >= 0 ? tail.slice(firstBreak + 1).trimStart() : tail;
}

/** Windows paragraphs into chunks of ~maxChars with a trailing-context overlap. */
function windowParagraphs(
  paragraphs: string[],
  options: Required<ChunkingOptions>,
  contextPrefix: string
): string[] {
  const chunks: string[] = [];
  let current = "";

  const flush = () => {
    const body = current.trim();
    if (body) {
      chunks.push(contextPrefix ? `${contextPrefix}\n${body}` : body);
    }
  };

  for (const paragraph of paragraphs.flatMap((p) => splitOversizedParagraph(p, options.maxChars))) {
    if (current && current.length + paragraph.length + 2 > options.maxChars) {
      flush();
      current = overlapTail(current, options.overlapChars);
    }
    current = current ? `${current}\n\n${paragraph}` : paragraph;
  }
  flush();

  return chunks;
}

type MarkdownSection = {
  headingPath: string[];
  body: string;
};

function parseMarkdownSections(markdown: string): MarkdownSection[] {
  const lines = normalizeWhitespace(markdown).split("\n");
  const sections: MarkdownSection[] = [];
  let headingStack: Array<{ level: number; title: string }> = [];
  let buffer: string[] = [];
  let inCodeFence = false;

  const flush = () => {
    const body = buffer.join("\n").trim();
    if (body) {
      sections.push({ headingPath: headingStack.map((h) => h.title), body });
    }
    buffer = [];
  };

  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      inCodeFence = !inCodeFence;
      buffer.push(line);
      continue;
    }
    const heading = inCodeFence ? null : line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flush();
      const level = heading[1].length;
      headingStack = [...headingStack.filter((h) => h.level < level), { level, title: heading[2].trim() }];
      continue;
    }
    buffer.push(line);
  }
  flush();

  return sections;
}

/**
 * Heading-aware markdown chunking: each heading section is windowed into
 * overlapping chunks and every chunk carries its title + heading breadcrumb so
 * citations and embeddings keep document context.
 */
export function chunkMarkdown(
  input: { title: string; markdown: string },
  options: ChunkingOptions = {}
): KnowledgeChunkDraft[] {
  const resolved = {
    maxChars: options.maxChars ?? DEFAULT_MAX_CHARS,
    overlapChars: options.overlapChars ?? DEFAULT_OVERLAP_CHARS
  };
  const sections = parseMarkdownSections(input.markdown);
  const texts: string[] = [];

  for (const section of sections) {
    const breadcrumb = [input.title, ...section.headingPath].filter(Boolean).join(" › ");
    texts.push(...windowParagraphs(splitParagraphs(section.body), resolved, breadcrumb));
  }

  if (texts.length === 0) {
    const fallback = normalizeWhitespace(input.markdown);
    if (fallback) {
      texts.push(...windowParagraphs(splitParagraphs(fallback), resolved, input.title));
    } else if (input.title.trim()) {
      texts.push(input.title.trim());
    }
  }

  return texts.map((text, chunkIndex) => ({ chunkIndex, text }));
}

/**
 * Paragraph-window chunking for extracted file text (no reliable heading
 * structure): overlapping windows of whole paragraphs prefixed with the title.
 */
export function chunkExtractedText(
  input: { title: string; text: string },
  options: ChunkingOptions = {}
): KnowledgeChunkDraft[] {
  const resolved = {
    maxChars: options.maxChars ?? DEFAULT_MAX_CHARS,
    overlapChars: options.overlapChars ?? DEFAULT_OVERLAP_CHARS
  };
  const normalized = normalizeWhitespace(input.text);
  const paragraphs = splitParagraphs(normalized).length > 1
    ? splitParagraphs(normalized)
    : normalized
        .split(/\n/)
        .map((line) => line.trim())
        .filter(Boolean);

  const texts = windowParagraphs(paragraphs, resolved, input.title.trim());
  if (texts.length === 0 && input.title.trim()) {
    texts.push(input.title.trim());
  }
  return texts.map((text, chunkIndex) => ({ chunkIndex, text }));
}
