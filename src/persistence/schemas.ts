import { z } from "zod";
import { AnalysisLimitsSchema, RepositorySchema } from "@/domain/schemas";
import { DocSectionSchema } from "@/ai/schemas";

/**
 * Schemas for everything that is stored in the browser or written to an export file.
 * Anything read back is validated with these before the app uses it.
 */

export const APP_NAME = "CodebaseXplorer";
export const APP_VERSION = "0.1.0";

/** Version of the records kept in IndexedDB. Bump together with a migration in `migrate.ts`. */
export const STORAGE_SCHEMA_VERSION = 1;
/** Version of the JSON export file format. Bump together with a migration in `migrate.ts`. */
export const EXPORT_SCHEMA_VERSION = 1;
export const EXPORT_FORMAT = "codebasexplorer-export";

const isoDate = z.iso.datetime();

export const ProjectIdSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9._-]+$/, "Project ids may only contain letters, digits, dots, dashes and underscores.");

export const ProjectSettingsSchema = z.object({
  /** Limits that were in effect when the project was analyzed (kept for reference). */
  limits: AnalysisLimitsSchema,
});

export const ProjectMetaSchema = z.object({
  id: ProjectIdSchema,
  name: z.string().trim().min(1).max(120),
  description: z.string().max(400),
  origin: z.enum(["zip", "folder", "import"]),
  createdAt: isoDate,
  updatedAt: isoDate,
  lastOpenedAt: isoDate,
  fileCount: z.number().int().nonnegative(),
  parsedFileCount: z.number().int().nonnegative(),
  /** Total size of the stored source files in bytes. */
  sourceBytes: z.number().int().nonnegative(),
  languages: z.array(z.string().max(60)).max(10),
  settings: ProjectSettingsSchema,
});

/** AI-written documentation kept with a project so it does not have to be regenerated. */
export const StoredDocSchema = z.object({
  section: DocSectionSchema,
  markdown: z.string().max(300_000),
  provider: z.enum(["gemini", "mock"]),
  model: z.string().max(100).optional(),
  warnings: z.array(z.string().max(500)).max(20),
  savedAt: isoDate,
});

export const AppSettingsSchema = z.object({
  limits: AnalysisLimitsSchema,
  /** Save imported projects automatically (only after the user accepted the storage explanation). */
  autoSave: z.boolean(),
  /** The user has read and accepted what saving a project stores. */
  consentGiven: z.boolean(),
});

/* ---------- Export file ---------- */

export const ExportProjectSchema = z.object({
  meta: ProjectMetaSchema,
  repository: RepositorySchema,
  docs: z.array(StoredDocSchema).max(20),
});

export const ExportFileSchema = z.object({
  format: z.literal(EXPORT_FORMAT),
  schemaVersion: z.number().int().positive(),
  exportedAt: isoDate,
  app: z.object({ name: z.string().max(100), version: z.string().max(50) }),
  projects: z.array(ExportProjectSchema).min(1).max(100),
});

export type ProjectSettings = z.infer<typeof ProjectSettingsSchema>;
export type ProjectMeta = z.infer<typeof ProjectMetaSchema>;
export type StoredDoc = z.infer<typeof StoredDocSchema>;
export type AppSettings = z.infer<typeof AppSettingsSchema>;
export type ExportProject = z.infer<typeof ExportProjectSchema>;
export type ExportFile = z.infer<typeof ExportFileSchema>;
