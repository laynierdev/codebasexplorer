import type { HighlighterCore } from "shiki/core";
import type { Language } from "@/domain/types";

export interface HighlightToken {
  content: string;
  color?: string;
  fontStyle?: number;
}

let highlighterPromise: Promise<HighlighterCore> | null = null;

/** Lazily creates one shared highlighter; grammars are loaded on demand to keep the bundle small. */
function getHighlighter(): Promise<HighlighterCore> {
  highlighterPromise ??= (async () => {
    const [{ createHighlighterCore }, { createJavaScriptRegexEngine }] = await Promise.all([import("shiki/core"), import("shiki/engine/javascript")]);
    return createHighlighterCore({ themes: [import("@shikijs/themes/github-light-high-contrast")], langs: [], engine: createJavaScriptRegexEngine() });
  })();
  return highlighterPromise;
}

/** Grammar loaders by Shiki language id. */
const GRAMMARS: Record<string, () => Promise<unknown>> = {
  typescript: () => import("@shikijs/langs/typescript"),
  tsx: () => import("@shikijs/langs/tsx"),
  javascript: () => import("@shikijs/langs/javascript"),
  jsx: () => import("@shikijs/langs/jsx"),
  json: () => import("@shikijs/langs/json"),
  markdown: () => import("@shikijs/langs/markdown"),
  sql: () => import("@shikijs/langs/sql"),
  python: () => import("@shikijs/langs/python"),
  css: () => import("@shikijs/langs/css"),
  html: () => import("@shikijs/langs/html"),
  yaml: () => import("@shikijs/langs/yaml"),
  shellscript: () => import("@shikijs/langs/shellscript"),
  go: () => import("@shikijs/langs/go"),
  java: () => import("@shikijs/langs/java"),
  rust: () => import("@shikijs/langs/rust"),
  ruby: () => import("@shikijs/langs/ruby"),
  php: () => import("@shikijs/langs/php"),
  csharp: () => import("@shikijs/langs/csharp"),
  c: () => import("@shikijs/langs/c"),
  cpp: () => import("@shikijs/langs/cpp"),
};

function shikiLanguage(language: Language, ext: string): string | undefined {
  if (language === "typescript") return ext === "tsx" ? "tsx" : "typescript";
  if (language === "javascript") return ext === "jsx" ? "jsx" : "javascript";
  if (language === "shell") return "shellscript";
  return GRAMMARS[language] ? language : undefined;
}

/** Returns one token array per source line. Unsupported languages come back as plain text. */
export async function highlightLines(code: string, language: Language, ext = ""): Promise<HighlightToken[][]> {
  const plain = () => code.split("\n").map((line) => [{ content: line }]);
  const lang = shikiLanguage(language, ext);
  const load = lang ? GRAMMARS[lang] : undefined;
  if (!lang || !load) return plain();
  try {
    const highlighter = await getHighlighter();
    if (!highlighter.getLoadedLanguages().includes(lang)) await highlighter.loadLanguage(load() as never);
    return highlighter.codeToTokensBase(code, { lang, theme: "github-light-high-contrast" }) as HighlightToken[][];
  } catch {
    return plain();
  }
}
