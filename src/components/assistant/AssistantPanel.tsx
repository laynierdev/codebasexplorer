"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { AnswerBlock, AssistantMessage } from "@/domain/types";
import { useExplorer } from "@/context/ExplorerContext";
import { suggestedQuestions } from "@/ai/suggestions";
import { excerpt } from "@/lib/repo/refs";
import { EvidenceBadge, formatRef } from "@/components/ui/primitives";

export function AssistantPanel() {
  const { repo, messages, thinking, ask, runTask, retry, clearMessages, setAssistantOpen, selectedFile, aiStatus } = useExplorer();
  const [input, setInput] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, thinking]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    ask(input);
    setInput("");
  };

  const providerChip =
    aiStatus === null ? (
      <span className="chip ms-1">…</span>
    ) : aiStatus.provider === "gemini" ? (
      <span className="chip ms-1" title={`Gemini model ${aiStatus.model}. Calls are made by the server; your API key never reaches the browser.`}>
        Gemini
      </span>
    ) : (
      <span className="chip ms-1" title="Mock provider: answers are assembled from analysis results. Set GEMINI_API_KEY on the server to use Gemini.">
        Mock AI
      </span>
    );

  return (
    <aside className="assistant" aria-label="AI assistant">
      <div className="d-flex align-items-center justify-content-between px-3 py-2 border-bottom">
        <div>
          <strong>Assistant</strong> {providerChip}
        </div>
        <div className="d-flex gap-1">
          {messages.length > 0 && (
            <button type="button" className="btn btn-sm btn-light" onClick={clearMessages}>
              Clear
            </button>
          )}
          <button type="button" className="btn btn-sm btn-light" aria-label="Close assistant" onClick={() => setAssistantOpen(false)}>
            <i className="bi bi-x-lg" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="assistant-scroll" aria-live="polite">
        {messages.length === 0 && (
          <div>
            <p className="text-muted">
              Ask about this repository. Answers cite real files and lines, and label what is fact, inference, recommendation or uncertain.
              {aiStatus?.provider === "mock" && " You are in mock mode: answers come from analysis results, not from a language model."}
            </p>
            <p className="small text-muted mb-1">
              Current file: <span className="mono">{selectedFile}</span>
            </p>
            <div className="d-flex flex-column gap-2 mt-3">
              {suggestedQuestions(repo).map((q) => (
                <button key={q} type="button" className="btn btn-sm btn-outline-secondary text-start" onClick={() => ask(q)} disabled={thinking}>
                  {q}
                </button>
              ))}
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary text-start"
                disabled={thinking || !selectedFile}
                onClick={() => runTask({ task: "explain-file", path: selectedFile }, `Explain ${selectedFile}`)}
              >
                Explain this file
              </button>
            </div>
          </div>
        )}
        {messages.map((m) => (
          <MessageView key={m.id} message={m} onRetry={() => retry(m.id)} retryDisabled={thinking} />
        ))}
        {thinking && (
          <div className="text-muted small" role="status">
            <span className="spinner-border spinner-border-sm me-2" aria-hidden="true" />
            Selecting context and asking {aiStatus?.provider === "gemini" ? "Gemini" : "the mock provider"}…
          </div>
        )}
        <div ref={endRef} />
      </div>

      <form className="assistant-form" onSubmit={submit}>
        <label htmlFor="assistant-input" className="visually-hidden">
          Ask a question about the repository
        </label>
        <div className="input-group">
          <input id="assistant-input" className="form-control" placeholder="Ask about this codebase…" value={input} onChange={(e) => setInput(e.target.value)} disabled={thinking} maxLength={2000} />
          <button className="btn btn-primary" type="submit" disabled={thinking || !input.trim()}>
            Ask
          </button>
        </div>
      </form>
    </aside>
  );
}

function MessageView({ message, onRetry, retryDisabled }: { message: AssistantMessage; onRetry: () => void; retryDisabled: boolean }) {
  if (message.role === "user") return <div className="msg-user">{message.text}</div>;
  if (message.error) {
    return (
      <div className="msg-ai border-danger" role="alert">
        <div className="fw-semibold text-danger mb-1">The request failed</div>
        <div>{message.error}</div>
        <button type="button" className="btn btn-sm btn-outline-primary mt-2" onClick={onRetry} disabled={retryDisabled}>
          <i className="bi bi-arrow-repeat me-1" aria-hidden="true" />
          Try again
        </button>
      </div>
    );
  }
  const meta = message.meta;
  return (
    <div className="msg-ai">
      {meta?.fallbackReason && (
        <div className="alert alert-warning py-1 px-2 small" role="status">
          <strong>Gemini was unavailable.</strong> {meta.fallbackReason} This answer comes from the mock provider.
        </div>
      )}
      {meta?.injectionSuspected && (
        <div className="alert alert-warning py-1 px-2 small" role="note">
          Some repository text looks like instructions aimed at an AI. It was treated as data and ignored.
        </div>
      )}
      {message.blocks?.map((b, i) => (
        <Block key={i} block={b} />
      ))}
      {meta && meta.warnings.length > 0 && (
        <ul className="small text-muted mt-2 mb-0 ps-3">
          {meta.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      {meta?.truncated && <div className="small text-muted mt-2">Only part of the relevant code fit in the context, so this view may be incomplete.</div>}
      {meta && (
        <div className="small text-muted mt-2">
          {meta.provider === "gemini" ? `Generated by Gemini (${meta.model})` : "Generated by the mock provider"} · {(meta.durationMs / 1000).toFixed(1)} s
        </div>
      )}
    </div>
  );
}

function Block({ block }: { block: AnswerBlock }) {
  const { repo, openFile } = useExplorer();
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  return (
    <div className="ai-block">
      <div className="mb-1 d-flex gap-2 align-items-center">
        <EvidenceBadge kind={block.kind} />
        {block.downgraded && <span className="small text-muted">no verifiable source</span>}
      </div>
      <div style={{ whiteSpace: "pre-wrap" }}>{block.text}</div>
      {block.refs?.map((ref, i) => {
        const code = openIdx === i ? excerpt(repo, ref) : undefined;
        return (
          <div key={formatRef(ref) + i}>
            <div className="d-flex gap-1">
              <button type="button" className="citation" onClick={() => openFile(ref.file, { start: ref.startLine, end: ref.endLine })} title="Open in source viewer">
                {formatRef(ref)}
                {ref.symbol ? ` · ${ref.symbol}` : ""}
              </button>
              <button
                type="button"
                className="btn btn-sm btn-light border mt-1"
                aria-expanded={openIdx === i}
                aria-label="Toggle code excerpt"
                onClick={() => setOpenIdx(openIdx === i ? null : i)}
              >
                <i className="bi bi-code-slash" aria-hidden="true" />
              </button>
            </div>
            {code !== undefined && <pre className="excerpt">{code}</pre>}
          </div>
        );
      })}
    </div>
  );
}
