import type { SourceFile } from "@/domain/types";

/** Package name (exact, or prefix when ending in "/") → technology label. Order = display order. */
const PACKAGE_TECH: [string, string][] = [
  ["next", "Next.js"], ["react", "React"], ["vue", "Vue"], ["nuxt", "Nuxt"], ["@angular/core", "Angular"], ["svelte", "Svelte"], ["solid-js", "SolidJS"],
  ["express", "Express"], ["fastify", "Fastify"], ["koa", "Koa"], ["hono", "Hono"], ["@nestjs/core", "NestJS"], ["@trpc/server", "tRPC"], ["graphql", "GraphQL"],
  ["prisma", "Prisma"], ["@prisma/client", "Prisma"], ["drizzle-orm", "Drizzle"], ["typeorm", "TypeORM"], ["sequelize", "Sequelize"], ["mongoose", "Mongoose"], ["knex", "Knex"],
  ["pg", "PostgreSQL (pg)"], ["mysql2", "MySQL"], ["mongodb", "MongoDB"], ["redis", "Redis"], ["ioredis", "Redis"], ["better-sqlite3", "SQLite"],
  ["jsonwebtoken", "JWT"], ["passport", "Passport"], ["next-auth", "NextAuth"], ["bcrypt", "bcrypt"], ["bcryptjs", "bcrypt"],
  ["stripe", "Stripe"], ["nodemailer", "Nodemailer"], ["socket.io", "Socket.IO"], ["axios", "Axios"],
  ["openai", "OpenAI SDK"], ["@anthropic-ai/sdk", "Anthropic SDK"], ["@google/genai", "Gemini SDK"], ["@google/generative-ai", "Gemini SDK"],
  ["zod", "Zod"], ["bootstrap", "Bootstrap"], ["tailwindcss", "Tailwind CSS"], ["@mui/material", "MUI"], ["@xyflow/react", "React Flow"],
  ["vite", "Vite"], ["webpack", "Webpack"], ["esbuild", "esbuild"], ["typescript", "TypeScript"],
  ["vitest", "Vitest"], ["jest", "Jest"], ["mocha", "Mocha"], ["@playwright/test", "Playwright"], ["cypress", "Cypress"], ["eslint", "ESLint"],
];

/** File-based evidence for technologies that are not npm packages. */
const FILE_TECH: [RegExp, string][] = [
  [/(^|\/)tsconfig[^/]*\.json$/, "TypeScript"],
  [/(^|\/)Dockerfile$/, "Docker"],
  [/(^|\/)docker-compose[^/]*\.ya?ml$/, "Docker Compose"],
  [/^\.github\/workflows\//, "GitHub Actions"],
  [/(^|\/)go\.mod$/, "Go"],
  [/(^|\/)Cargo\.toml$/, "Rust (Cargo)"],
  [/(^|\/)pom\.xml$/, "Java (Maven)"],
  [/(^|\/)build\.gradle(\.kts)?$/, "Java/Kotlin (Gradle)"],
  [/(^|\/)composer\.json$/, "PHP (Composer)"],
  [/(^|\/)Gemfile$/, "Ruby (Bundler)"],
  [/(^|\/)(requirements\.txt|pyproject\.toml)$/, "Python"],
  [/(^|\/)next\.config\.[a-z]+$/, "Next.js"],
  [/(^|\/)vite\.config\.[a-z]+$/, "Vite"],
];

const PYTHON_PACKAGES: [RegExp, string][] = [
  [/^\s*django\b/im, "Django"],
  [/^\s*flask\b/im, "Flask"],
  [/^\s*fastapi\b/im, "FastAPI"],
];

export function detectTechnologies(files: SourceFile[], dependencyNames: Set<string>): string[] {
  const found: string[] = [];
  const add = (label: string) => {
    if (!found.includes(label)) found.push(label);
  };
  for (const [pkg, label] of PACKAGE_TECH) if (dependencyNames.has(pkg)) add(label);
  for (const f of files) {
    for (const [re, label] of FILE_TECH) if (re.test(f.path)) add(label);
    if (/(^|\/)(requirements\.txt|pyproject\.toml)$/.test(f.path)) {
      for (const [re, label] of PYTHON_PACKAGES) if (re.test(f.content)) add(label);
    }
  }
  return found;
}

/** External systems an application talks to, derived from the packages it imports. */
export const EXTERNAL_SYSTEMS: { packages: string[]; id: string; label: string; description: string }[] = [
  { packages: ["pg", "postgres", "pg-promise"], id: "ext:postgres", label: "PostgreSQL", description: "Relational database accessed through a PostgreSQL driver." },
  { packages: ["mysql", "mysql2"], id: "ext:mysql", label: "MySQL", description: "Relational database accessed through a MySQL driver." },
  { packages: ["mongodb", "mongoose"], id: "ext:mongodb", label: "MongoDB", description: "Document database." },
  { packages: ["redis", "ioredis"], id: "ext:redis", label: "Redis", description: "In-memory data store." },
  { packages: ["better-sqlite3", "sqlite3"], id: "ext:sqlite", label: "SQLite", description: "Embedded SQL database." },
  { packages: ["@prisma/client"], id: "ext:prisma", label: "Database (Prisma)", description: "Database accessed through the Prisma client." },
  { packages: ["drizzle-orm"], id: "ext:drizzle", label: "Database (Drizzle)", description: "Database accessed through Drizzle ORM." },
  { packages: ["stripe"], id: "ext:stripe", label: "Stripe API", description: "Payment provider." },
  { packages: ["nodemailer"], id: "ext:smtp", label: "SMTP server", description: "Outgoing mail server used through Nodemailer." },
  { packages: ["openai"], id: "ext:openai", label: "OpenAI API", description: "Hosted language model API." },
  { packages: ["@anthropic-ai/sdk"], id: "ext:anthropic", label: "Anthropic API", description: "Hosted language model API." },
  { packages: ["@google/genai", "@google/generative-ai"], id: "ext:gemini", label: "Gemini API", description: "Hosted language model API." },
  { packages: ["axios", "node-fetch", "got", "undici"], id: "ext:http", label: "External HTTP APIs", description: "Outgoing HTTP requests through an HTTP client library." },
  { packages: ["firebase", "firebase-admin"], id: "ext:firebase", label: "Firebase", description: "Google Firebase services." },
  { packages: ["@supabase/supabase-js"], id: "ext:supabase", label: "Supabase", description: "Supabase backend." },
];
