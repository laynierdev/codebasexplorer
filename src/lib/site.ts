/** Public site facts used for metadata, the sitemap and structured data. */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://codebasexplorer.vercel.app").replace(/\/$/, "");
export const SITE_NAME = "CodebaseXplorer";
export const SITE_TAGLINE = "Understand any codebase. Navigate with confidence.";
export const SITE_DESCRIPTION =
  "CodebaseXplorer analyzes a repository in your browser: file explorer, architecture and dependency graphs, execution flows, impact analysis and an AI assistant whose answers cite verified code. Free and open source.";
export const REPO_URL = "https://github.com/laynierdev/codebasexplorer";

/** Routes that show useful, public (demo) content and should be indexed. */
export const INDEXED_ROUTES = ["/", "/workspace", "/architecture", "/dependencies", "/flows", "/impact", "/docs"] as const;
