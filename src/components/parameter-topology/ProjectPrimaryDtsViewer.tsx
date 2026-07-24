import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

export type ProjectPrimaryDtsViewerProps = {
  fileName: string;
  versionNumber: number;
  text: string;
  /** 1-based line to scroll into view and highlight; null clears highlight */
  focusLine?: number | null;
  /** Controlled find query from workbench search box (optional) */
  findQuery?: string;
  /** Bumps to advance to next find match */
  findNextToken?: number;
  onFindStatusChange?: (status: { matchCount: number; activeIndex: number }) => void;
  className?: string;
};

type FindMatch = {
  lineNumber: number;
  start: number;
  end: number;
};

function collectFindMatches(lines: string[], query: string): FindMatch[] {
  const trimmed = query.trim();
  if (!trimmed) {
    return [];
  }

  const matches: FindMatch[] = [];
  lines.forEach((line, index) => {
    let offset = 0;
    while (offset <= line.length) {
      const foundAt = line.indexOf(trimmed, offset);
      if (foundAt === -1) {
        break;
      }
      matches.push({
        lineNumber: index + 1,
        start: foundAt,
        end: foundAt + trimmed.length
      });
      offset = foundAt + 1;
    }
  });
  return matches;
}

function renderLineText(
  line: string,
  lineNumber: number,
  matches: FindMatch[],
  activeMatchIndex: number,
  globalMatchOffset: number
) {
  const lineMatches = matches.filter((match) => match.lineNumber === lineNumber);
  if (lineMatches.length === 0) {
    return line;
  }

  const segments: ReactNode[] = [];
  let cursor = 0;
  lineMatches.forEach((match, matchIndex) => {
    if (cursor < match.start) {
      segments.push(line.slice(cursor, match.start));
    }
    const globalIndex = globalMatchOffset + matchIndex;
    segments.push(
      <mark
        key={`${lineNumber}-${match.start}`}
        className={
          globalIndex === activeMatchIndex
            ? "project-primary-dts-viewer__find-match is-active"
            : "project-primary-dts-viewer__find-match"
        }
      >
        {line.slice(match.start, match.end)}
      </mark>
    );
    cursor = match.end;
  });
  if (cursor < line.length) {
    segments.push(line.slice(cursor));
  }
  return segments;
}

export function ProjectPrimaryDtsViewer({
  fileName,
  versionNumber,
  text,
  focusLine = null,
  findQuery = "",
  findNextToken = 0,
  onFindStatusChange,
  className
}: ProjectPrimaryDtsViewerProps) {
  const lines = useMemo(() => text.split("\n"), [text]);
  const lineRefs = useRef(new Map<number, HTMLDivElement>());
  const findMatches = useMemo(
    () => collectFindMatches(lines, findQuery),
    [findQuery, lines]
  );
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);

  useEffect(() => {
    setActiveMatchIndex(0);
  }, [findQuery, text]);

  useEffect(() => {
    if (findNextToken <= 0 || findMatches.length === 0) {
      return;
    }
    setActiveMatchIndex((current) => (current + 1) % findMatches.length);
  }, [findMatches.length, findNextToken]);

  useEffect(() => {
    onFindStatusChange?.({
      matchCount: findMatches.length,
      activeIndex: findMatches.length === 0 ? 0 : activeMatchIndex + 1
    });
  }, [activeMatchIndex, findMatches.length, onFindStatusChange]);

  useEffect(() => {
    if (focusLine == null || focusLine < 1) {
      return;
    }
    lineRefs.current.get(focusLine)?.scrollIntoView({ block: "center" });
  }, [focusLine, text]);

  useEffect(() => {
    if (findMatches.length === 0) {
      return;
    }
    const activeMatch = findMatches[activeMatchIndex];
    if (!activeMatch) {
      return;
    }
    lineRefs.current.get(activeMatch.lineNumber)?.scrollIntoView({ block: "center" });
  }, [activeMatchIndex, findMatches]);

  const rootClassName = ["project-primary-dts-viewer", className].filter(Boolean).join(" ");
  let globalMatchOffset = 0;

  return (
    <section className={rootClassName}>
      <header className="project-primary-dts-viewer__meta">
        {fileName} · v{versionNumber}
      </header>
      <div className="project-primary-dts-viewer__body" aria-label="DTS 源码">
        {lines.map((line, index) => {
          const lineNumber = index + 1;
          const isFocused = focusLine === lineNumber;
          const lineClassName = [
            "project-primary-dts-viewer__line",
            isFocused ? "is-focused" : ""
          ]
            .filter(Boolean)
            .join(" ");
          const renderedLine = renderLineText(
            line,
            lineNumber,
            findMatches,
            activeMatchIndex,
            globalMatchOffset
          );
          globalMatchOffset += findMatches.filter((match) => match.lineNumber === lineNumber).length;

          return (
            <div
              key={lineNumber}
              ref={(element) => {
                if (element) {
                  lineRefs.current.set(lineNumber, element);
                } else {
                  lineRefs.current.delete(lineNumber);
                }
              }}
              className={lineClassName}
              data-line={lineNumber}
            >
              <span className="project-primary-dts-viewer__line-number" aria-hidden="true">
                {lineNumber}
              </span>
              <code className="project-primary-dts-viewer__line-text">{renderedLine}</code>
            </div>
          );
        })}
      </div>
    </section>
  );
}
