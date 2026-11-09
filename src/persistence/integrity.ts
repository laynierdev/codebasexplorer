import type { Repository } from "@/domain/types";

const MAX_ISSUES = 12;

/**
 * Cross-reference checks that a schema cannot express. Data that passes the schema but points at files
 * that do not exist would make the UI misbehave, so imports with such problems are rejected with a clear list.
 */
export function checkRepositoryIntegrity(repo: Repository): string[] {
  const issues: string[] = [];
  const add = (message: string) => {
    if (issues.length < MAX_ISSUES) issues.push(message);
  };

  const paths = new Set<string>();
  for (const f of repo.files) {
    if (paths.has(f.path)) add(`Duplicate file path: ${f.path}`);
    paths.add(f.path);
    if (f.path.startsWith("/") || f.path.split("/").includes("..")) add(`Unsafe file path: ${f.path}`);
    if (f.size < 0 || f.lineCount < 0) add(`Negative size in ${f.path}`);
  }
  const lines = new Map(repo.files.map((f) => [f.path, f.lineCount]));

  for (const s of repo.symbols) {
    const count = lines.get(s.file);
    if (count === undefined) add(`Symbol ${s.name} refers to a missing file: ${s.file}`);
    else if (s.endLine < s.startLine || s.endLine > count) add(`Symbol ${s.name} in ${s.file} has an invalid line range ${s.startLine}-${s.endLine}`);
  }
  for (const d of repo.dependencies) {
    if (!paths.has(d.from) || !paths.has(d.to)) add(`Dependency ${d.from} -> ${d.to} refers to a missing file`);
  }
  for (const u of repo.externalUsages) if (!paths.has(u.file)) add(`External usage refers to a missing file: ${u.file}`);
  for (const e of repo.entryPoints) if (!paths.has(e.path)) add(`Entry point refers to a missing file: ${e.path}`);
  for (const e of repo.endpoints) if (!paths.has(e.file)) add(`Endpoint ${e.method} ${e.path} refers to a missing file: ${e.file}`);
  for (const flow of repo.flows) {
    for (const step of flow.steps) {
      const count = lines.get(step.file);
      if (count === undefined) add(`Flow "${flow.title}" refers to a missing file: ${step.file}`);
      else if (step.startLine !== undefined && (step.startLine > count || (step.endLine ?? step.startLine) > count)) add(`Flow "${flow.title}" has a step outside ${step.file}`);
    }
  }
  if (repo.analysis.analyzedFiles !== repo.files.length) add(`The analysis says ${repo.analysis.analyzedFiles} files were analyzed but ${repo.files.length} are present`);
  return issues;
}
