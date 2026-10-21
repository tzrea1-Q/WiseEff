export type KnowledgeExtractionOutcome =
  | {
      status: "succeeded";
      text: string;
      /** UTF-16 offsets by physical page - 1; trimmed/truncated pages clamp to the text boundary. */
      pageOffsets?: number[];
    }
  | { status: "failed"; reason: string };

export type KnowledgeExtractionInput = {
  fileName: string;
  contentType: string;
  bytes: Buffer;
};

/**
 * Text-extraction seam for file-form knowledge entries. The service depends on
 * this interface only; the default implementation dispatches on content type
 * (PDF via pdf-parse, Word .docx via mammoth, plain text passthrough) and
 * records failures honestly instead of throwing.
 */
export interface KnowledgeTextExtractor {
  extract(input: KnowledgeExtractionInput): Promise<KnowledgeExtractionOutcome>;
}

const MAX_EXTRACTED_TEXT_CHARS = 500_000;

function normalizeText(text: string) {
  return text.replace(/\r\n/g, "\n").replace(/\u0000/g, "");
}

function normalizedTextOutcome(text: string): KnowledgeExtractionOutcome {
  const normalized = text.trim();
  return normalized
    ? { status: "succeeded", text: normalized.slice(0, MAX_EXTRACTED_TEXT_CHARS) }
    : { status: "failed", reason: "无可提取文本" };
}

function failureReason(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim().slice(0, 500);
  }
  return fallback;
}

async function extractPdfText(bytes: Buffer): Promise<KnowledgeExtractionOutcome> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: bytes });
  try {
    const pageJoiner = "\n";
    // pdf-parse appends a newline, pageJoiner, and two newlines after each page.
    const pageSeparatorLength = 1 + pageJoiner.length + 2;
    const result = await parser.getText({ pageJoiner });
    const normalized = normalizeText(result.text ?? "");
    const outcome = normalizedTextOutcome(normalized);
    if (outcome.status === "failed") return outcome;
    const leading = normalized.length - normalized.trimStart().length;
    let offset = 0;
    const pageOffsets = result.pages.map((page) => {
      const start = Math.min(outcome.text.length, Math.max(0, offset - leading));
      offset += normalizeText(page.text).length + pageSeparatorLength;
      return start;
    });
    return { ...outcome, pageOffsets };
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}

async function extractDocxText(bytes: Buffer): Promise<string> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer: bytes });
  return result.value ?? "";
}

export function createDefaultKnowledgeTextExtractor(): KnowledgeTextExtractor {
  return {
    async extract(input) {
      try {
        if (input.contentType === "text/plain" || input.contentType === "text/markdown") {
          return normalizedTextOutcome(normalizeText(input.bytes.toString("utf8")));
        }
        if (input.contentType === "application/pdf") {
          return await extractPdfText(input.bytes);
        }
        if (input.contentType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
          return normalizedTextOutcome(normalizeText(await extractDocxText(input.bytes)));
        }
        if (input.contentType === "application/msword") {
          return {
            status: "failed",
            reason: "Legacy .doc binaries are not supported for text extraction; convert the document to .docx and replace the file."
          };
        }
        return { status: "failed", reason: `Unsupported content type for text extraction: ${input.contentType}.` };
      } catch (error) {
        return { status: "failed", reason: failureReason(error, "Text extraction failed for an unknown reason.") };
      }
    }
  };
}
