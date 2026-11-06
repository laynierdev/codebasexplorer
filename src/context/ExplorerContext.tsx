"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { AnalysisLimits, AssistantMessage, Repository } from "@/domain/types";
import { DEFAULT_LIMITS } from "@/analysis/limits";
import { answerQuestion } from "@/lib/assistant/mockAssistant";


export interface LineRange {
  start: number;
  end: number;
}

export type ImportState =
  | { status: "idle" }
  | { status: "running"; stage: string; done: number; total: number }
  | { status: "error"; message: string };

interface ExplorerState {
  repo: Repository;
  /** "demo" for the bundled sample, "imported" for a repository analyzed in this session. */
  source: "demo" | "imported";
  selectedFile: string;
  highlight: LineRange | null;
  /** Opens a file in the workspace, optionally highlighting a line range. */
  openFile: (path: string, range?: LineRange) => void;
  assistantOpen: boolean;
  setAssistantOpen: (open: boolean) => void;
  messages: AssistantMessage[];
  thinking: boolean;
  ask: (question: string) => void;
  clearMessages: () => void;
  limits: AnalysisLimits;
  setLimits: (limits: AnalysisLimits) => void;
  importState: ImportState;
  importZip: (file: File) => Promise<boolean>;
  importFolder: (files: File[]) => Promise<boolean>;
  clearImportError: () => void;
  resetToDemo: () => void;
}

const ExplorerContext = createContext<ExplorerState | null>(null);

function initialFile(repo: Repository): string {
  return repo.entryPoints[0]?.path ?? repo.files.find((f) => f.parsed)?.path ?? repo.files[0]?.path ?? "";
}

export function ExplorerProvider({ children, demo }: { children: ReactNode; demo: Repository }) {
  const router = useRouter();
  const pathname = usePathname();
  const [repo, setRepo] = useState<Repository>(demo);
  const [source, setSource] = useState<"demo" | "imported">("demo");
  const [selectedFile, setSelectedFile] = useState(initialFile(demo));
  const [highlight, setHighlight] = useState<LineRange | null>(null);
  const [assistantOpen, setAssistantOpen] = useState(true);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [thinking, setThinking] = useState(false);
  const [limits, setLimits] = useState<AnalysisLimits>(DEFAULT_LIMITS);
  const [importState, setImportState] = useState<ImportState>({ status: "idle" });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const counter = useRef(0);

  // On narrow screens the assistant starts closed so it does not cover the content.
  useEffect(() => {
    if (window.matchMedia("(max-width: 1199px)").matches) setAssistantOpen(false);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const loadRepository = useCallback(
    (next: Repository, origin: "demo" | "imported") => {
      if (timer.current) clearTimeout(timer.current);
      setRepo(next);
      setSource(origin);
      setSelectedFile(initialFile(next));
      setHighlight(null);
      setMessages([]);
      setThinking(false);
      router.push("/");
    },
    [router],
  );

  const runImport = useCallback(
    async (task: (onProgress: (stage: string, done: number, total: number) => void) => Promise<Repository>): Promise<boolean> => {
      setImportState({ status: "running", stage: "Starting", done: 0, total: 1 });
      try {
        const next = await task((stage, done, total) => setImportState({ status: "running", stage, done, total }));
        setImportState({ status: "idle" });
        loadRepository(next, "imported");
        return true;
      } catch (err) {
        setImportState({ status: "error", message: err instanceof Error ? err.message : "The repository could not be analyzed." });
        return false;
      }
    },
    [loadRepository],
  );

  const importZip = useCallback(
    async (file: File) => {
      const { analyzeZipFile } = await import("@/analysis/client");
      return runImport((p) => analyzeZipFile(file, limits, p));
    },
    [limits, runImport],
  );

  const importFolder = useCallback(
    async (files: File[]) => {
      const { analyzeFolderFiles } = await import("@/analysis/client");
      return runImport((p) => analyzeFolderFiles(files, limits, p));
    },
    [limits, runImport],
  );

  const openFile = useCallback(
    (path: string, range?: LineRange) => {
      setSelectedFile(path);
      setHighlight(range ?? null);
      // When the assistant is an overlay (narrow screens), reveal the source it points to.
      if (window.matchMedia("(max-width: 1199px)").matches) setAssistantOpen(false);
      if (pathname !== "/workspace") router.push("/workspace");
    },
    [pathname, router],
  );

  const ask = useCallback(
    (question: string) => {
      const text = question.trim();
      if (!text || thinking) return;
      const id = () => "m" + ++counter.current;
      setMessages((prev) => [...prev, { id: id(), role: "user", text }]);
      setThinking(true);
      timer.current = setTimeout(() => {
        const blocks = answerQuestion(repo, text, { selectedFile });
        setMessages((prev) => [...prev, { id: id(), role: "assistant", blocks, provider: "mock" }]);
        setThinking(false);
      }, 500);
    },
    [repo, selectedFile, thinking],
  );

  const clearMessages = useCallback(() => setMessages([]), []);
  const clearImportError = useCallback(() => setImportState({ status: "idle" }), []);
  const resetToDemo = useCallback(() => loadRepository(demo, "demo"), [loadRepository, demo]);

  const value = useMemo<ExplorerState>(
    () => ({
      repo,
      source,
      selectedFile,
      highlight,
      openFile,
      assistantOpen,
      setAssistantOpen,
      messages,
      thinking,
      ask,
      clearMessages,
      limits,
      setLimits,
      importState,
      importZip,
      importFolder,
      clearImportError,
      resetToDemo,
    }),
    [repo, source, selectedFile, highlight, openFile, assistantOpen, messages, thinking, ask, clearMessages, limits, importState, importZip, importFolder, clearImportError, resetToDemo],
  );

  return <ExplorerContext.Provider value={value}>{children}</ExplorerContext.Provider>;
}

export function useExplorer(): ExplorerState {
  const ctx = useContext(ExplorerContext);
  if (!ctx) throw new Error("useExplorer must be used inside ExplorerProvider");
  return ctx;
}
