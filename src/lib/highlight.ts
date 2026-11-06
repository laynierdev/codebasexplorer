import type { HighlighterCore } from "shiki/core";
import type { Language } from "@/domain/types";

export interface HighlightToken {
  content: string;
  color?: string;
  fontStyle?: number;
}

let highlighterPromise: Promise<HighlighterCore> | null = null;

/** Lazily creates one shared highlighter with only the grammars we need (keeps the bundle small). */
function getHighlighter(): Promise<HighlighterCore> {
  highlighterPromise ??= (async () => {
    const [{ createHighlighterCore }, { createJavaScriptRegexEngine }] = await Promise.all([
      import("shiki/core"),
      import("shiki/engine/javascript"),
    ]);
    return createHighlighterCore({
      themes: [import("@shikijs/themes/github-light")],
      langs: [
        import("@shikijs/langs/typescript"),
        import("@shikijs/langs/json"),
        import("@shikijs/langs/markdown"),
        import("@shikijs/langs/sql"),
        import("@shikijs/langs/python"),
      ],
      engine: createJavaScriptRegexEngine(),
    });
  })();
  return highlighterPromise;
}

const SHIKI_LANG: Partial<Record<Language, string>> = {
  typescript: "typescript",
  javascript: "typescript",
  json: "json",
  markdown: "markdown",
  sql: "sql",
  python: "python",
};

/** Returns one token array per source line. Unsupported languages come back as plain text. */
export async function highlightLines(code: string, language: Language): Promise<HighlightToken[][]> {
  const lang = SHIKI_LANG[language];
  if (!lang) return code.split("\n").map((line) => [{ content: line }]);
  try {
    const highlighter = await getHighlighter();
    return highlighter.codeToTokensBase(code, { lang, theme: "github-light" }) as HighlightToken[][];
  } catch {
    return code.split("\n").map((line) => [{ content: line }]);
  }
}
