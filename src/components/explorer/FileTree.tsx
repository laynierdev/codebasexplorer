"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
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

interface Row {
  node: TreeNode;
  depth: number;
  parent: string | null;
}

/**
 * File tree following the WAI-ARIA tree pattern: a single tab stop (roving tabindex),
 * Up/Down move between visible items, Right/Left expand/collapse or move to child/parent,
 * Home/End jump to the first/last item, Enter or Space activates.
 */
export function FileTree({ root, selected, onSelect }: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState<string | null>(null);
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const moveFocus = useRef(false);
  const q = query.trim().toLowerCase();

  const tree = useMemo(() => (q ? (filterTree(root, q) ?? { ...root, children: [] }) : root), [root, q]);
  const forcedOpen = useMemo(() => new Set(ancestors(selected)), [selected]);
  const isOpen = useCallback((path: string) => Boolean(q) || forcedOpen.has(path) || !collapsed.has(path), [q, forcedOpen, collapsed]);

  /** Visible rows in display order. */
  const rows = useMemo(() => {
    const out: Row[] = [];
    const walk = (node: TreeNode, depth: number, parent: string | null) => {
      out.push({ node, depth, parent });
      if (node.type === "dir" && isOpen(node.path)) node.children?.forEach((c) => walk(c, depth + 1, node.path));
    };
    tree.children?.forEach((c) => walk(c, 0, null));
    return out;
  }, [tree, isOpen]);

  const tabStop = rows.some((r) => r.node.path === focused) ? focused : rows.some((r) => r.node.path === selected) ? selected : (rows[0]?.node.path ?? null);

  // After a keyboard move, put DOM focus on the newly active item.
  useEffect(() => {
    if (moveFocus.current && focused) {
      refs.current.get(focused)?.focus();
      moveFocus.current = false;
    }
  }, [focused, rows]);

  const toggle = (path: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const goTo = (path: string | undefined) => {
    if (!path) return;
    moveFocus.current = true;
    setFocused(path);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    const current = tabStop;
    const index = rows.findIndex((r) => r.node.path === current);
    const row = rows[index];
    if (!row) return;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        goTo(rows[Math.min(index + 1, rows.length - 1)]?.node.path);
        break;
      case "ArrowUp":
        e.preventDefault();
        goTo(rows[Math.max(index - 1, 0)]?.node.path);
        break;
      case "Home":
        e.preventDefault();
        goTo(rows[0]?.node.path);
        break;
      case "End":
        e.preventDefault();
        goTo(rows[rows.length - 1]?.node.path);
        break;
      case "ArrowRight":
        if (row.node.type === "dir") {
          e.preventDefault();
          if (!isOpen(row.node.path)) toggle(row.node.path);
          else goTo(rows[index + 1]?.parent === row.node.path ? rows[index + 1]?.node.path : undefined);
        }
        break;
      case "ArrowLeft":
        e.preventDefault();
        if (row.node.type === "dir" && isOpen(row.node.path) && !forcedOpen.has(row.node.path) && !q) toggle(row.node.path);
        else if (row.parent) goTo(row.parent);
        break;
    }
  };

  const itemId = (path: string) => `tree-item-${path.replace(/[^A-Za-z0-9_-]/g, "_")}`;

  const render = (node: TreeNode, depth: number) => {
    const pad = { paddingLeft: 6 + depth * 14 };
    const setRef = (el: HTMLButtonElement | null) => {
      if (el) refs.current.set(node.path, el);
      else refs.current.delete(node.path);
    };
    if (node.type === "dir") {
      const open = isOpen(node.path);
      return (
        <li key={node.path} role="none">
          <button
            type="button"
            role="treeitem"
            id={itemId(node.path)}
            ref={setRef}
            aria-expanded={open}
            aria-selected={false}
            tabIndex={tabStop === node.path ? 0 : -1}
            className="tree-row"
            style={pad}
            onFocus={() => setFocused(node.path)}
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
          id={itemId(node.path)}
          ref={setRef}
          aria-selected={selected === node.path}
          aria-current={selected === node.path ? "true" : undefined}
          tabIndex={tabStop === node.path ? 0 : -1}
          className={`tree-row${selected === node.path ? " selected" : ""}`}
          style={{ ...pad, paddingLeft: 6 + depth * 14 + 16 }}
          onFocus={() => setFocused(node.path)}
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
        <input id="tree-filter" className="form-control form-control-sm" placeholder="Filter files…" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <div className="tree-scroll">
        {tree.children?.length ? (
          <ul role="tree" aria-label="Repository files" className="list-unstyled m-0" onKeyDown={onKeyDown}>
            {tree.children.map((c) => render(c, 0))}
          </ul>
        ) : (
          <p className="text-muted p-2 mb-0" role="status">
            No files match “{query}”.
          </p>
        )}
      </div>
    </>
  );
}
