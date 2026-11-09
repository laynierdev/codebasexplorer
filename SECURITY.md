# Security

CodebaseXplorer analyzes source code it does not trust. This document describes the guarantees the project aims for and how to report a problem.

## Guarantees

- **Repository code is never executed.** Uploaded archives and folders are only read as text. The analyzer parses syntax (it does not type-check or resolve packages), never runs scripts, never installs dependencies and never evaluates anything found in a repository.
- **Archives are validated before anything is extracted.** Path traversal (`..`), absolute paths, control characters, duplicate entries, too many entries, oversized files, and suspicious compression ratios reject or skip the archive. Ignored directories such as `node_modules` are never decompressed. Nothing is written to disk.
- **Repository text is treated as untrusted data by the AI.** It is placed inside a delimited, sanitized data block, the fixed system instruction tells the model never to follow instructions found there, and the answer must be structured JSON validated against a schema. Suspected instruction-like text is flagged to the user.
- **AI references are verified.** File paths, line ranges and symbols cited by the model are checked against the real repository; unverifiable citations are dropped or corrected, and unverifiable "facts" are downgraded to inferences.
- **Secrets stay on the server.** `GEMINI_API_KEY` is read only by the server routes and is never sent to the browser. Build output is checked to make sure it does not contain it. Source content is not logged; only request metadata (task, provider, duration) is.
- **Only short excerpts leave the machine**, and only when an AI feature is used: the browser selects the few files and line ranges relevant to the request. Analysis, search, graphs and storage all run locally in the browser.
- **Hardened responses.** A Content Security Policy (production), `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` and `Cross-Origin-Opener-Policy` headers are set. The AI endpoint validates and size-limits input, rejects cross-origin browser requests and applies a best-effort rate limit.

## Deployment note

A public deployment lets anyone who can open it spend **your** Gemini quota through `/api/ai`. For public demos prefer `AI_PROVIDER=mock`, or put the deployment behind authentication (for example Vercel Deployment Protection). The built-in rate limit is in-memory and per serverless instance, so it is a safety net, not a quota.

## Reporting a vulnerability

Please do not open a public issue for security problems. Report them privately to the maintainers (use GitHub's "Report a vulnerability" feature on the repository) with steps to reproduce. You will get an acknowledgement and a fix or mitigation plan as soon as possible.
