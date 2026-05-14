/**
 * Task 4 — Teste obrigatório da constante INTER_VARIABLE_BASE64
 *
 * Verifica que os primeiros 4 bytes decodificados são 0x77 0x4F 0x46 0x32
 * (magic number WOFF2: "wOF2" em ASCII).
 */

import { describe, it, expect } from 'vitest';
import { INTER_VARIABLE_BASE64 } from '@/lib/layout/fonts';

describe('INTER_VARIABLE_BASE64', () => {
  it('é uma string não vazia', () => {
    expect(typeof INTER_VARIABLE_BASE64).toBe('string');
    expect(INTER_VARIABLE_BASE64.length).toBeGreaterThan(0);
  });

  it('decodifica para um buffer com magic number WOFF2 (wOF2)', () => {
    // Extract the base64 payload — the constant may be a data URL or raw base64
    const raw = INTER_VARIABLE_BASE64.startsWith('data:')
      ? INTER_VARIABLE_BASE64.split(',')[1] ?? ''
      : INTER_VARIABLE_BASE64;

    const buf = Buffer.from(raw, 'base64');

    // WOFF2 magic: 0x77 0x4F 0x46 0x32 = "wOF2"
    expect(buf[0]).toBe(0x77); // 'w'
    expect(buf[1]).toBe(0x4f); // 'O'
    expect(buf[2]).toBe(0x46); // 'F'
    expect(buf[3]).toBe(0x32); // '2'
  });
});
