import type { EntryPoint, SourceFile } from "@/domain/types";

const CODE_FILE = /[\w./-]+\.(?:m?[jt]sx?|cjs|cts|py|go)\b/g;

/** Maps build output paths (dist/server.js) back to likely sources (src/server.ts). */
function candidatePaths(path: string, files: Set<string>): string[] {
  const clean = path.replace(/^\.\//, "");
  const stem = clean.replace(/\.[^.]+$/, "");
  const out = [clean];
  const stripped = stem.replace(/^(dist|build|out|lib)\//, "");
  if (stripped !== stem) {
    for (const ext of [".ts", ".tsx", ".js", ".mjs"]) out.push(`src/${stripped}${ext}`, `${stripped}${ext}`);
  }
  return out.filter((p) => files.has(p));
}

/**
 * Entry points from explicit evidence: package.json fields and scripts, framework file conventions,
 * and conventional file names as a last resort. Each entry says why it was chosen.
 */
export function detectEntryPoints(files: SourceFile[], technologies: string[]): EntryPoint[] {
  const paths = new Set(files.map((f) => f.path));
  const entries: EntryPoint[] = [];
  const add = (path: string, reason: string) => {
    if (paths.has(path) && !entries.some((e) => e.path === path)) entries.push({ path, reason });
  };

  const manifest = files.find((f) => f.path === "package.json");
  if (manifest) {
    try {
      const pkg = JSON.parse(manifest.content) as { main?: string; module?: string; bin?: string | Record<string, string>; scripts?: Record<string, string> };
      for (const key of ["main", "module"] as const) {
        const value = pkg[key];
        if (value) for (const p of candidatePaths(value, paths)) add(p, `package.json "${key}"`);
      }
      const bins = typeof pkg.bin === "string" ? [pkg.bin] : Object.values(pkg.bin ?? {});
      for (const b of bins) for (const p of candidatePaths(b, paths)) add(p, 'package.json "bin"');
      for (const [name, command] of Object.entries(pkg.scripts ?? {})) {
        if (!/^(dev|start|serve|server|main)/.test(name)) continue;
        for (const m of command.matchAll(CODE_FILE)) for (const p of candidatePaths(m[0], paths)) add(p, `package.json script "${name}"`);
      }
    } catch {
      // Malformed package.json: fall through to conventions.
    }
  }

  if (technologies.includes("Next.js")) {
    for (const p of ["app/layout.tsx", "src/app/layout.tsx", "app/layout.jsx", "src/app/layout.jsx", "pages/_app.tsx", "src/pages/_app.tsx", "pages/index.tsx", "src/pages/index.tsx"]) {
      add(p, "Next.js root layout/page");
    }
  }
  if (technologies.includes("Vite")) {
    for (const p of ["src/main.tsx", "src/main.ts", "src/main.jsx", "src/main.js", "index.html"]) add(p, "Vite application entry");
  }

  if (entries.length === 0) {
    const conventional = /^(src\/|cmd\/[^/]+\/)?(index|main|server|app|cli|manage|__main__)\.(ts|tsx|js|jsx|mjs|cjs|py|go)$/;
    for (const f of files) if (conventional.test(f.path)) add(f.path, "Conventional entry file name");
  }
  return entries;
}
