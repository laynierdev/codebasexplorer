import type { Language } from "@/domain/types";
import { typescriptParser } from "./typescript";
import type { LanguageParser } from "./types";

/**
 * Registry of language parsers. To support another language, implement `LanguageParser`
 * and add it here; files of unsupported languages are still indexed and searchable as text.
 */
const PARSERS: LanguageParser[] = [typescriptParser];

export function getParser(language: Language): LanguageParser | undefined {
  return PARSERS.find((p) => p.languages.includes(language));
}

export const SUPPORTED_LANGUAGES: Language[] = PARSERS.flatMap((p) => p.languages);

export type { LanguageParser, ParseResult } from "./types";
