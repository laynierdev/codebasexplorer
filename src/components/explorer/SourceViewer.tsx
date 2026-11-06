"use client";

import { useEffect, useRef, useState } from "react";
import type { SourceFile } from "@/domain/types";
import { highlightLines, type HighlightToken } from "@/lib/highlight";
import type { LineRange } from "@/context/ExplorerContext";

interface Props {
  file: SourceFile;
  highlight: LineRange | null;
}

export function SourceViewer({ file, highlight }: Props) {
  const plain: HighlightToken[][] = file.content.split("\n").map((line) => [{ content: line }]);
  const [tokens, setTokens] = useState<{ path: string; lines: HighlightToken[][] } | null>(null);
  const hlRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    highlightLines(file.content, file.language).then((lines) => {
      if (!cancelled) setTokens({ path: file.path, lines });
    });
    return () => {
      cancelled = true;
    };
  }, [file.path, file.content, file.language]);

  useEffect(() => {
    hlRef.current?.scrollIntoView({ block: "center" });
  }, [file.path, highlight]);

  const lines = tokens && tokens.path === file.path ? tokens.lines : plain;
  // Drop the phantom empty last line produced by a trailing newline.
  const visible = file.content.endsWith("\n") ? lines.slice(0, -1) : lines;

  return (
    <div className="code-scroll" tabIndex={0} role="region" aria-label={`Source of ${file.path}`}>
      <div style={{ padding: "8px 0 24px" }}>
        {visible.map((line, i) => {
          const n = i + 1;
          const isHl = highlight !== null && n >= highlight.start && n <= highlight.end;
          return (
            <div key={n} className={`code-line${isHl ? " hl" : ""}`} ref={highlight && n === highlight.start ? hlRef : undefined}>
              <span className="ln" aria-hidden="true">
                {n}
              </span>
              <span className="src">
                {line.length === 0 || (line.length === 1 && line[0]?.content === "")
                  ? " "
                  : line.map((t, j) => (
                      <span
                        key={j}
                        style={{
                          color: t.color,
                          fontStyle: t.fontStyle && t.fontStyle & 1 ? "italic" : undefined,
                          fontWeight: t.fontStyle && t.fontStyle & 2 ? 600 : undefined,
                        }}
                      >
                        {t.content}
                      </span>
                    ))}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
