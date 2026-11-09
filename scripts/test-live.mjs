// Runs the live Gemini tests (needs GEMINI_API_KEY in .env.local). Works on every OS without extra dependencies.
import { spawnSync } from "node:child_process";

const result = spawnSync("npx", ["vitest", "run", "tests/ai/live.test.ts"], {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, RUN_LIVE_AI: "1" },
});
process.exit(result.status ?? 1);
