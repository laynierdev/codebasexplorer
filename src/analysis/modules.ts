import type { FileDependency, Layer, Module, ModuleDependency, SourceFile } from "@/domain/types";

/** A module is a directory that contains source files. Layer = the most common layer among its files. */
export function buildModules(files: SourceFile[], dependencies: FileDependency[]): { modules: Module[]; moduleDependencies: ModuleDependency[] } {
  const byDir = new Map<string, SourceFile[]>();
  for (const f of files) {
    if (!f.parsed) continue;
    const key = f.dir === "" ? "." : f.dir;
    byDir.set(key, [...(byDir.get(key) ?? []), f]);
  }

  const modules: Module[] = [...byDir.entries()]
    .map(([dir, members]) => {
      const counts = new Map<Layer, number>();
      for (const m of members) counts.set(m.layer, (counts.get(m.layer) ?? 0) + 1);
      const layer = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "other";
      return {
        id: dir,
        path: dir === "." ? "" : dir,
        name: dir === "." ? "(root)" : (dir.split("/").pop() as string),
        layer,
        fileCount: members.length,
        lineCount: members.reduce((s, m) => s + m.lineCount, 0),
      };
    })
    .sort((a, b) => b.lineCount - a.lineCount);

  const dirOf = new Map(files.map((f) => [f.path, f.dir === "" ? "." : f.dir]));
  const counts = new Map<string, number>();
  for (const d of dependencies) {
    const from = dirOf.get(d.from);
    const to = dirOf.get(d.to);
    if (!from || !to || from === to) continue;
    const key = `${from}\u0000${to}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const moduleDependencies: ModuleDependency[] = [...counts.entries()].map(([key, count]) => {
    const [from, to] = key.split("\u0000") as [string, string];
    return { from, to, count };
  });
  return { modules, moduleDependencies };
}
