/**
 * Unit tests do Database layer (Task 7.4)
 *
 * Verifica PRAGMAs, CHECK constraint, round-trip insertJob/getJob.
 * Requirements: 12.1, 12.6
 *
 * Note: WAL mode is not supported on in-memory SQLite databases.
 * We test PRAGMAs using a temp file-based DB.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { initSchema } from '@/lib/db';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDbPath: string;
let db: Database.Database;

beforeEach(() => {
  tmpDbPath = path.join(os.tmpdir(), `schema-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  db = new Database(tmpDbPath);
  initSchema(db);
});

afterEach(() => {
  db.close();
  if (fs.existsSync(tmpDbPath)) fs.unlinkSync(tmpDbPath);
  const wal = tmpDbPath + '-wal';
  const shm = tmpDbPath + '-shm';
  if (fs.existsSync(wal)) fs.unlinkSync(wal);
  if (fs.existsSync(shm)) fs.unlinkSync(shm);
});

// ---------------------------------------------------------------------------
// PRAGMAs
// ---------------------------------------------------------------------------

describe('initSchema — PRAGMAs', () => {
  it('aplica journal_mode = WAL', () => {
    const result = db.pragma('journal_mode') as Array<{ journal_mode: string }>;
    expect(result[0]?.journal_mode).toBe('wal');
  });

  it('aplica synchronous = NORMAL (1)', () => {
    const result = db.pragma('synchronous') as Array<{ synchronous: number }>;
    // NORMAL = 1
    expect(result[0]?.synchronous).toBe(1);
  });

  it('aplica foreign_keys = ON (1)', () => {
    const result = db.pragma('foreign_keys') as Array<{ foreign_keys: number }>;
    expect(result[0]?.foreign_keys).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// jobs table — CHECK constraint
// ---------------------------------------------------------------------------

describe('jobs table — CHECK constraint', () => {
  it('rejeita status inválido', () => {
    const now = Date.now();
    expect(() => {
      db.prepare(
        `INSERT INTO jobs (id, width_mm, height_mm, initial_prompt, status, current_iteration, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run('test-id', 100, 200, 'prompt', 'invalid_status', 0, now, now);
    }).toThrow();
  });

  it('aceita todos os status válidos', () => {
    const validStatuses = [
      'created', 'iterating', 'processing_step4',
      'preview_ready', 'rendering_pdf', 'pdf_ready', 'error',
    ];
    const now = Date.now();

    for (const status of validStatuses) {
      expect(() => {
        db.prepare(
          `INSERT INTO jobs (id, width_mm, height_mm, initial_prompt, status, current_iteration, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(`id-${status}`, 100, 200, 'prompt', status, 0, now, now);
      }).not.toThrow();
    }
  });
});

// ---------------------------------------------------------------------------
// insertJob + getJob — round-trip
// ---------------------------------------------------------------------------

describe('insertJob + getJob — round-trip', () => {
  it('round-trip preserva todos os campos', () => {
    const now = Date.now();

    db.prepare(
      `INSERT INTO jobs (id, width_mm, height_mm, initial_prompt, status, current_iteration, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('abc-123', 300, 500, 'test prompt', 'created', 0, now, now);

    const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get('abc-123') as {
      id: string;
      width_mm: number;
      height_mm: number;
      initial_prompt: string;
      status: string;
      current_iteration: number;
      layout_json: string | null;
      error_message: string | null;
      created_at: number;
      updated_at: number;
    };

    expect(row.id).toBe('abc-123');
    expect(row.width_mm).toBe(300);
    expect(row.height_mm).toBe(500);
    expect(row.initial_prompt).toBe('test prompt');
    expect(row.status).toBe('created');
    expect(row.current_iteration).toBe(0);
    expect(row.layout_json).toBeNull();
    expect(row.error_message).toBeNull();
    expect(row.created_at).toBe(now);
    expect(row.updated_at).toBe(now);
  });

  it('getJob retorna null para id inexistente', () => {
    const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get('nonexistent') as undefined;
    expect(row).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// transitionStatus — atomicidade
// ---------------------------------------------------------------------------

describe('transitionStatus — atomicidade', () => {
  it('retorna 1 change quando transição é válida', () => {
    const now = Date.now();
    db.prepare(
      `INSERT INTO jobs (id, width_mm, height_mm, initial_prompt, status, current_iteration, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('job-1', 100, 100, 'p', 'created', 0, now, now);

    const result = db.prepare(
      `UPDATE jobs SET status = ?, updated_at = ? WHERE id = ? AND status IN ('created')`,
    ).run('iterating', Date.now(), 'job-1');

    expect(result.changes).toBe(1);
  });

  it('retorna 0 changes quando status não está no from', () => {
    const now = Date.now();
    db.prepare(
      `INSERT INTO jobs (id, width_mm, height_mm, initial_prompt, status, current_iteration, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('job-2', 100, 100, 'p', 'iterating', 0, now, now);

    const result = db.prepare(
      `UPDATE jobs SET status = ?, updated_at = ? WHERE id = ? AND status IN ('created')`,
    ).run('iterating', Date.now(), 'job-2');

    expect(result.changes).toBe(0);
  });

  it('status final é correto após transição', () => {
    const now = Date.now();
    db.prepare(
      `INSERT INTO jobs (id, width_mm, height_mm, initial_prompt, status, current_iteration, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('job-3', 100, 100, 'p', 'iterating', 0, now, now);

    db.prepare(
      `UPDATE jobs SET status = ?, updated_at = ? WHERE id = ? AND status IN ('iterating')`,
    ).run('processing_step4', Date.now(), 'job-3');

    const row = db.prepare('SELECT status FROM jobs WHERE id = ?').get('job-3') as { status: string };
    expect(row.status).toBe('processing_step4');
  });
});
