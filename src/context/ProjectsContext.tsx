"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DEFAULT_LIMITS } from "@/analysis/limits";
import type { DocSection } from "@/ai/schemas";
import { useExplorer } from "@/context/ExplorerContext";
import { downloadText } from "@/lib/download";
import { StorageError } from "@/persistence/errors";
import { applyImport as runApplyImport, buildExport, exportFileName, parseImport, serializeExport, type ImportReport, type ParsedImport, type Resolution } from "@/persistence/exportImport";
import { openStore } from "@/persistence";
import { metaFromRepository } from "@/persistence/projects";
import type { AppSettings, ProjectMeta, StoredDoc } from "@/persistence/schemas";
import type { ProjectStore, StorageUsage } from "@/persistence/store";

const DEFAULT_SETTINGS: AppSettings = { limits: DEFAULT_LIMITS, autoSave: false, consentGiven: false };

interface ProjectsState {
  /** The store has been opened and the project list loaded. */
  ready: boolean;
  /** False when browser storage is unavailable: nothing survives a reload. */
  persistent: boolean;
  storageNotice: string | null;
  projects: ProjectMeta[];
  /** Ids of stored records that failed validation. */
  damaged: string[];
  usage: StorageUsage;
  settings: AppSettings;
  /** AI-written documentation saved for the project being viewed. */
  docs: StoredDoc[];
  busy: boolean;
  error: string | null;
  clearError: () => void;
  /** The repository being viewed was analyzed in this session and has not been saved yet. */
  canSave: boolean;
  saveCurrent: (options?: { acceptConsent?: boolean; autoSave?: boolean }) => Promise<boolean>;
  open: (id: string) => Promise<boolean>;
  remove: (id: string) => Promise<boolean>;
  rename: (id: string, patch: { name?: string; description?: string }) => Promise<boolean>;
  /** Downloads the given saved projects (or all saved projects when no ids are given) as one JSON file. */
  exportProjects: (ids?: string[]) => Promise<boolean>;
  exportCurrent: () => Promise<boolean>;
  previewImport: (file: File) => Promise<ParsedImport>;
  applyImport: (parsed: ParsedImport, resolutions: Record<string, Resolution>) => Promise<ImportReport>;
  clearAll: () => Promise<boolean>;
  saveSettings: (patch: Partial<AppSettings>) => Promise<boolean>;
  saveDoc: (doc: StoredDoc) => Promise<void>;
  deleteDoc: (section: DocSection) => Promise<void>;
  refresh: () => Promise<void>;
}

const ProjectsContext = createContext<ProjectsState | null>(null);

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong.";
}

export function ProjectsProvider({ children }: { children: ReactNode }) {
  const explorer = useExplorer();
  const { repo, source, projectId, origin, openRepository, markSaved, setLimits } = explorer;
  const storeRef = useRef<ProjectStore | null>(null);
  const [ready, setReady] = useState(false);
  const [persistent, setPersistent] = useState(true);
  const [storageNotice, setStorageNotice] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [damaged, setDamaged] = useState<string[]>([]);
  const [usage, setUsage] = useState<StorageUsage>({});
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [docs, setDocs] = useState<StoredDoc[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autoSaved = useRef<unknown>(null);

  const refresh = useCallback(async () => {
    const store = storeRef.current;
    if (!store) return;
    const list = await store.list();
    setProjects(list.projects);
    setDamaged(list.damaged);
    setUsage(await store.usage());
  }, []);

  // Open the store once and load projects and settings.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const opened = await openStore();
      if (cancelled) {
        opened.store.close();
        return;
      }
      storeRef.current = opened.store;
      setPersistent(opened.persistent);
      setStorageNotice(opened.reason ?? null);
      try {
        const saved = await opened.store.getSettings();
        if (saved) {
          setSettings(saved);
          setLimits(saved.limits);
        }
        await refresh();
      } catch (err) {
        setError(messageOf(err));
      }
      setReady(true);
    })();
    return () => {
      cancelled = true;
      storeRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount
  }, []);

  // Documentation saved for the project being viewed.
  useEffect(() => {
    const store = storeRef.current;
    if (!ready || !store || !projectId) {
      setDocs([]);
      return;
    }
    let cancelled = false;
    store.listDocs(projectId).then((d) => !cancelled && setDocs(d), () => !cancelled && setDocs([]));
    return () => {
      cancelled = true;
    };
  }, [ready, projectId]);

  const run = useCallback(async <T,>(fn: () => Promise<T>, fallback: T): Promise<T> => {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (err) {
      setError(messageOf(err));
      return fallback;
    } finally {
      setBusy(false);
    }
  }, []);

  const saveSettings = useCallback(
    (patch: Partial<AppSettings>) =>
      run(async () => {
        const store = storeRef.current;
        const next = { ...settings, ...patch };
        if (store) await store.saveSettings(next);
        setSettings(next);
        if (patch.limits) setLimits(patch.limits);
        return true;
      }, false),
    [run, settings, setLimits],
  );

  const saveCurrent = useCallback(
    (options?: { acceptConsent?: boolean; autoSave?: boolean }) =>
      run(async () => {
        const store = storeRef.current;
        if (!store || source !== "imported" || projectId) return false;
        let current = settings;
        if (options?.acceptConsent) {
          current = { ...settings, consentGiven: true, autoSave: options.autoSave ?? settings.autoSave };
          await store.saveSettings(current);
          setSettings(current);
        }
        if (!current.consentGiven) throw new StorageError("unknown", "Please confirm what will be stored before saving.");
        const meta = metaFromRepository(repo, { origin, limits: current.limits });
        await store.save({ meta, repository: repo });
        markSaved(meta.id);
        await refresh();
        // Ask the browser not to evict the data under storage pressure (best effort, may prompt in some browsers).
        void navigator.storage?.persist?.().catch(() => undefined);
        return true;
      }, false),
    [run, source, projectId, settings, repo, origin, markSaved, refresh],
  );

  // Automatic saving, only after the user accepted the storage explanation and enabled it.
  useEffect(() => {
    if (!ready || !persistent || source !== "imported" || projectId || !settings.autoSave || !settings.consentGiven) return;
    if (autoSaved.current === repo) return;
    autoSaved.current = repo;
    void saveCurrent();
  }, [ready, persistent, source, projectId, settings.autoSave, settings.consentGiven, repo, saveCurrent]);

  const open = useCallback(
    (id: string) =>
      run(async () => {
        const store = storeRef.current;
        if (!store) return false;
        const stored = await store.get(id);
        if (!stored) throw new StorageError("not-found", "That project no longer exists.");
        await store.updateMeta(id, { lastOpenedAt: new Date().toISOString() });
        openRepository(stored.repository, id);
        await refresh();
        return true;
      }, false),
    [run, openRepository, refresh],
  );

  const remove = useCallback(
    (id: string) =>
      run(async () => {
        const store = storeRef.current;
        if (!store) return false;
        await store.delete(id);
        await refresh();
        // If the deleted project is on screen it stays viewable, but it is no longer a saved project.
        if (id === projectId) openRepository(repo, null);
        return true;
      }, false),
    [run, refresh, projectId, openRepository, repo],
  );

  const rename = useCallback(
    (id: string, patch: { name?: string; description?: string }) =>
      run(async () => {
        const store = storeRef.current;
        if (!store) return false;
        await store.updateMeta(id, { ...patch, updatedAt: new Date().toISOString() });
        await refresh();
        return true;
      }, false),
    [run, refresh],
  );

  const exportProjects = useCallback(
    (ids?: string[]) =>
      run(async () => {
        const store = storeRef.current;
        if (!store) return false;
        const targets = ids ?? (await store.list()).projects.map((p) => p.id);
        const entries = [];
        for (const id of targets) {
          const stored = await store.get(id);
          if (stored) entries.push({ meta: stored.meta, repository: stored.repository, docs: await store.listDocs(id) });
        }
        if (entries.length === 0) throw new StorageError("not-found", "There is nothing to export.");
        downloadText(exportFileName(entries.map((e) => e.meta)), serializeExport(buildExport(entries)), "application/json");
        return true;
      }, false),
    [run],
  );

  const exportCurrent = useCallback(
    () =>
      run(async () => {
        const store = storeRef.current;
        if (projectId && store) {
          const stored = await store.get(projectId);
          if (stored) {
            downloadText(exportFileName([stored.meta]), serializeExport(buildExport([{ meta: stored.meta, repository: stored.repository, docs: await store.listDocs(projectId) }])), "application/json");
            return true;
          }
        }
        // Not saved: export the in-memory repository without storing it.
        const meta = metaFromRepository(repo, { origin, limits: settings.limits });
        downloadText(exportFileName([meta]), serializeExport(buildExport([{ meta, repository: repo, docs: [] }])), "application/json");
        return true;
      }, false),
    [run, projectId, repo, origin, settings.limits],
  );

  const previewImport = useCallback(async (file: File): Promise<ParsedImport> => {
    const store = storeRef.current;
    const text = await file.text();
    return parseImport(text, store ? (await store.list()).projects : []);
  }, []);

  const applyImport = useCallback(
    async (parsed: ParsedImport, resolutions: Record<string, Resolution>): Promise<ImportReport> => {
      const store = storeRef.current;
      if (!store) throw new StorageError("unavailable", "Browser storage is not available.");
      const report = await runApplyImport(store, parsed, resolutions);
      await refresh();
      return report;
    },
    [refresh],
  );

  const clearAll = useCallback(
    () =>
      run(async () => {
        const store = storeRef.current;
        if (!store) return false;
        await store.clearAll();
        setSettings(DEFAULT_SETTINGS);
        setLimits(DEFAULT_LIMITS);
        await refresh();
        if (projectId) openRepository(repo, null);
        return true;
      }, false),
    [run, refresh, setLimits, projectId, openRepository, repo],
  );

  const saveDoc = useCallback(
    async (doc: StoredDoc) => {
      const store = storeRef.current;
      if (!store || !projectId) return;
      try {
        await store.saveDoc(projectId, doc);
        setDocs((prev) => [...prev.filter((d) => d.section !== doc.section), doc]);
      } catch (err) {
        setError(messageOf(err));
      }
    },
    [projectId],
  );

  const deleteDoc = useCallback(
    async (section: DocSection) => {
      const store = storeRef.current;
      if (!store || !projectId) return;
      try {
        await store.deleteDoc(projectId, section);
        setDocs((prev) => prev.filter((d) => d.section !== section));
      } catch (err) {
        setError(messageOf(err));
      }
    },
    [projectId],
  );

  const value = useMemo<ProjectsState>(
    () => ({
      ready,
      persistent,
      storageNotice,
      projects,
      damaged,
      usage,
      settings,
      docs,
      busy,
      error,
      clearError: () => setError(null),
      canSave: source === "imported" && !projectId,
      saveCurrent,
      open,
      remove,
      rename,
      exportProjects,
      exportCurrent,
      previewImport,
      applyImport,
      clearAll,
      saveSettings,
      saveDoc,
      deleteDoc,
      refresh,
    }),
    [ready, persistent, storageNotice, projects, damaged, usage, settings, docs, busy, error, source, projectId, saveCurrent, open, remove, rename, exportProjects, exportCurrent, previewImport, applyImport, clearAll, saveSettings, saveDoc, deleteDoc, refresh],
  );

  return <ProjectsContext.Provider value={value}>{children}</ProjectsContext.Provider>;
}

export function useProjects(): ProjectsState {
  const ctx = useContext(ProjectsContext);
  if (!ctx) throw new Error("useProjects must be used inside ProjectsProvider");
  return ctx;
}
