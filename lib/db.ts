/**
 * lib/db.ts
 *
 * Database layer — better-sqlite3 with WAL mode.
 * Requirements: 12.1–12.6
 */

import Database from 'better-sqlite3';
import path from 'path';
import type { JobStatus, TextBrief } from './layout/types';
import { localStorage } from './storage';

export type { JobStatus };

export type JobRow = {
  id: string;
  width_mm: number;
  height_mm: number;
  initial_prompt: string;
  status: JobStatus;
  current_iteration: number;
  layout_json: string | null;
  text_brief_json: string | null;
  reference_analysis_json: string | null;
  error_message: string | null;
  created_at: number;
  updated_at: number;
};

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;

  const dbPath = process.env['SQLITE_PATH'] ?? path.join(process.cwd(), 'storage', 'jobs.db');
  _db = new Database(dbPath);
  initSchema(_db);
  return _db;
}

// ---------------------------------------------------------------------------
// Schema init
// ---------------------------------------------------------------------------

export function initSchema(db?: Database.Database): void {
  const d = db ?? getDb();

  d.pragma('journal_mode = WAL');
  d.pragma('synchronous = NORMAL');
  d.pragma('foreign_keys = ON');

  d.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      width_mm INTEGER NOT NULL,
      height_mm INTEGER NOT NULL,
      initial_prompt TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN (
        'created','analyzing_reference','text_review','iterating',
        'processing_step4','preview_ready','rendering_pdf','pdf_ready','error'
      )),
      current_iteration INTEGER NOT NULL DEFAULT 0,
      layout_json TEXT,
      text_brief_json TEXT,
      reference_analysis_json TEXT,
      error_message TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
  `);
}

// ---------------------------------------------------------------------------
// CRUD helpers
// ---------------------------------------------------------------------------

export function insertJob(input: {
  id: string;
  widthMm: number;
  heightMm: number;
  initialPrompt: string;
  initialStatus?: JobStatus;
}): void {
  const db = getDb();
  const now = Date.now();
  const status: JobStatus = input.initialStatus ?? 'created';
  db.prepare(
    `INSERT INTO jobs (id, width_mm, height_mm, initial_prompt, status, current_iteration, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
  ).run(input.id, input.widthMm, input.heightMm, input.initialPrompt, status, now, now);
}

export function getJob(id: string): JobRow | null {
  const db = getDb();
  return (db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as JobRow | undefined) ?? null;
}

/**
 * Applies a partial patch to a job row.
 * Does NOT accept `status` — use transitionStatus for status changes.
 */
export function updateJob(
  id: string,
  patch: Partial<
    Pick<
      JobRow,
      | 'current_iteration'
      | 'layout_json'
      | 'text_brief_json'
      | 'reference_analysis_json'
      | 'error_message'
    >
  >,
): void {
  const db = getDb();
  const now = Date.now();

  const allowed: Array<keyof typeof patch> = [
    'current_iteration',
    'layout_json',
    'text_brief_json',
    'reference_analysis_json',
    'error_message',
  ];
  const setClauses: string[] = ['updated_at = ?'];
  const values: unknown[] = [now];

  for (const key of allowed) {
    if (key in patch) {
      setClauses.push(`${key} = ?`);
      values.push(patch[key] ?? null);
    }
  }

  values.push(id);
  db.prepare(`UPDATE jobs SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);
}

/**
 * Atomically transitions a job's status.
 * Returns true if exactly one row was updated (i.e., the transition succeeded).
 * This is the ONLY authorised point to change the `status` column.
 *
 * Requirements: 12.2, 12.3, P3
 */
export function transitionStatus(id: string, from: JobStatus[], to: JobStatus): boolean {
  const db = getDb();
  const now = Date.now();
  const placeholders = from.map(() => '?').join(', ');
  const stmt = db.prepare(
    `UPDATE jobs SET status = ?, updated_at = ? WHERE id = ? AND status IN (${placeholders})`,
  );
  const result = stmt.run(to, now, id, ...from);
  return result.changes === 1;
}

// ---------------------------------------------------------------------------
// TextBrief wrappers (DB-first, FS best-effort)
// ---------------------------------------------------------------------------

/**
 * Reads the TextBrief for a job from the DB column.
 * Returns null when the job is missing, the column is NULL,
 * or the JSON fails to parse.
 *
 * Requirements: 11.2, P-PERSISTENCE-PARITY-1
 */
export function getTextBrief(id: string): TextBrief | null {
  const job = getJob(id);
  if (!job?.text_brief_json) return null;
  try {
    return JSON.parse(job.text_brief_json) as TextBrief;
  } catch {
    return null;
  }
}

/**
 * Writes the TextBrief to BOTH the DB column AND the filesystem
 * (`storage/jobs/{id}/text-brief.json`). The DB write is the source of
 * truth and runs first; if the file write throws AFTER a successful DB
 * write, the error is logged and swallowed (drift accepted per Req 11.5).
 *
 * Requirements: 11.2, 11.5; P-PERSISTENCE-PARITY-1
 */
export async function setTextBrief(id: string, brief: TextBrief): Promise<void> {
  updateJob(id, { text_brief_json: JSON.stringify(brief) });
  try {
    await localStorage.saveJson(id, 'text-brief.json', brief);
  } catch (err) {
    console.warn(`[setTextBrief] FS drift for job ${id}:`, err);
  }
}
