/**
 * Property-Based Test P3 — Idempotência atômica de transitionStatus (Task 7.3)
 *
 * **Validates: Requirements 12.3, 16.3**
 *
 * Property P3: Idempotência atômica
 * Duas chamadas concorrentes a transitionStatus(id, [from], to) devem produzir
 * exatamente uma true e uma false.
 *
 * Note: better-sqlite3 é síncrono, então "concorrência" aqui é testada via
 * chamadas sequenciais rápidas — o que é suficiente para validar a atomicidade
 * do UPDATE ... WHERE status IN (...) com changes() check.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import Database from 'better-sqlite3';
import { initSchema } from '@/lib/db';
import type { JobStatus } from '@/lib/layout/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  initSchema(db);
  return db;
}

function insertTestJob(db: Database.Database, id: string, status: JobStatus): void {
  const now = Date.now();
  db.prepare(
    `INSERT INTO jobs (id, width_mm, height_mm, initial_prompt, status, current_iteration, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, 100, 100, 'test', status, 0, now, now);
}

function transitionStatus(
  db: Database.Database,
  id: string,
  from: JobStatus[],
  to: JobStatus,
): boolean {
  const placeholders = from.map(() => '?').join(', ');
  const stmt = db.prepare(
    `UPDATE jobs SET status = ?, updated_at = ? WHERE id = ? AND status IN (${placeholders})`,
  );
  const result = stmt.run(to, Date.now(), id, ...from);
  return result.changes === 1;
}

// ---------------------------------------------------------------------------
// Property P3: Idempotência atômica
// ---------------------------------------------------------------------------

describe('P3 — Idempotência atômica de transitionStatus', () => {
  /**
   * **Validates: Requirements 12.3, 16.3**
   *
   * Para qualquer par (from, to) de transição válida:
   * Duas chamadas sequenciais a transitionStatus com o mesmo job devem produzir
   * exatamente uma true e uma false.
   *
   * (r1 || r2) && !(r1 && r2) — XOR
   */
  it('exatamente uma chamada retorna true para iterating → processing_step4', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        (id) => {
          const db = createTestDb();
          insertTestJob(db, id, 'iterating');

          const r1 = transitionStatus(db, id, ['iterating'], 'processing_step4');
          const r2 = transitionStatus(db, id, ['iterating'], 'processing_step4');

          // XOR: exactly one true
          expect((r1 || r2) && !(r1 && r2)).toBe(true);
          expect(r1).toBe(true);  // first call wins
          expect(r2).toBe(false); // second call fails (status already changed)
        },
      ),
      { numRuns: 100 },
    );
  });

  it('exatamente uma chamada retorna true para preview_ready → rendering_pdf', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        (id) => {
          const db = createTestDb();
          insertTestJob(db, id, 'preview_ready');

          const r1 = transitionStatus(db, id, ['preview_ready'], 'rendering_pdf');
          const r2 = transitionStatus(db, id, ['preview_ready'], 'rendering_pdf');

          expect((r1 || r2) && !(r1 && r2)).toBe(true);
          expect(r1).toBe(true);
          expect(r2).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('transição para error a partir de qualquer estado pré-terminal', () => {
    const preTerminalStatuses: JobStatus[] = [
      'created', 'iterating', 'processing_step4', 'rendering_pdf',
    ];

    for (const status of preTerminalStatuses) {
      const db = createTestDb();
      const id = `test-${status}`;
      insertTestJob(db, id, status);

      const r1 = transitionStatus(db, id, [status], 'error');
      const r2 = transitionStatus(db, id, [status], 'error');

      expect(r1).toBe(true);
      expect(r2).toBe(false);
    }
  });

  it('transição falha quando job não existe', () => {
    const db = createTestDb();
    const result = transitionStatus(db, 'nonexistent-id', ['iterating'], 'processing_step4');
    expect(result).toBe(false);
  });

  it('status final é correto após transição bem-sucedida', () => {
    const db = createTestDb();
    const id = 'status-check';
    insertTestJob(db, id, 'iterating');

    transitionStatus(db, id, ['iterating'], 'processing_step4');

    const row = db.prepare('SELECT status FROM jobs WHERE id = ?').get(id) as { status: string };
    expect(row.status).toBe('processing_step4');
  });
});
