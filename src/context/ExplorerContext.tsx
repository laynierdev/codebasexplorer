"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { AssistantMessage, Repository } from "@/domain/types";
import { answerQuestion } from "@/lib/assistant/mockAssistant";
import { demoRepository } from "@/mock/buildDemoRepo";

export interface LineRange {
  start: number;
  end: number;
}

interface ExplorerState {
  repo: Repository;
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
}

const ExplorerContext = createContext<ExplorerState | null>(null);

export function ExplorerProvider({ children }: { children: ReactNode }) {
  const repo = demoRepository;
  const router = useRouter();
  const pathname = usePathname();
  const [selectedFile, setSelectedFile] = useState("src/server.ts");
  const [highlight, setHighlight] = useState<LineRange | null>(null);
  const [assistantOpen, setAssistantOpen] = useState(true);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [thinking, setThinking] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const counter = useRef(0);

  // On narrow screens the assistant starts closed so it does not cover the content.
  useEffect(() => {
    if (window.matchMedia("(max-width: 1199px)").matches) setAssistantOpen(false);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

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

  const value = useMemo<ExplorerState>(
    () => ({ repo, selectedFile, highlight, openFile, assistantOpen, setAssistantOpen, messages, thinking, ask, clearMessages }),
    [repo, selectedFile, highlight, openFile, assistantOpen, messages, thinking, ask, clearMessages],
  );

  return <ExplorerContext.Provider value={value}>{children}</ExplorerContext.Provider>;
}

export function useExplorer(): ExplorerState {
  const ctx = useContext(ExplorerContext);
  if (!ctx) throw new Error("useExplorer must be used inside ExplorerProvider");
  return ctx;
}
