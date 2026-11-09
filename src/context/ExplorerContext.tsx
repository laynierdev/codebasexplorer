"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { AnalysisLimits, AssistantMessage, Repository } from "@/domain/types";
import type { AiOutcome } from "@/ai/client";
import type { AiStatus, AiTask } from "@/ai/schemas";
import { DEFAULT_LIMITS } from "@/analysis/limits";


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
  aiStatus: AiStatus | null;
  /** Asks a free-form question about the repository. */
  ask: (question: string) => void;
  /** Runs a specific AI task and shows the result in the assistant panel. */
  runTask: (task: AiTask, label: string) => void;
  /** Runs an AI task and returns the grounded outcome (for pages that render it themselves). */
  invokeAi: (task: AiTask) => Promise<AiOutcome>;
  retry: (messageId: string) => void;
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
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);
  const counter = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const retryTasks = useRef(new Map<string, { task: AiTask; label: string }>());

  // On narrow screens the assistant starts closed so it does not cover the content.
  useEffect(() => {
    if (window.matchMedia("(max-width: 1199px)").matches) setAssistantOpen(false);
    return () => abort.current?.abort();
  }, []);

  useEffect(() => {
    let cancelled = false;
    import("@/ai/client").then(({ fetchAiStatus }) => fetchAiStatus().then((status) => !cancelled && setAiStatus(status)));
    return () => {
      cancelled = true;
    };
  }, []);

  const loadRepository = useCallback(
    (next: Repository, origin: "demo" | "imported") => {
      abort.current?.abort();
      retryTasks.current.clear();
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

  const invokeAi = useCallback(
    async (task: AiTask): Promise<AiOutcome> => {
      const { askAi } = await import("@/ai/client");
      return askAi(repo, task, { selectedFile });
    },
    [repo, selectedFile],
  );

  const nextId = useCallback(() => "m" + ++counter.current, []);

  const execute = useCallback(
    async (task: AiTask, label: string, replaceId?: string) => {
      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;
      setThinking(true);
      try {
        const { askAi } = await import("@/ai/client");
        const outcome = await askAi(repo, task, { selectedFile, signal: controller.signal });
        if (controller.signal.aborted) return;
        const message: AssistantMessage =
          outcome.kind === "answer"
            ? { id: nextId(), role: "assistant", blocks: outcome.blocks, meta: outcome.meta }
            : { id: nextId(), role: "assistant", blocks: [{ kind: "uncertain", text: "This kind of result is shown on its own page." }], meta: outcome.meta };
        setMessages((prev) => [...prev.filter((m) => m.id !== replaceId), message]);
      } catch (err) {
        if (controller.signal.aborted) return;
        const id = nextId();
        retryTasks.current.set(id, { task, label });
        setMessages((prev) => [...prev.filter((m) => m.id !== replaceId), { id, role: "assistant", error: err instanceof Error ? err.message : "The AI request failed.", retryLabel: label }]);
      } finally {
        if (abort.current === controller) setThinking(false);
      }
    },
    [repo, selectedFile, nextId],
  );

  const runTask = useCallback(
    (task: AiTask, label: string) => {
      if (thinking) return;
      setAssistantOpen(true);
      setMessages((prev) => [...prev, { id: nextId(), role: "user", text: label }]);
      void execute(task, label);
    },
    [thinking, nextId, execute],
  );

  const ask = useCallback(
    (question: string) => {
      const text = question.trim();
      if (text) runTask({ task: "question", question: text }, text);
    },
    [runTask],
  );

  const retry = useCallback(
    (messageId: string) => {
      const pending = retryTasks.current.get(messageId);
      if (!pending || thinking) return;
      retryTasks.current.delete(messageId);
      void execute(pending.task, pending.label, messageId);
    },
    [thinking, execute],
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
      aiStatus,
      ask,
      runTask,
      invokeAi,
      retry,
      clearMessages,
      limits,
      setLimits,
      importState,
      importZip,
      importFolder,
      clearImportError,
      resetToDemo,
    }),
    [repo, source, selectedFile, highlight, openFile, assistantOpen, messages, thinking, aiStatus, ask, runTask, invokeAi, retry, clearMessages, limits, importState, importZip, importFolder, clearImportError, resetToDemo],
  );

  return <ExplorerContext.Provider value={value}>{children}</ExplorerContext.Provider>;
}

export function useExplorer(): ExplorerState {
  const ctx = useContext(ExplorerContext);
  if (!ctx) throw new Error("useExplorer must be used inside ExplorerProvider");
  return ctx;
}
