/**
 * lib/storage.ts
 *
 * Storage abstraction — filesystem implementation.
 * Requirements: 15.1–15.6
 */

import fs from 'fs/promises';
import path from 'path';

// ---------------------------------------------------------------------------
// UUID v4 validation
// ---------------------------------------------------------------------------

const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertValidJobId(jobId: string): void {
  if (!UUID_V4_RE.test(jobId)) {
    throw new Error(`Invalid jobId: "${jobId}" is not a valid UUID v4`);
  }
}

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface Storage {
  saveBytes(jobId: string, relPath: string, data: Buffer): Promise<void>;
  readBytes(jobId: string, relPath: string): Promise<Buffer>;
  saveJson<T>(jobId: string, relPath: string, value: T): Promise<void>;
  readJson<T>(jobId: string, relPath: string): Promise<T>;
  exists(jobId: string, relPath: string): Promise<boolean>;
  pathFor(jobId: string, relPath: string): string;
}

// ---------------------------------------------------------------------------
// Local filesystem implementation
// ---------------------------------------------------------------------------

function getStorageRoot(): string {
  return process.env['STORAGE_ROOT'] ?? path.join(process.cwd(), 'storage', 'jobs');
}

export const localStorage: Storage = {
  pathFor(jobId: string, relPath: string): string {
    assertValidJobId(jobId);
    return path.join(getStorageRoot(), jobId, relPath);
  },

  async saveBytes(jobId: string, relPath: string, data: Buffer): Promise<void> {
    const fullPath = this.pathFor(jobId, relPath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, data);
  },

  async readBytes(jobId: string, relPath: string): Promise<Buffer> {
    const fullPath = this.pathFor(jobId, relPath);
    return fs.readFile(fullPath);
  },

  async saveJson<T>(jobId: string, relPath: string, value: T): Promise<void> {
    const data = Buffer.from(JSON.stringify(value, null, 2), 'utf-8');
    await this.saveBytes(jobId, relPath, data);
  },

  async readJson<T>(jobId: string, relPath: string): Promise<T> {
    const buf = await this.readBytes(jobId, relPath);
    return JSON.parse(buf.toString('utf-8')) as T;
  },

  async exists(jobId: string, relPath: string): Promise<boolean> {
    const fullPath = this.pathFor(jobId, relPath);
    try {
      await fs.access(fullPath);
      return true;
    } catch {
      return false;
    }
  },
};
