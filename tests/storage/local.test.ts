/**
 * Unit tests de Storage (Task 8.1)
 *
 * Round-trip saveBytes/readBytes, saveJson/readJson, exists.
 * Rejeição de jobId inválido.
 * Requirements: 15.1, 15.3, 15.4, 15.5
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import { localStorage } from '@/lib/storage';

// ---------------------------------------------------------------------------
// Setup — use a temp directory per test suite
// ---------------------------------------------------------------------------

let tmpRoot: string;
let origStorageRoot: string | undefined;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'storage-test-'));
  origStorageRoot = process.env['STORAGE_ROOT'];
  process.env['STORAGE_ROOT'] = tmpRoot;
});

afterEach(async () => {
  if (origStorageRoot !== undefined) {
    process.env['STORAGE_ROOT'] = origStorageRoot;
  } else {
    delete process.env['STORAGE_ROOT'];
  }
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

// Valid UUID v4 for tests
const VALID_JOB_ID = '550e8400-e29b-41d4-a716-446655440000';

// ---------------------------------------------------------------------------
// saveBytes / readBytes round-trip
// ---------------------------------------------------------------------------

describe('saveBytes / readBytes', () => {
  it('round-trip preserva bytes exatos', async () => {
    const data = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // PNG header
    await localStorage.saveBytes(VALID_JOB_ID, 'test.png', data);
    const result = await localStorage.readBytes(VALID_JOB_ID, 'test.png');
    expect(result).toEqual(data);
  });

  it('cria diretórios intermediários automaticamente', async () => {
    const data = Buffer.from('hello');
    await localStorage.saveBytes(VALID_JOB_ID, 'iterations/1.png', data);
    const result = await localStorage.readBytes(VALID_JOB_ID, 'iterations/1.png');
    expect(result).toEqual(data);
  });

  it('sobrescreve arquivo existente', async () => {
    await localStorage.saveBytes(VALID_JOB_ID, 'file.bin', Buffer.from('v1'));
    await localStorage.saveBytes(VALID_JOB_ID, 'file.bin', Buffer.from('v2'));
    const result = await localStorage.readBytes(VALID_JOB_ID, 'file.bin');
    expect(result.toString()).toBe('v2');
  });
});

// ---------------------------------------------------------------------------
// saveJson / readJson round-trip
// ---------------------------------------------------------------------------

describe('saveJson / readJson', () => {
  it('round-trip preserva objeto JSON', async () => {
    const obj = { canvas: { widthMm: 300, heightMm: 500 }, background: { dataUrl: '__deferred__' }, textElements: [] };
    await localStorage.saveJson(VALID_JOB_ID, 'layout.json', obj);
    const result = await localStorage.readJson<typeof obj>(VALID_JOB_ID, 'layout.json');
    expect(result).toEqual(obj);
  });

  it('persiste layout.json com background.dataUrl = __deferred__', async () => {
    const layout = {
      canvas: { widthMm: 100, heightMm: 200 },
      background: { dataUrl: '__deferred__' },
      textElements: [
        {
          id: 't0',
          content: 'Hello',
          position: { xMm: 10, yMm: 20 },
          size: { widthMm: 50, heightMm: 30 },
          typography: { fontFamily: 'Inter', fontSizePx: 16, fontWeight: 400, color: '#000', align: 'left' },
        },
      ],
    };

    await localStorage.saveJson(VALID_JOB_ID, 'layout.json', layout);
    const result = await localStorage.readJson<typeof layout>(VALID_JOB_ID, 'layout.json');
    expect(result.background.dataUrl).toBe('__deferred__');
    expect(result.textElements[0]?.content).toBe('Hello');
  });
});

// ---------------------------------------------------------------------------
// exists
// ---------------------------------------------------------------------------

describe('exists', () => {
  it('retorna false para arquivo inexistente', async () => {
    const result = await localStorage.exists(VALID_JOB_ID, 'nonexistent.png');
    expect(result).toBe(false);
  });

  it('retorna true após salvar arquivo', async () => {
    await localStorage.saveBytes(VALID_JOB_ID, 'exists.png', Buffer.from('data'));
    const result = await localStorage.exists(VALID_JOB_ID, 'exists.png');
    expect(result).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// pathFor
// ---------------------------------------------------------------------------

describe('pathFor', () => {
  it('retorna path absoluto dentro do storage root', () => {
    const p = localStorage.pathFor(VALID_JOB_ID, 'original.jpg');
    expect(p).toContain(VALID_JOB_ID);
    expect(p).toContain('original.jpg');
    expect(path.isAbsolute(p)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Rejeição de jobId inválido
// ---------------------------------------------------------------------------

describe('rejeição de jobId inválido', () => {
  const invalidIds = [
    'not-a-uuid',
    '12345',
    '',
    '../../../etc/passwd',
    'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx', // wrong format
    '550e8400-e29b-41d4-a716-44665544000g', // invalid char
    '/absolute/path',
    'path/with/slash',
    '550e8400-e29b-31d4-a716-446655440000', // version 3, not 4
  ];

  for (const invalidId of invalidIds) {
    it(`rejeita jobId inválido: "${invalidId.slice(0, 30)}"`, async () => {
      await expect(
        localStorage.saveBytes(invalidId, 'test.png', Buffer.from('data')),
      ).rejects.toThrow();
    });
  }
});
