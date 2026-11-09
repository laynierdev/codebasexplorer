"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useExplorer } from "@/context/ExplorerContext";
import { useProjects } from "@/context/ProjectsContext";
import { SaveProjectDialog } from "@/components/projects/SaveProjectDialog";
import { LogoMark } from "@/components/ui/LogoMark";
import type { ProjectMeta } from "@/persistence/schemas";
import { AssistantPanel } from "@/components/assistant/AssistantPanel";
import { ImportModal } from "@/components/layout/ImportModal";
import { QuickSearch } from "@/components/layout/QuickSearch";

const NAV = [
  { href: "/", label: "Dashboard", icon: "bi-speedometer2" },
  { href: "/projects", label: "Projects", icon: "bi-collection" },
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
  const { repo, source, projectId, assistantOpen, setAssistantOpen } = useExplorer();
  const { canSave, projects, open, ready } = useProjects();
  const [importOpen, setImportOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const flush = pathname === "/workspace" || pathname === "/architecture";
  const mainRef = useRef<HTMLElement>(null);
  const firstRender = useRef(true);

  // Page titles come from each route's metadata. After a navigation, keyboard and screen-reader users land on the content.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    mainRef.current?.focus({ preventScroll: true });
  }, [pathname]);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <nav className="app-nav" aria-label="Main navigation">
        <Link href="/" className="app-brand" aria-label="CodebaseXplorer home">
          <LogoMark size={30} />
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
            <ProjectSwitcher name={repo.name} projects={projects} currentId={projectId} demoActive={source === "demo"} onOpen={open} onImport={() => setImportOpen(true)} />
          </div>
          <span
            className="chip d-none d-md-inline-flex"
            title={source === "demo" ? "Bundled sample repository" : projectId ? "Saved in this browser's storage" : "Only in memory: it will be gone after a reload unless you save it"}
          >
            <i className={`bi ${source === "demo" ? "bi-box-seam" : projectId ? "bi-check2-circle" : "bi-hdd"}`} aria-hidden="true" />{" "}
            {source === "demo" ? "Demo project" : projectId ? "Saved" : "Not saved"}
          </span>
          <div className="flex-grow-1 d-none d-md-block" />
          <QuickSearch />
          {canSave && ready && (
            <button type="button" className="btn btn-warning btn-sm" onClick={() => setSaveOpen(true)}>
              <i className="bi bi-save" aria-hidden="true" />
              <span className="ms-1">Save</span>
            </button>
          )}
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
          <main id="main" ref={mainRef} tabIndex={-1} className={`app-main${flush ? " flush" : ""}`}>
            {children}
          </main>
          {assistantOpen && <AssistantPanel />}
        </div>
      </div>

      {importOpen && <ImportModal onClose={() => setImportOpen(false)} />}
      {saveOpen && <SaveProjectDialog onClose={() => setSaveOpen(false)} />}
    </div>
  );
}

function ProjectSwitcher({
  name,
  projects,
  currentId,
  demoActive,
  onOpen,
  onImport,
}: {
  name: string;
  projects: ProjectMeta[];
  currentId: string | null;
  demoActive: boolean;
  onOpen: (id: string) => Promise<boolean>;
  onImport: () => void;
}) {
  const [open, setOpen] = useState(false);
  const { resetToDemo } = useExplorer();
  const close = () => setOpen(false);
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
            if (e.key === "Escape") close();
          }}
        >
          <li>
            <h6 className="dropdown-header">Projects</h6>
          </li>
          <li>
            <button
              type="button"
              role="menuitem"
              className={`dropdown-item${demoActive ? " active" : ""}`}
              onClick={() => {
                close();
                if (!demoActive) resetToDemo();
              }}
            >
              acme-shop-api <span className="small opacity-75">(demo)</span>
            </button>
          </li>
          {projects.slice(0, 8).map((m) => (
            <li key={m.id}>
              <button
                type="button"
                role="menuitem"
                className={`dropdown-item${m.id === currentId ? " active" : ""}`}
                onClick={() => {
                  close();
                  if (m.id !== currentId) void onOpen(m.id);
                }}
              >
                {m.name}
              </button>
            </li>
          ))}
          <li>
            <hr className="dropdown-divider" />
          </li>
          <li>
            <Link href="/projects" role="menuitem" className="dropdown-item" onClick={close}>
              <i className="bi bi-collection me-1" aria-hidden="true" />
              All projects…
            </Link>
          </li>
          <li>
            <button
              type="button"
              role="menuitem"
              className="dropdown-item"
              onClick={() => {
                close();
                onImport();
              }}
            >
              <i className="bi bi-plus-lg me-1" aria-hidden="true" />
              Analyze ZIP or folder…
            </button>
          </li>
        </ul>
      )}
    </>
  );
}
