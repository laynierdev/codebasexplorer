"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { useExplorer } from "@/context/ExplorerContext";
import { AssistantPanel } from "@/components/assistant/AssistantPanel";
import { ImportModal } from "@/components/layout/ImportModal";
import { QuickSearch } from "@/components/layout/QuickSearch";

const NAV = [
  { href: "/", label: "Dashboard", icon: "bi-speedometer2" },
  { href: "/workspace", label: "Workspace", icon: "bi-folder2-open" },
  { href: "/architecture", label: "Architecture", icon: "bi-diagram-3" },
  { href: "/dependencies", label: "Dependencies", icon: "bi-link-45deg" },
  { href: "/flows", label: "Flows", icon: "bi-signpost-split" },
  { href: "/impact", label: "Impact", icon: "bi-bullseye" },
  { href: "/search", label: "Search", icon: "bi-search" },
  { href: "/docs", label: "Docs", icon: "bi-journal-text" },
  { href: "/settings", label: "Settings", icon: "bi-gear" },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { repo, source, assistantOpen, setAssistantOpen } = useExplorer();
  const [importOpen, setImportOpen] = useState(false);
  const flush = pathname === "/workspace" || pathname === "/architecture";

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <nav className="app-nav" aria-label="Main navigation">
        <Link href="/" className="app-brand" aria-label="CodebaseXplorer home">
          <i className="bi bi-compass" aria-hidden="true" />
          <span>CodebaseXplorer</span>
        </Link>
        {NAV.map((item) => {
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <Link key={item.href} href={item.href} className={`nav-link-cx${active ? " active" : ""}`} aria-current={active ? "page" : undefined}>
              <i className={`bi ${item.icon}`} aria-hidden="true" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="app-main-col">
        <header className="app-header">
          <div className="dropdown">
            <ProjectSwitcher name={repo.name} onImport={() => setImportOpen(true)} />
          </div>
          <span
            className="chip d-none d-md-inline-flex"
            title={source === "demo" ? "Bundled sample repository" : "Analyzed in this browser session; it is not saved yet (persistence arrives in Stage 4)"}
          >
            <i className={`bi ${source === "demo" ? "bi-box-seam" : "bi-hdd"}`} aria-hidden="true" /> {source === "demo" ? "Demo project" : "Imported · this session"}
          </span>
          <div className="flex-grow-1 d-none d-md-block" />
          <QuickSearch />
          <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => setImportOpen(true)} aria-label="Import ZIP">
            <i className="bi bi-file-earmark-zip" aria-hidden="true" />
            <span className="d-none d-sm-inline ms-1">Import ZIP</span>
          </button>
          <button
            type="button"
            className={`btn btn-sm ${assistantOpen ? "btn-primary" : "btn-outline-primary"}`}
            aria-pressed={assistantOpen}
            onClick={() => setAssistantOpen(!assistantOpen)}
          >
            <i className="bi bi-stars" aria-hidden="true" />
            <span className="ms-1">Assistant</span>
          </button>
        </header>

        <div className="app-body">
          <main id="main" tabIndex={-1} className={`app-main${flush ? " flush" : ""}`}>
            {children}
          </main>
          {assistantOpen && <AssistantPanel />}
        </div>
      </div>

      {importOpen && <ImportModal onClose={() => setImportOpen(false)} />}
    </div>
  );
}

function ProjectSwitcher({ name, onImport }: { name: string; onImport: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn btn-sm btn-light border" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen(!open)}>
        <i className="bi bi-github me-1" aria-hidden="true" />
        <strong>{name}</strong> <i className="bi bi-chevron-down ms-1" aria-hidden="true" style={{ fontSize: "0.7rem" }} />
      </button>
      {open && (
        <ul
          className="dropdown-menu show"
          role="menu"
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
          }}
        >
          <li>
            <h6 className="dropdown-header">Projects</h6>
          </li>
          <li>
            <button type="button" role="menuitem" className="dropdown-item active" onClick={() => setOpen(false)}>
              {name} <span className="small opacity-75">(demo)</span>
            </button>
          </li>
          <li>
            <hr className="dropdown-divider" />
          </li>
          <li>
            <button
              type="button"
              role="menuitem"
              className="dropdown-item"
              onClick={() => {
                setOpen(false);
                onImport();
              }}
            >
              <i className="bi bi-plus-lg me-1" aria-hidden="true" />
              Import ZIP…
            </button>
          </li>
        </ul>
      )}
    </>
  );
}
