"use client";

import { useMemo, useState } from "react";
import type { TreeNode } from "@/domain/types";

interface Props {
  root: TreeNode;
  selected: string;
  onSelect: (path: string) => void;
}

function iconFor(name: string): string {
  if (name.endsWith(".ts") || name.endsWith(".tsx")) return "bi-filetype-tsx";
  if (name.endsWith(".json")) return "bi-filetype-json";
  if (name.endsWith(".md")) return "bi-filetype-md";
  if (name.endsWith(".sql")) return "bi-filetype-sql";
  if (name.endsWith(".py")) return "bi-filetype-py";
  return "bi-file-earmark-text";
}

/** Names of the directories on the way to a path, so the selected file is always visible. */
function ancestors(path: string): string[] {
  const parts = path.split("/");
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join("/"));
}

function filterTree(node: TreeNode, query: string): TreeNode | null {
  if (node.type === "file") return node.name.toLowerCase().includes(query) || node.path.toLowerCase().includes(query) ? node : null;
  const children = (node.children ?? []).map((c) => filterTree(c, query)).filter((c): c is TreeNode => c !== null);
  return children.length ? { ...node, children } : null;
}

export function FileTree({ root, selected, onSelect }: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();

  const tree = useMemo(() => (q ? (filterTree(root, q) ?? { ...root, children: [] }) : root), [root, q]);
  const forcedOpen = useMemo(() => new Set(ancestors(selected)), [selected]);

  const toggle = (path: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const isOpen = (path: string) => Boolean(q) || forcedOpen.has(path) || !collapsed.has(path);

  const render = (node: TreeNode, depth: number) => {
    const pad = { paddingLeft: 6 + depth * 14 };
    if (node.type === "dir") {
      const open = isOpen(node.path);
      return (
        <li key={node.path} role="none">
          <button
            type="button"
            role="treeitem"
            aria-expanded={open}
            aria-selected={false}
            className="tree-row"
            style={pad}
            onClick={() => toggle(node.path)}
          >
            <i className={`bi caret ${open ? "bi-chevron-down" : "bi-chevron-right"}`} aria-hidden="true" />
            <i className={`bi ${open ? "bi-folder2-open" : "bi-folder2"}`} aria-hidden="true" />
            {node.name}
          </button>
          {open && (
            <ul role="group" className="list-unstyled m-0">
              {node.children?.map((c) => render(c, depth + 1))}
            </ul>
          )}
        </li>
      );
    }
    return (
      <li key={node.path} role="none">
        <button
          type="button"
          role="treeitem"
          aria-selected={selected === node.path}
          className={`tree-row${selected === node.path ? " selected" : ""}`}
          style={{ ...pad, paddingLeft: 6 + depth * 14 + 16 }}
          onClick={() => onSelect(node.path)}
        >
          <i className={`bi ${iconFor(node.name)}`} aria-hidden="true" />
          {node.name}
        </button>
      </li>
    );
  };

  return (
    <>
      <div className="p-2 border-bottom">
        <label htmlFor="tree-filter" className="visually-hidden">
          Filter files
        </label>
        <input
          id="tree-filter"
          className="form-control form-control-sm"
          placeholder="Filter files…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="tree-scroll">
        {tree.children?.length ? (
          <ul role="tree" aria-label="Repository files" className="list-unstyled m-0">
            {tree.children.map((c) => render(c, 0))}
          </ul>
        ) : (
          <p className="text-muted p-2 mb-0">No files match “{query}”.</p>
        )}
      </div>
    </>
  );
}
